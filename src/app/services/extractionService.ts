// 抽出実行（S6 パイロット / S7 一括 / 再抽出）のサービス層。
// planRun → ExtractionRuns へ running 行を先行追記 → executeRun（Evidence 追記込み）→
// ai annotator 行への転記 → ExtractionRuns へ完了行を追記、までを 1 関数に束ねる
// （requirements.md §4.3 / architecture.md §2）。
// running 行を Evidence より先に書くことで「Evidence の run_id は必ず ExtractionRuns で
// 解決できる」不変条件を守る（途中で実行が死んでも running 行が残り、中断として検出できる）。
// LLM 呼び出しは withRetry(withLogging(createProvider(...))) で包み、
// 全呼び出し（リトライの各試行を含む）を LLMApiLog + Drive（logs/llm/）に残す
// Evidence の Sheets 書き込みは executeRun 側で N study ごと（+ 行数キャップ）にまとめられる
// （429 対策）。flushEveryNStudies は本サービス層から executeRun へ注入する。
// 値は tier 連動（レート制限ポリシーの flushEveryNStudies）を優先し、
// 未解決時のみ DEFAULT_FLUSH_EVERY_N_STUDIES へフォールバックする
// （docs/handoff-20260710-sheets-write-batching.md）
import type { ExtractionRun, RunType } from '../../domain/extractionRun';
import type { LlmProviderId } from '../../domain/llmApiLog';
import type { DocumentRecord } from '../../domain/document';
import type { SchemaField } from '../../domain/schemaField';
import { buildAiAnnotationRows } from '../../features/extraction/aiAnnotationRows';
import {
  upsertResultsDataRows,
  upsertStudyDataRows,
} from '../../features/extraction/annotationRepository';
import {
  confirmedArmKeysByStudy,
  describeArmCompletenessWarning,
} from '../../features/extraction/armCompleteness';
import {
  appendEvidenceRows,
  ensureEvidenceBboxColumns,
} from '../../features/extraction/evidenceRepository';
import {
  DEFAULT_FLUSH_EVERY_N_STUDIES,
  executeRun,
  type ExecuteRunResult,
  type RunProgress,
} from '../../features/extraction/executeRun';
import { planRun, type RunPlan, type RunTokenBudget } from '../../features/extraction/planRun';
import {
  appendExtractionRun,
  ensureRunOptionalColumns,
} from '../../features/extraction/runRepository';
import { readAllArmStructures } from '../../features/verification/armStructureRepository';
import {
  EXTRACT_DATA_PROMPT_VERSION,
  type ExtractDataImagePage,
  type ExtractDataPage,
} from '../../features/extraction/skills/extractData';
import { uploadTextFile } from '../../lib/google/drive';
import type { GoogleApiDeps } from '../../lib/google/types';
import { appendLlmApiLog } from '../../lib/llm/apiLogRepository';
import { withLogging } from '../../lib/llm/apiLogger';
import type { LLMProvider } from '../../lib/llm/LLMProvider';
import { createProvider, type ProviderConfig } from '../../lib/llm/providerFactory';
import {
  applyRateLimitPolicy,
  UNLIMITED_POLICY,
  type RateLimitClockDeps,
  type RateLimitPolicy,
} from '../../lib/llm/rateLimitPolicy';
import { nowIso8601 } from '../../utils/iso8601';
import { generateUuid } from '../../utils/uuid';

export interface ExtractionServiceDeps {
  google: GoogleApiDeps;
  /** BYOK の API キー（secretsStore から呼び出し側が解決して渡す） */
  apiKey: string;
  /** 明示設定時の接続方式。未指定は従来どおりモデル ID から解決 */
  provider?: LlmProviderId;
  /** OpenAI 互換 API の完全 URL */
  endpoint?: string;
  /**
   * extracted_texts/{document_id}.txt を読み、ページ別テキストへ復元する。
   * テキストファイルの保存形式は S3（文献取り込み）実装側で確定するため、ここでは注入に留める
   */
  loadDocumentPages: (documentId: string) => Promise<ExtractDataPage[]>;
  /**
   * no_text_layer 文書のページ画像を読み込む（pdf_native。
   * handoff-scanned-pdf-native-highlight.md §7.4 PR2）。呼び出し側（pilotService /
   * extractService）が features/documents/loadDocumentPageImages.ts の
   * makeLoadDocumentPageImages で注入する。テキストのみの対象文献では executeRun 側が呼ばない
   */
  loadDocumentPageImages: (documentId: string) => Promise<ExtractDataImagePage[]>;
  /** テスト時に差し替え可能な provider 生成（既定は lib/llm/providerFactory.createProvider） */
  buildProvider?: (config: ProviderConfig) => LLMProvider;
  /**
   * 実効レート制限ポリシー（429 対策のスロットル + リトライ）を解決する。
   * 未注入なら UNLIMITED_POLICY（従来挙動: スロットル無し・リトライのみ）。
   * 本番は bootstrap が settingsStore.resolveRateLimitPolicy を注入する
   */
  resolveRateLimitPolicy?: () => Promise<RateLimitPolicy>;
  /** テスト時に throttle / retry のタイマーを仮想クロックへ差し替える */
  rateLimitClock?: RateLimitClockDeps;
  /** テスト時に差し替え可能な UUID 発番 / 現在時刻 */
  newUuid?: () => string;
  now?: () => string;
  /**
   * Evidence の書き込みを何 study ごとにまとめて Sheets へ appendEvidence するか
   * （429 対策。省略時は resolveRateLimitPolicy が解決した RateLimitPolicy.flushEveryNStudies
   * （tier 連動）を使い、それも無ければ DEFAULT_FLUSH_EVERY_N_STUDIES = 5。
   * ここで明示注入すればどちらより優先される（主にテスト用）。executeRun.ts へそのまま渡す。
   * docs/handoff-20260710-sheets-write-batching.md）
   */
  flushEveryNStudies?: number;
}

export interface RunExtractionParams {
  spreadsheetId: string;
  /** logs/llm フォルダの Drive ID（LLMApiLog のフル payload 保存先） */
  logsLlmFolderId: string;
  runType: RunType;
  /**
   * 抽出対象の文献（テキスト層なしは pdf_native の画像入力として扱われる。
   * §7.4 PR2。除外はされず、その旨は plan.warnings に出る）
   */
  documents: readonly DocumentRecord[];
  /** 当該 schema_version の抽出項目 */
  fields: readonly SchemaField[];
  /** requested_model（既定モデルはベンチマーク確定まで固定しない。Q8） */
  model: string;
  protocolContext?: string | null;
  budget?: Partial<RunTokenBudget>;
  /**
   * run 単位のフィールド選択（issue #80 案 A）。**null = 全項目**（後方互換規約）。
   * 呼び出し側が「選択 = 版の全項目」のときも null を渡す（空配列は使わない）。
   * ExtractionRuns の running 行・完了行の両方に記録するのみで、本関数自身は
   * この値で params.fields を絞り込まない（絞り込み済みの fields を渡す設計は呼び出し側の責務。
   * フェーズ 1 時点では UI 未結線のため全呼び出し元が null を渡す）
   */
  fieldIds: string[] | null;
  /**
   * 高精度読み取りモード（issue #176）。true にすると、テキスト層のある文書にもページ画像を
   * 併用添付する（`input_mode = text_with_page_images`。トークン消費量が大幅に増える）。
   * 既定 false（省略時）= 既存の text_only / pdf_native 挙動を一切変えない。
   * S6 / S7 の run 単位トグルから渡す（呼び出し側 = pilotService / extractService）
   */
  highAccuracyImages?: boolean;
  /** S7 の進捗バー用コールバック */
  onProgress?: (progress: RunProgress) => void;
}

export interface RunExtractionOutcome {
  /** ExtractionRuns へ追記済みの行 */
  run: ExtractionRun;
  /** 実行に使った計画（コスト概算・入力形式・warnings を含む） */
  plan: RunPlan;
  /** バッチ失敗・要素破棄の内訳と保存済み Evidence（S7 の結果表示用） */
  result: ExecuteRunResult;
}

/**
 * 一括抽出を実行する。開始時に status='running'、完了時に確定 status
 * （done / partial_failure）の 2 行を同じ run_id で ExtractionRuns へ追記し
 * （2 行プロトコル。§4.3）、Evidence の値を `ai` annotator 行へ転記する。
 *
 * 事前のコスト概算だけが必要な場合（実行確認 UI）は planRun を直接使う。
 * 本関数は内部で再計画するため、確認画面の概算と実行時の計画は同一入力なら一致する
 */
export async function runExtraction(
  params: RunExtractionParams,
  deps: ExtractionServiceDeps,
): Promise<RunExtractionOutcome> {
  const uuid = deps.newUuid ?? generateUuid;
  const now = deps.now ?? nowIso8601;

  // no_text_layer 文書も pdf_native（画像入力）としてバッチ化されるため、
  // documents / fields が 1 件以上であれば plan.batches は必ず 1 件以上になる
  // （空ならその時点で planRun 自身が throw する。§7.4 PR2 で「全文献対象外」の分岐は解消済み）
  const plan = planRun({
    documents: params.documents,
    fields: params.fields,
    model: params.model,
    protocolContext: params.protocolContext,
    budget: params.budget,
    highAccuracyImages: params.highAccuracyImages,
  });

  const baseProvider = (deps.buildProvider ?? createProvider)({
    apiKey: deps.apiKey,
    model: params.model,
    provider: deps.provider,
    endpoint: deps.endpoint,
  });
  // 429 対策: レート制限ポリシーに従い withRetry(withThrottle(withLogging(...))) で包む。
  // throttle が RPM 間隔でバッチ連射を間引き、retry が 429/5xx を（サーバ提示の retryDelay も
  // 尊重して）指数バックオフで再送する（docs/requirements.md §4.3）
  const policy = await (deps.resolveRateLimitPolicy ?? (async () => UNLIMITED_POLICY))();
  const provider = applyRateLimitPolicy(
    withLogging(baseProvider, 'extract_study', {
      uploadJson: async ({ filename, content }) => {
        const file = await uploadTextFile(
          {
            name: filename,
            content,
            parentId: params.logsLlmFolderId,
            mimeType: 'application/json',
          },
          deps.google,
        );
        return { webViewLink: file.webViewLink };
      },
      appendLogEntry: (entry) => appendLlmApiLog(params.spreadsheetId, entry, deps.google),
      promptVersion: EXTRACT_DATA_PROMPT_VERSION,
      newUuid: deps.newUuid,
      now: deps.now,
    }),
    policy,
    deps.rateLimitClock,
  );

  const runId = uuid();
  const startedAt = now();
  // 実際に実行対象となる study（1 バッチ = 1 study だが section 分割で同一 study が
  // 複数バッチになりうるため一意化する）。no_text_layer 文書もページ画像で抽出対象になる
  // ため除外されない（pdf_native。handoff-scanned-pdf-native-highlight.md §7.4 PR2）
  const studyIds = [...new Set(plan.batches.map((batch) => batch.studyId))];
  const runBase = {
    runId,
    runType: params.runType,
    schemaVersion: plan.schemaVersion,
    studyIds,
    provider: baseProvider.providerId,
    requestedModel: params.model,
    // planRun が判定した入力形式（image 文書を含めば pdf_native。§7.4 PR2）
    inputMode: plan.inputMode,
    startedAt,
    costEstimate: plan.costEstimateUsd,
    fieldIds: params.fieldIds,
  };
  // Evidence タブのヘッダを bbox 5 列込みへ拡張する（既存プロジェクトの後方互換移行。
  // §7.4 PR3）。running 行より前に行う: これを怠ると旧ヘッダ（12 列）のまま
  // appendEvidenceRows が 17 列を追記してしまい、列がずれた壊れた行になる
  await ensureEvidenceBboxColumns(params.spreadsheetId, deps.google);
  // ExtractionRuns タブのヘッダを field_ids / warnings 込みへ拡張する（既存プロジェクトの
  // 後方互換移行。issue #80 / #106）。running 行より前に行う
  // （bbox 列と同じ理由: 怠ると旧ヘッダのまま列がずれる）
  await ensureRunOptionalColumns(params.spreadsheetId, deps.google);

  // arm completeness 警告（issue #106）の説明文用: field_id → field_name の解決表
  const fieldNameById = new Map(params.fields.map((field) => [field.fieldId, field.fieldName]));
  // arm completeness チェック（issue #106）の突合素材: ArmStructures 確定済み study の
  // arm キー一覧。warning 専用の補助情報のため、読み出しに失敗しても run は止めず
  // 「確定なし」（応答内の自己整合のみでチェック）として続行する
  let confirmedArmKeys: Map<string, string[]> | undefined;
  try {
    confirmedArmKeys = confirmedArmKeysByStudy(
      await readAllArmStructures(params.spreadsheetId, deps.google),
    );
  } catch {
    confirmedArmKeys = undefined;
  }

  // running 行の先行追記（2 行プロトコルの 1 行目）。この追記が失敗したら
  // Evidence を 1 行も書かずに中断するため、孤児 Evidence は生まれない
  await appendExtractionRun(
    params.spreadsheetId,
    {
      ...runBase,
      modelVersion: null,
      status: 'running',
      finishedAt: null,
      tokensIn: null,
      tokensOut: null,
      warnings: null,
    },
    deps.google,
  );

  const result = await executeRun(
    {
      runId,
      plan,
      fields: params.fields,
      documents: params.documents,
      protocolContext: params.protocolContext,
      confirmedArmKeysByStudy: confirmedArmKeys,
    },
    {
      provider,
      loadDocumentPages: deps.loadDocumentPages,
      loadDocumentPageImages: deps.loadDocumentPageImages,
      appendEvidence: (rows) => appendEvidenceRows(params.spreadsheetId, rows, deps.google),
      newUuid: deps.newUuid,
      onProgress: params.onProgress,
      // 並列化のスループット対策: ポリシーの同時実行数でバッチを並行させる（既定 1 = 逐次）
      maxConcurrency: policy.maxConcurrency,
      // Sheets 書き込みの 429 対策: N study ごと + 全 study 完了時にまとめて appendEvidence する。
      // 優先順は 明示注入（deps.flushEveryNStudies）> tier のポリシー値 > 最終フォールバック
      flushEveryNStudies:
        deps.flushEveryNStudies ?? policy.flushEveryNStudies ?? DEFAULT_FLUSH_EVERY_N_STUDIES,
      // arm completeness 警告（issue #106）を LLMApiLog へも残す（エラー列に「警告」明記。
      // フル payload は無い = prompt_ref / response_ref は空。監査時の一次手掛かり用）
      recordArmWarning: (warning) =>
        appendLlmApiLog(
          params.spreadsheetId,
          {
            logId: uuid(),
            timestamp: now(),
            provider: baseProvider.providerId,
            model: params.model,
            purpose: 'extract_study',
            promptRef: '',
            responseRef: '',
            promptSummary: `[arm_completeness] run ${runId}`,
            tokensIn: null,
            tokensOut: null,
            latencyMs: null,
            costEstimateUsd: null,
            error: `警告（arm_completeness）: ${describeArmCompletenessWarning(warning, fieldNameById)}`,
          },
          deps.google,
        ),
    },
  );

  // ai annotator 行への転記（§4.3）。Evidence は executeRun 内で保存済み
  const transfer = buildAiAnnotationRows(result.evidence, params.fields, {
    runId,
    schemaVersion: plan.schemaVersion,
    updatedAt: now(),
  });
  await upsertStudyDataRows(params.spreadsheetId, transfer.studyRows, deps.google);
  await upsertResultsDataRows(params.spreadsheetId, transfer.resultsRows, deps.google, {
    newUuid: deps.newUuid,
  });

  // 完了行の追記（2 行プロトコルの 2 行目。読み手はこの行の有無で完了 / 中断を判別する）
  const run: ExtractionRun = {
    ...runBase,
    modelVersion: result.modelVersion,
    status: result.status,
    finishedAt: now(),
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    // arm completeness 警告（issue #106）は完了行にのみ記録する（null = 警告なし）
    warnings: result.armWarnings.length === 0 ? null : result.armWarnings,
  };
  try {
    await appendExtractionRun(params.spreadsheetId, run, deps.google);
  } catch (err) {
    if (run.warnings === null) {
      throw err;
    }
    // warnings 付きの完了行が書けない場合（想定外のセルサイズ超過等）は warnings なしで
    // 1 回だけ再試行する。完了行が書けないと run 全体が「中断」扱いへ転落し flush 済み
    // Evidence が S8/S9 から不可視化されるため、「警告の記録失敗で run を止めない」方針の
    // 最終安全弁として完了行の成立を優先する（issue #106 レビュー対応。
    // 通常サイズは runRepository.warningsToCell の切り詰めで収まる）
    const fallback: ExtractionRun = { ...run, warnings: null };
    await appendExtractionRun(params.spreadsheetId, fallback, deps.google);
    return { run: fallback, plan, result };
  }

  return { run, plan, result };
}
