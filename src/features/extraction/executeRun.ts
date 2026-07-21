// 一括抽出（S7）の実行: planRun の計画を消費し、バッチごとに
// 「プロンプト構築 → LLM 呼び出し → 応答検証 → quote アンカリング → Evidence 生成」を回す
// （requirements.md §4.3 / architecture.md「実行・進捗・partial_failure 処理」）。
// - LLMApiLog への記録は withLogging 済み provider を注入することで賄う（lib/llm/apiLogger.ts）
// - バッチ失敗（API エラー / 応答形式不正 / 本文取得失敗 / 保存失敗）と要素破棄（validateAiOutput
//   の rejected）はどちらも partial_failure。失敗したバッチを飛ばして残りは続行する
// - ExtractionRuns 行の作成・status/tokens の書き込み、ai annotator 行への転記（§4.3）は
//   呼び出し側（サービス層）の責務。本関数は素材（ExecuteRunResult）を返すだけ
// - Evidence の Sheets 書き込みは「バッチごとに即書き」ではなく、メモリバッファに貯めて
//   flushEveryNStudies（tier 連動。既定 5）study ごと **または** maxRowsPerFlush（既定 500）行
//   ごと（安全弁）＋ 全 study 完了時にまとめて appendEvidence する
//   （Sheets の書き込みクォータ 60 回/分/ユーザーに対する 429 対策。
//   docs/handoff-20260710-sheets-write-batching.md）
import type { NormalizedPage } from '../../domain/anchor';
import type { DocumentRecord } from '../../domain/document';
import type { Evidence } from '../../domain/evidence';
import type { ArmCompletenessRunWarning, RunStatus } from '../../domain/extractionRun';
import type { SchemaField } from '../../domain/schemaField';
import { LlmProviderError } from '../../lib/llm/LLMProvider';
import type { ChatMessage, ChatResponse, LLMProvider } from '../../lib/llm/LLMProvider';
import { generateUuid } from '../../utils/uuid';
import { anchorQuote } from '../anchoring/anchorQuote';
import { normalizeText } from '../anchoring/normalizeText';
import { detectArmCompletenessWarning } from './armCompleteness';
import type { PlannedBatch, RunPlan } from './planRun';
import {
  buildExtractDataSystemPrompt,
  buildExtractDataUserContent,
  extractDataResponseSchema,
  parseExtractDataResponse,
  type ExtractDataDocument,
  type ExtractDataImagePage,
  type ExtractDataPage,
} from './skills/extractData';
import type {
  RejectedAiItem,
  ValidateAiOutputResult,
  ValidatedAiItem,
} from './validateAiOutput';

/** 抽出は再現性優先で温度 0 に固定する */
export const EXTRACT_DATA_TEMPERATURE = 0;

export type BatchFailureReason =
  | 'load_failed' // 本文（extracted_texts）の取得失敗・空
  | 'api_error' // LLM 呼び出しの失敗（withRetry 消化後）
  | 'format_error' // 応答が JSON / 配列としてパースできない（AiOutputFormatError）
  | 'save_failed'; // Evidence 追記の失敗

/** バッチ単位の失敗。partial_failure の内訳として UI / ログに出す */
export interface BatchFailure {
  /** 失敗した抽出単位である study（バッチ = 1 study） */
  studyId: string;
  section: string | null;
  reason: BatchFailureReason;
  detail: string;
}

/** validateAiOutput が破棄した要素に、どのバッチ由来かを付与したもの */
export interface RejectedBatchItem extends RejectedAiItem {
  studyId: string;
  section: string | null;
}

export interface RunProgress {
  totalBatches: number;
  /** 処理済みバッチ数（失敗したバッチも数える） */
  completedBatches: number;
  /** 直近に処理したバッチの study */
  studyId: string;
  section: string | null;
  /** 直近のバッチが失敗していればその内訳（S7 の study 単位進捗リストの素材）。成功なら null */
  failure: BatchFailure | null;
}

export interface ExecuteRunDeps {
  /** withRetry / withLogging（purpose: extract_study）で包んだ provider を注入する */
  provider: LLMProvider;
  /** extracted_texts/{document_id}.txt を読み、ページ別テキストへ復元する */
  loadDocumentPages: (documentId: string) => Promise<ExtractDataPage[]>;
  /**
   * no_text_layer 文書のページ画像を読み込む（pdf_native。
   * handoff-scanned-pdf-native-highlight.md §7.4 PR2）。
   * plan のいずれかのバッチが画像入力の文書を含むときのみ必須（冒頭の契約検証で確認する）
   */
  loadDocumentPageImages?: (documentId: string) => Promise<ExtractDataImagePage[]>;
  /**
   * Evidence タブへの追記（追記型・上書き禁止）。バッチごとではなく、
   * flushEveryNStudies study ぶん貯まったタイミング（+ 全 study 完了時）でまとめて呼ばれる
   * （429 対策。docs/handoff-20260710-sheets-write-batching.md）
   */
  appendEvidence: (rows: readonly Evidence[]) => Promise<void>;
  /** テスト時に差し替え可能な UUID 発番（evidence_id） */
  newUuid?: () => string;
  /** バッチ処理のたびに呼ばれる進捗通知（S7 の進捗表示用） */
  onProgress?: (progress: RunProgress) => void;
  /**
   * バッチ（= 1 study）を同時に何本まで走らせるか（スループット対策。既定 1 = 逐次）。
   * RateLimitPolicy.maxConcurrency をサービス層が渡す。2 以上で並行実行する
   * （docs/handoff-20260710-throughput.md §3）。
   */
  maxConcurrency?: number;
  /**
   * Evidence の書き込みを何 study ごとにまとめて appendEvidence するか（429 対策。
   * 既定 DEFAULT_FLUSH_EVERY_N_STUDIES = 5）。0 以下・小数を渡しても 1 以上の整数へ丸める
   * （docs/handoff-20260710-sheets-write-batching.md）
   */
  flushEveryNStudies?: number;
  /**
   * 1 回のフラッシュに書く Evidence 行数の上限（429 対策の安全弁。既定
   * DEFAULT_MAX_ROWS_PER_FLUSH = 500）。0 以下・小数を渡しても 1 以上の整数へ丸める。
   * flushEveryNStudies（study 数）だけだと 1 study あたりの抽出項目が多い場合にバッファが
   * 際限なく育ちうるため、行数でも発火条件を持たせる（docs/handoff-20260710-sheets-write-batching.md）
   */
  maxRowsPerFlush?: number;
  /**
   * arm completeness 警告の外部記録（issue #106。extractionService が LLMApiLog への
   * 追記を注入する）。補助的な監査記録のため、失敗しても run は止めない（握りつぶす）
   */
  recordArmWarning?: (warning: ArmCompletenessRunWarning) => Promise<void>;
}

/** flushEveryNStudies 省略時の既定値。extractionService.ts の既定注入にも使う */
export const DEFAULT_FLUSH_EVERY_N_STUDIES = 5;

/** maxRowsPerFlush 省略時の既定値 */
export const DEFAULT_MAX_ROWS_PER_FLUSH = 500;

export interface ExecuteRunInput {
  /** 呼び出し側が発番した ExtractionRuns.run_id */
  runId: string;
  plan: RunPlan;
  /** 当該 schema_version の抽出項目（plan.batches の fieldIds をここから解決する） */
  fields: readonly SchemaField[];
  /**
   * 抽出対象の文書メタ（plan.batches の documentIds をここから role / filename へ解決し、
   * プロンプトの連結見出し `=== Document i/N [role] filename ===` に使う）。
   * plan に現れる全 document_id を含むこと
   */
  documents: readonly DocumentRecord[];
  /** planRun へ渡したものと同じ補助コンテキスト */
  protocolContext?: string | null;
  /**
   * ArmStructures 確定済みの study の arm キー一覧（issue #106 の突合素材。
   * armCompleteness.confirmedArmKeysByStudy で組み立てて渡す）。未注入・未確定の study は
   * 応答内の自己整合のみでチェックする
   */
  confirmedArmKeysByStudy?: ReadonlyMap<string, readonly string[]>;
}

export interface ExecuteRunResult {
  runId: string;
  /** バッチ失敗・要素破棄が 1 件でもあれば partial_failure（§4.3） */
  status: Extract<RunStatus, 'done' | 'partial_failure'>;
  /** 保存済みの全 Evidence。ai annotator 行への転記（§4.3）の素材 */
  evidence: Evidence[];
  rejectedItems: RejectedBatchItem[];
  batchFailures: BatchFailure[];
  /**
   * arm completeness チェックの警告（issue #106）。**status には影響させない**
   * （warning に留める設計判断。ExtractionRuns.warnings への記録と S7/S8 表示の素材）
   */
  armWarnings: ArmCompletenessRunWarning[];
  /** 実測合計（ExtractionRuns.tokens_in/out）。プロバイダが一度も返さなければ null */
  tokensIn: number | null;
  tokensOut: number | null;
  /** API 応答から取れた実モデル版（ExtractionRuns.model_version）。最初に取れた値を採用 */
  modelVersion: string | null;
}

/** 実測トークンの合算。値が取れた呼び出しだけ足し込み、一度も取れなければ null のまま */
function addTokens(total: number | null, value: number | null): number | null {
  return value === null ? total : (total ?? 0) + value;
}

/** Gemini 応答の modelVersion（実モデル版）。無い・型不正なら null */
function extractModelVersion(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const value = (raw as { modelVersion?: unknown }).modelVersion;
  return typeof value === 'string' ? value : null;
}

/** partial_failure の detail に載せるプロバイダ応答本文の最大長（UI / Sheets 表示用に責め切り） */
export const MAX_FAILURE_DETAIL_BODY_CHARS = 500;

/**
 * バッチ失敗の detail 文字列。LlmProviderError なら Gemini が返した本文
 * （例: HTTP 400 の `INVALID_ARGUMENT` 理由）も含める。本文は表示用に責め切る
 * （完全な本文は withLogging が LLMApiLog / Drive の response.json に残す）
 */
function toDetail(err: unknown): string {
  if (err instanceof LlmProviderError) {
    const body = err.responseBody.trim();
    if (body.length === 0) {
      return err.message;
    }
    const truncated =
      body.length > MAX_FAILURE_DETAIL_BODY_CHARS
        ? `${body.slice(0, MAX_FAILURE_DETAIL_BODY_CHARS - 1)}…`
        : body;
    return `${err.message}: ${truncated}`;
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * 検証済み要素 → Evidence 行。quote があればこの時点でアンカリングを確定する（§5）。
 * normalizedPages が null（= document_index が画像入力の文書を指す。pdf_native）のときは
 * アンカリング対象がそもそも無い（テキスト層が無い）ため anchorStatus は null のまま保存する。
 *
 * bbox（§7.4 PR3）は quote/anchorStatus とは別軸: 出所文書が画像入力（pdf_native）で、
 * かつ box_2d の検証（validateBox）を通過し、かつ page ヒントがあるときだけ書く。
 * それ以外（テキスト文書由来・box 欠落・box 不正・page 欠落）は両方 null に落とす
 * （bbox は機械検証できないため、他条件は緩めず厳格に AND を取る）
 */
function buildEvidenceRow(
  item: ValidatedAiItem,
  runId: string,
  studyId: string,
  documentId: string,
  normalizedPages: NormalizedPage[] | null,
  targetIsImage: boolean,
  uuid: () => string,
): Evidence {
  const anchorStatus =
    item.quote === null || normalizedPages === null
      ? null
      : anchorQuote(normalizeText(item.quote), normalizedPages, item.page).status;
  const hasBbox = targetIsImage && item.box !== null && item.page !== null;
  return {
    evidenceId: uuid(),
    runId,
    studyId,
    documentId,
    fieldId: item.fieldId,
    entityKey: item.entityKey,
    value: item.value,
    notReported: item.notReported,
    quote: item.quote,
    page: item.page,
    confidence: item.confidence,
    anchorStatus,
    bboxPage: hasBbox ? item.page : null,
    bbox: hasBbox ? item.box : null,
    // 通常抽出の行は relocate-quote（issue #94）由来ではないため常に null
    relocatedFrom: null,
  };
}

/**
 * 文献のロード結果（document 単位で 1 回だけロードし、study / バッチ間で使い回す）。
 * text_status = no_text_layer の文書はページ画像（pdf_native）としてロードするため、
 * 本文ページの代わりに imagePages を持つ（normalizedPages が無い = アンカリング不可）。
 * 高精度読み取りモード（issue #176）でページ画像を併用添付する対象の文書は
 * mode: 'text_with_images'（本文 + normalizedPages に加えて imagePages も持つ。
 * アンカリングは通常の text と同じく normalizedPages 基準）
 */
type LoadedDocument =
  | { kind: 'ok'; mode: 'text'; pages: ExtractDataPage[]; normalizedPages: NormalizedPage[] }
  | { kind: 'ok'; mode: 'image'; imagePages: ExtractDataImagePage[] }
  | {
      kind: 'ok';
      mode: 'text_with_images';
      pages: ExtractDataPage[];
      normalizedPages: NormalizedPage[];
      imagePages: ExtractDataImagePage[];
    }
  | { kind: 'error'; detail: string };

/** 連結対象として実際にロードできた 1 文書（document_index 順に並ぶ） */
type ResolvedDocument =
  | {
      documentId: string;
      role: ExtractDataDocument['role'];
      filename: string;
      mode: 'text';
      pages: ExtractDataPage[];
      normalizedPages: NormalizedPage[];
    }
  | {
      documentId: string;
      role: ExtractDataDocument['role'];
      filename: string;
      mode: 'image';
      imagePages: ExtractDataImagePage[];
    }
  | {
      documentId: string;
      role: ExtractDataDocument['role'];
      filename: string;
      mode: 'text_with_images';
      pages: ExtractDataPage[];
      normalizedPages: NormalizedPage[];
      imagePages: ExtractDataImagePage[];
    };

/** フラッシュ待ちの Evidence バッファ 1 件（生成元バッチのメタ情報を持たせ、
 *  フラッシュ失敗時にどのバッチを save_failed にすべきか分かるようにする） */
interface PendingFlushItem {
  batch: PlannedBatch;
  rows: Evidence[];
}

/**
 * items を最大 limit 本まで同時に worker へ流すワーカープール。
 * limit=1 なら 1 本のワーカーが index 順に逐次処理する（＝ for...of と同一挙動）。
 * worker は失敗も自身で握りつぶす前提（processBatch はバッチ失敗として記録し throw しない）。
 */
async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) {
        return;
      }
      await worker(items[index] as T);
    }
  });
  await Promise.all(runners);
}

export async function executeRun(
  input: ExecuteRunInput,
  deps: ExecuteRunDeps,
): Promise<ExecuteRunResult> {
  // 契約検証: plan と fields の対応が取れない呼び出しはバグなので実行前に throw
  if (input.fields.some((field) => field.schemaVersion !== input.plan.schemaVersion)) {
    throw new Error('executeRun に plan と異なる schema_version の項目が渡されています');
  }
  const fieldById = new Map(input.fields.map((field) => [field.fieldId, field]));
  const documentById = new Map(input.documents.map((doc) => [doc.documentId, doc]));
  for (const batch of input.plan.batches) {
    for (const fieldId of batch.fieldIds) {
      if (!fieldById.has(fieldId)) {
        throw new Error(`plan の field_id "${fieldId}" が fields に見つかりません`);
      }
    }
    for (const documentId of batch.documentIds) {
      if (!documentById.has(documentId)) {
        throw new Error(`plan の document_id "${documentId}" が documents に見つかりません`);
      }
    }
  }
  // 契約検証: 画像入力（pdf_native）または高精度読み取りモード（issue #176・
  // text_with_page_images）の文書を含む plan には loadDocumentPageImages が必須
  // （どちらもページ画像のロードには同じ deps を使う）
  const hasImageDocuments = input.plan.batches.some((batch) => batch.imageDocumentIds.length > 0);
  const hasAugmentedImageDocuments = input.plan.batches.some(
    (batch) => batch.augmentedImageDocumentIds.length > 0,
  );
  if ((hasImageDocuments || hasAugmentedImageDocuments) && deps.loadDocumentPageImages === undefined) {
    throw new Error(
      'plan に画像入力（pdf_native）または高精度読み取りモード（text_with_page_images）の文書が含まれていますが loadDocumentPageImages が注入されていません',
    );
  }
  // 高精度読み取りモードの対象文書 ID（run 全体で一意。plan.batches 全体から集約する。
  // 同一文書は全バッチで同じ扱いになる前提 = augmentedImageDocumentIds は run 単位のフラグの反映）
  const augmentedDocumentIds = new Set(
    input.plan.batches.flatMap((batch) => batch.augmentedImageDocumentIds),
  );

  const uuid = deps.newUuid ?? generateUuid;
  const evidence: Evidence[] = [];
  const rejectedItems: RejectedBatchItem[] = [];
  const batchFailures: BatchFailure[] = [];
  const armWarnings: ArmCompletenessRunWarning[] = [];
  // 進行中の Promise をキャッシュする（値ではなく Promise を持つことで、並行実行時に
  // 同一 document を複数バッチが同時に miss しても loadDocumentPages を 1 回に抑える）
  const loadedDocuments = new Map<string, Promise<LoadedDocument>>();
  let tokensIn: number | null = null;
  let tokensOut: number | null = null;
  let modelVersion: string | null = null;
  let completedBatches = 0;

  /**
   * 1 文書を（未ロードなら）ロードしてキャッシュする。同一 document は 1 回だけロードする。
   * text_status = no_text_layer の文書はページ画像（pdf_native）としてロードする。
   * augmentedDocumentIds に載る文書（高精度読み取りモード。issue #176）は本文とページ画像を
   * 両方ロードする（Promise.all で並行取得。どちらかが失敗・0 件ならこの文書ごと load_failed に
   * 落とす — 片方だけ成功した状態を静かに片方だけで進行させない設計。automation bias 対策と
   * 同じ「失敗を隠さない」方針に合わせる）。
   * loadDocumentPageImages の cast は安全: 画像を要する plan には冒頭の契約検証で
   * loadDocumentPageImages の注入を保証済み（このヘルパはその documentId に対してしか呼ばれない）
   */
  const loadDocument = (documentId: string): Promise<LoadedDocument> => {
    const cached = loadedDocuments.get(documentId);
    if (cached !== undefined) {
      return cached;
    }
    const doc = documentById.get(documentId) as DocumentRecord;
    const isImageOnly = doc.textStatus === 'no_text_layer';
    const isAugmented = !isImageOnly && augmentedDocumentIds.has(documentId);
    const loading = (async (): Promise<LoadedDocument> => {
      try {
        if (isImageOnly) {
          const loadImages = deps.loadDocumentPageImages as NonNullable<
            ExecuteRunDeps['loadDocumentPageImages']
          >;
          const imagePages = await loadImages(documentId);
          return imagePages.length === 0
            ? {
                kind: 'error',
                detail: 'ページ画像が 0 件です（loadDocumentPageImages の取得結果が空）',
              }
            : { kind: 'ok', mode: 'image', imagePages };
        }
        if (isAugmented) {
          const loadImages = deps.loadDocumentPageImages as NonNullable<
            ExecuteRunDeps['loadDocumentPageImages']
          >;
          const [pages, imagePages] = await Promise.all([
            deps.loadDocumentPages(documentId),
            loadImages(documentId),
          ]);
          if (pages.length === 0) {
            return { kind: 'error', detail: '本文ページが 0 件です（extracted_texts の取得結果が空）' };
          }
          if (imagePages.length === 0) {
            return {
              kind: 'error',
              detail: 'ページ画像が 0 件です（loadDocumentPageImages の取得結果が空）',
            };
          }
          return {
            kind: 'ok',
            mode: 'text_with_images',
            pages,
            normalizedPages: pages.map((page) => ({
              page: page.page,
              text: normalizeText(page.text),
            })),
            imagePages,
          };
        }
        const pages = await deps.loadDocumentPages(documentId);
        return pages.length === 0
          ? { kind: 'error', detail: '本文ページが 0 件です（extracted_texts の取得結果が空）' }
          : {
              kind: 'ok',
              mode: 'text',
              pages,
              normalizedPages: pages.map((page) => ({
                page: page.page,
                text: normalizeText(page.text),
              })),
            };
      } catch (err) {
        return { kind: 'error', detail: toDetail(err) };
      }
    })();
    loadedDocuments.set(documentId, loading);
    return loading;
  };

  const failBatch = (batch: PlannedBatch, reason: BatchFailureReason, detail: string): BatchFailure => {
    const failure: BatchFailure = {
      studyId: batch.studyId,
      section: batch.section,
      reason,
      detail,
    };
    batchFailures.push(failure);
    return failure;
  };
  const reportProgress = (batch: PlannedBatch, failure: BatchFailure | null = null): void => {
    completedBatches += 1;
    deps.onProgress?.({
      totalBatches: input.plan.batches.length,
      completedBatches,
      studyId: batch.studyId,
      section: batch.section,
      failure,
    });
  };

  // Evidence 書き込みのバッファ + フラッシュ（429 対策。バッチごとに即書きせず、
  // flushEveryNStudies study 分たまるか全 study 完了時にまとめて deps.appendEvidence する）。
  // 0 以下・小数を渡されても 1 以上の整数に丸める（maxConcurrency の丸めと同じ考え方）
  const flushEveryNStudies = Math.max(
    1,
    Math.floor(deps.flushEveryNStudies ?? DEFAULT_FLUSH_EVERY_N_STUDIES),
  );
  // 1 フラッシュあたりの行数上限（安全弁）。同じく 1 以上の整数に丸める
  const maxRowsPerFlush = Math.max(
    1,
    Math.floor(deps.maxRowsPerFlush ?? DEFAULT_MAX_ROWS_PER_FLUSH),
  );
  let buffer: PendingFlushItem[] = [];
  // 「フラッシュ中」を示すガード。null 以外なら誰かが既にフラッシュを実行中
  let flushPromise: Promise<void> | null = null;

  const distinctStudyCount = (items: readonly PendingFlushItem[]): number =>
    new Set(items.map((item) => item.batch.studyId)).size;
  const totalRowCount = (items: readonly PendingFlushItem[]): number =>
    items.reduce((sum, item) => sum + item.rows.length, 0);

  /**
   * バッファの中身を実際に Sheets へ書く。
   * 成功: rows を evidence へ積み、含まれる全バッチを成功として reportProgress する。
   * 失敗: 握りつぶさず、含まれる全バッチを save_failed の BatchFailure として記録・報告する
   *（S7 の再試行で拾えるようにする。automation bias 対策 = 保存できていないのに「済み」に見せない）
   */
  const performFlush = async (items: readonly PendingFlushItem[]): Promise<void> => {
    const rows = items.flatMap((item) => item.rows);
    try {
      await deps.appendEvidence(rows);
    } catch (err) {
      const detail = toDetail(err);
      for (const item of items) {
        reportProgress(item.batch, failBatch(item.batch, 'save_failed', detail));
      }
      return;
    }
    evidence.push(...rows);
    for (const item of items) {
      reportProgress(item.batch);
    }
  };

  /**
   * 閾値（flushEveryNStudies 件の study、または maxRowsPerFlush 行のどちらか先に達した方）に
   * 達していればバッファを drain してフラッシュする。既に他の呼び出しがフラッシュ中なら何もしない
   * （このタイミングで貯まっている分は、後続バッチの push が次回の閾値判定を行うか、全バッチ完了後の
   * flushRemaining で拾われる）。
   *
   * 行数キャップは「発火トリガー」であって、1 フラッシュを厳密に maxRowsPerFlush 行以下へ
   * 分割するものではない（1 study が maxRowsPerFlush 行を超えていても、その study 単位では
   * 割らない）。push のたびに毎回この条件を再評価するため、バッファは
   * 「キャップ + 直近に push された 1 study ぶん」程度で頭打ちになる
   *
   * 二重フラッシュ防止: 「flushPromise の確認 → buffer の drain → flushPromise のセット」は
   * 途中に await を挟まない同期区間で完結する（JS はシングルスレッドなので、この区間の途中に
   * 他の呼び出しが割り込むことはない）。そのため、複数バッチが同時に閾値到達を検知しても、
   * 実際に drain してフラッシュを開始できるのは必ず 1 呼び出しだけになる
   */
  const maybeFlush = async (): Promise<void> => {
    const thresholdReached =
      distinctStudyCount(buffer) >= flushEveryNStudies || totalRowCount(buffer) >= maxRowsPerFlush;
    if (flushPromise !== null || !thresholdReached) {
      return;
    }
    const toFlush = buffer;
    buffer = [];
    const promise = performFlush(toFlush).finally(() => {
      flushPromise = null;
    });
    flushPromise = promise;
    await promise;
  };

  /**
   * 全バッチ処理後の締めのフラッシュ（「全 study 完了時にまとめて書く」）。
   * processBatch は毎回 maybeFlush を await してから返るため（下記）、ここに来る時点で
   * 進行中のフラッシュは存在しない。閾値未満のまま run が終わった端数だけをここで書く
   */
  const flushRemaining = async (): Promise<void> => {
    if (buffer.length > 0) {
      const toFlush = buffer;
      buffer = [];
      await performFlush(toFlush);
    }
  };

  // 1 バッチ（= 1 study）の処理。共有アキュムレータ（evidence / tokens など）を書き込むが、
  // JS は単一スレッドなので各 await 間の同期ブロックは競合しない。加算・push は可換で、
  // 並行実行でも順不同なだけで結果は同値になる（modelVersion は「最初に取れた値」の非決定はあるが許容）
  const processBatch = async (batch: PlannedBatch): Promise<void> => {
    // study の全文書を document_index 順にロードする。ロードできた文書だけを連結対象にし、
    // その順序が document_index（1 始まり）になる。1 件もロードできなければバッチ失敗
    const resolved: ResolvedDocument[] = [];
    let firstLoadError: string | null = null;
    // 並行 miss を Promise キャッシュへ集約するため、全文書のロードを先にまとめて起票する
    const loadedList = await Promise.all(
      batch.documentIds.map((documentId) => loadDocument(documentId)),
    );
    batch.documentIds.forEach((documentId, index) => {
      const loaded = loadedList[index] as LoadedDocument;
      if (loaded.kind === 'ok') {
        const doc = documentById.get(documentId) as DocumentRecord;
        if (loaded.mode === 'image') {
          resolved.push({
            documentId,
            role: doc.documentRole,
            filename: doc.filename,
            mode: 'image',
            imagePages: loaded.imagePages,
          });
        } else if (loaded.mode === 'text_with_images') {
          resolved.push({
            documentId,
            role: doc.documentRole,
            filename: doc.filename,
            mode: 'text_with_images',
            pages: loaded.pages,
            normalizedPages: loaded.normalizedPages,
            imagePages: loaded.imagePages,
          });
        } else {
          resolved.push({
            documentId,
            role: doc.documentRole,
            filename: doc.filename,
            mode: 'text',
            pages: loaded.pages,
            normalizedPages: loaded.normalizedPages,
          });
        }
      } else {
        firstLoadError ??= loaded.detail;
      }
    });
    if (resolved.length === 0) {
      reportProgress(
        batch,
        failBatch(batch, 'load_failed', firstLoadError ?? '本文を取得できる文書がありません'),
      );
      return;
    }

    const batchFields = batch.fieldIds.map((fieldId) => fieldById.get(fieldId) as SchemaField);
    const promptDocuments: ExtractDataDocument[] = resolved.map((doc) => {
      if (doc.mode === 'image') {
        return { role: doc.role, filename: doc.filename, mode: 'image', imagePages: doc.imagePages };
      }
      if (doc.mode === 'text_with_images') {
        return {
          role: doc.role,
          filename: doc.filename,
          mode: 'text_with_images',
          pages: doc.pages,
          imagePages: doc.imagePages,
        };
      }
      return { role: doc.role, filename: doc.filename, mode: 'text', pages: doc.pages };
    });
    // box_2d（bbox）は Gemini 系 provider ＋ 画像入力文書を含むバッチのときだけ要求する
    // （handoff-scanned-pdf-native-highlight.md §7.4 PR3。OpenRouter 等の他 provider は
    // box grounding の可否が不明なため初期対象に含めない）
    const requestBox =
      deps.provider.providerId === 'gemini' && resolved.some((doc) => doc.mode === 'image');
    const messages: ChatMessage[] = [
      { role: 'system', content: buildExtractDataSystemPrompt(requestBox) },
      {
        role: 'user',
        content: buildExtractDataUserContent({
          fields: batchFields,
          documents: promptDocuments,
          protocolContext: input.protocolContext,
          requestBox,
        }),
      },
    ];

    let response: ChatResponse;
    try {
      response = await deps.provider.chat(messages, {
        temperature: EXTRACT_DATA_TEMPERATURE,
        responseSchema: extractDataResponseSchema(requestBox),
      });
    } catch (err) {
      reportProgress(batch, failBatch(batch, 'api_error', toDetail(err)));
      return;
    }
    tokensIn = addTokens(tokensIn, response.tokensIn);
    tokensOut = addTokens(tokensOut, response.tokensOut);
    modelVersion ??= extractModelVersion(response.raw);

    let validated: ValidateAiOutputResult;
    try {
      validated = parseExtractDataResponse(response.text, batchFields, resolved.length);
    } catch (err) {
      reportProgress(batch, failBatch(batch, 'format_error', toDetail(err)));
      return;
    }
    for (const item of validated.rejected) {
      rejectedItems.push({ ...item, studyId: batch.studyId, section: batch.section });
    }

    // arm completeness チェック（issue #106）: 応答内の自己整合（arm:n が出現するのに
    // 項目が揃っていない）+ ArmStructures 確定 arm との突合で欠落を機械検出する。
    // 「真の arm 数」は事前に既知でないため過検出（単群試験・正当な not_reported 等）の
    // リスクがあり、partial_failure には倒さず **warning に留める**（記録 + UI 表示のみ）
    const armWarning = detectArmCompletenessWarning({
      studyId: batch.studyId,
      section: batch.section,
      items: validated.items,
      fields: batchFields,
      confirmedArmKeys: input.confirmedArmKeysByStudy?.get(batch.studyId) ?? null,
    });
    if (armWarning !== null) {
      armWarnings.push(armWarning);
      try {
        await deps.recordArmWarning?.(armWarning);
      } catch {
        // 警告の外部記録（LLMApiLog）は補助的な監査記録のため、失敗しても run を止めない
      }
    }

    // document_index（1..resolved.length）が指す文書でアンカリングし、その documentId を Evidence に書く。
    // 画像入力（pdf_native）の文書にはテキスト層が無いため normalizedPages が無く、anchorStatus は null になる。
    // mode: 'text_with_images'（高精度読み取りモード。issue #176）は本文があるため通常どおり
    // normalizedPages でアンカリングする（bbox は対象外 = targetIsImage は 'image' のときだけ true）
    const rows = validated.items.map((item) => {
      const target = resolved[item.documentIndex - 1] as ResolvedDocument;
      return buildEvidenceRow(
        item,
        input.runId,
        batch.studyId,
        target.documentId,
        target.mode === 'image' ? null : target.normalizedPages,
        target.mode === 'image',
        uuid,
      );
    });
    if (rows.length === 0) {
      // 保存する行が無ければバッファに積まず、その場で成功として報告する
      reportProgress(batch);
      return;
    }
    // 実際の Sheets 書き込みはバッファへ貯めてまとめて行う（429 対策）。
    // 成功/失敗の reportProgress はフラッシュ確定後に行う（「保存できた」ことの通知にするため。
    // フラッシュ失敗時に「成功」を報告してしまうと study 単位進捗が誤って done になる）
    buffer.push({ batch, rows });
    await maybeFlush();
  };

  // maxConcurrency=1 なら逐次（従来と同一挙動 = 回帰の砦）、2 以上でバッチを並行実行する
  const concurrency = Math.max(1, Math.floor(deps.maxConcurrency ?? 1));
  await runWithConcurrency(input.plan.batches, concurrency, processBatch);
  // 全バッチ処理後、閾値未満のまま残っていた分をまとめて書く（全 study 完了時のフラッシュ）
  await flushRemaining();

  return {
    runId: input.runId,
    // arm completeness 警告（armWarnings）は status に影響させない（issue #106 の設計判断:
    // 過検出リスクを許容する warning に留め、partial_failure = 再試行対象とは区別する）
    status:
      batchFailures.length === 0 && rejectedItems.length === 0 ? 'done' : 'partial_failure',
    evidence,
    rejectedItems,
    batchFailures,
    armWarnings,
    tokensIn,
    tokensOut,
    modelVersion,
  };
}
