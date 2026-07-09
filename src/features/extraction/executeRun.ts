// 一括抽出（S7）の実行: planRun の計画を消費し、バッチごとに
// 「プロンプト構築 → LLM 呼び出し → 応答検証 → quote アンカリング → Evidence 生成」を回す
// （requirements.md §4.3 / architecture.md「実行・進捗・partial_failure 処理」）。
// - LLMApiLog への記録は withLogging 済み provider を注入することで賄う（lib/llm/apiLogger.ts）
// - バッチ失敗（API エラー / 応答形式不正 / 本文取得失敗 / 保存失敗）と要素破棄（validateAiOutput
//   の rejected）はどちらも partial_failure。失敗したバッチを飛ばして残りは続行する
// - ExtractionRuns 行の作成・status/tokens の書き込み、ai annotator 行への転記（§4.3）は
//   呼び出し側（サービス層）の責務。本関数は素材（ExecuteRunResult）を返すだけ
import type { NormalizedPage } from '../../domain/anchor';
import type { DocumentRecord } from '../../domain/document';
import type { Evidence } from '../../domain/evidence';
import type { RunStatus } from '../../domain/extractionRun';
import type { SchemaField } from '../../domain/schemaField';
import { LlmProviderError } from '../../lib/llm/LLMProvider';
import type { ChatMessage, ChatResponse, LLMProvider } from '../../lib/llm/LLMProvider';
import { generateUuid } from '../../utils/uuid';
import { anchorQuote } from '../anchoring/anchorQuote';
import { normalizeText } from '../anchoring/normalizeText';
import type { PlannedBatch, RunPlan } from './planRun';
import {
  EXTRACT_DATA_RESPONSE_SCHEMA,
  EXTRACT_DATA_SYSTEM_PROMPT,
  buildExtractDataUserPrompt,
  parseExtractDataResponse,
  type ExtractDataDocument,
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
  /** Evidence タブへの追記（追記型・上書き禁止）。バッチ単位で呼ばれる */
  appendEvidence: (rows: readonly Evidence[]) => Promise<void>;
  /** テスト時に差し替え可能な UUID 発番（evidence_id） */
  newUuid?: () => string;
  /** バッチ処理のたびに呼ばれる進捗通知（S7 の進捗表示用） */
  onProgress?: (progress: RunProgress) => void;
}

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
}

export interface ExecuteRunResult {
  runId: string;
  /** バッチ失敗・要素破棄が 1 件でもあれば partial_failure（§4.3） */
  status: Extract<RunStatus, 'done' | 'partial_failure'>;
  /** 保存済みの全 Evidence。ai annotator 行への転記（§4.3）の素材 */
  evidence: Evidence[];
  rejectedItems: RejectedBatchItem[];
  batchFailures: BatchFailure[];
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

/** 検証済み要素 → Evidence 行。quote があればこの時点でアンカリングを確定する（§5） */
function buildEvidenceRow(
  item: ValidatedAiItem,
  runId: string,
  studyId: string,
  documentId: string,
  normalizedPages: NormalizedPage[],
  uuid: () => string,
): Evidence {
  const anchorStatus =
    item.quote === null
      ? null
      : anchorQuote(normalizeText(item.quote), normalizedPages, item.page).status;
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
  };
}

/** 文献本文のロード結果（document 単位で 1 回だけロードし、study / バッチ間で使い回す） */
type LoadedDocument =
  | { kind: 'ok'; pages: ExtractDataPage[]; normalizedPages: NormalizedPage[] }
  | { kind: 'error'; detail: string };

/** 連結対象として実際にロードできた 1 文書（document_index 順に並ぶ） */
interface ResolvedDocument {
  documentId: string;
  role: ExtractDataDocument['role'];
  filename: string;
  pages: ExtractDataPage[];
  normalizedPages: NormalizedPage[];
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

  const uuid = deps.newUuid ?? generateUuid;
  const evidence: Evidence[] = [];
  const rejectedItems: RejectedBatchItem[] = [];
  const batchFailures: BatchFailure[] = [];
  const loadedDocuments = new Map<string, LoadedDocument>();
  let tokensIn: number | null = null;
  let tokensOut: number | null = null;
  let modelVersion: string | null = null;
  let completedBatches = 0;

  /** 1 文書を（未ロードなら）ロードしてキャッシュする */
  const loadDocument = async (documentId: string): Promise<LoadedDocument> => {
    const cached = loadedDocuments.get(documentId);
    if (cached !== undefined) {
      return cached;
    }
    let loaded: LoadedDocument;
    try {
      const pages = await deps.loadDocumentPages(documentId);
      loaded =
        pages.length === 0
          ? { kind: 'error', detail: '本文ページが 0 件です（extracted_texts の取得結果が空）' }
          : {
              kind: 'ok',
              pages,
              normalizedPages: pages.map((page) => ({
                page: page.page,
                text: normalizeText(page.text),
              })),
            };
    } catch (err) {
      loaded = { kind: 'error', detail: toDetail(err) };
    }
    loadedDocuments.set(documentId, loaded);
    return loaded;
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

  for (const batch of input.plan.batches) {
    // study の全文書を document_index 順にロードする。ロードできた文書だけを連結対象にし、
    // その順序が document_index（1 始まり）になる。1 件もロードできなければバッチ失敗
    const resolved: ResolvedDocument[] = [];
    let firstLoadError: string | null = null;
    for (const documentId of batch.documentIds) {
      const loaded = await loadDocument(documentId);
      if (loaded.kind === 'ok') {
        const doc = documentById.get(documentId) as DocumentRecord;
        resolved.push({
          documentId,
          role: doc.documentRole,
          filename: doc.filename,
          pages: loaded.pages,
          normalizedPages: loaded.normalizedPages,
        });
      } else {
        firstLoadError ??= loaded.detail;
      }
    }
    if (resolved.length === 0) {
      reportProgress(
        batch,
        failBatch(batch, 'load_failed', firstLoadError ?? '本文を取得できる文書がありません'),
      );
      continue;
    }

    const batchFields = batch.fieldIds.map((fieldId) => fieldById.get(fieldId) as SchemaField);
    const promptDocuments: ExtractDataDocument[] = resolved.map((doc) => ({
      role: doc.role,
      filename: doc.filename,
      pages: doc.pages,
    }));
    const messages: ChatMessage[] = [
      { role: 'system', content: EXTRACT_DATA_SYSTEM_PROMPT },
      {
        role: 'user',
        content: buildExtractDataUserPrompt({
          fields: batchFields,
          documents: promptDocuments,
          protocolContext: input.protocolContext,
        }),
      },
    ];

    let response: ChatResponse;
    try {
      response = await deps.provider.chat(messages, {
        temperature: EXTRACT_DATA_TEMPERATURE,
        responseSchema: EXTRACT_DATA_RESPONSE_SCHEMA,
      });
    } catch (err) {
      reportProgress(batch, failBatch(batch, 'api_error', toDetail(err)));
      continue;
    }
    tokensIn = addTokens(tokensIn, response.tokensIn);
    tokensOut = addTokens(tokensOut, response.tokensOut);
    modelVersion ??= extractModelVersion(response.raw);

    let validated: ValidateAiOutputResult;
    try {
      validated = parseExtractDataResponse(response.text, batchFields, resolved.length);
    } catch (err) {
      reportProgress(batch, failBatch(batch, 'format_error', toDetail(err)));
      continue;
    }
    for (const item of validated.rejected) {
      rejectedItems.push({ ...item, studyId: batch.studyId, section: batch.section });
    }

    // document_index（1..resolved.length）が指す文書でアンカリングし、その documentId を Evidence に書く
    const rows = validated.items.map((item) => {
      const target = resolved[item.documentIndex - 1] as ResolvedDocument;
      return buildEvidenceRow(
        item,
        input.runId,
        batch.studyId,
        target.documentId,
        target.normalizedPages,
        uuid,
      );
    });
    if (rows.length > 0) {
      try {
        await deps.appendEvidence(rows);
      } catch (err) {
        reportProgress(batch, failBatch(batch, 'save_failed', toDetail(err)));
        continue;
      }
      evidence.push(...rows);
    }
    reportProgress(batch);
  }

  return {
    runId: input.runId,
    status:
      batchFailures.length === 0 && rejectedItems.length === 0 ? 'done' : 'partial_failure',
    evidence,
    rejectedItems,
    batchFailures,
    tokensIn,
    tokensOut,
    modelVersion,
  };
}
