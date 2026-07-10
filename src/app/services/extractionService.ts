// 抽出実行（S6 パイロット / S7 一括 / 再抽出）のサービス層。
// planRun → ExtractionRuns へ running 行を先行追記 → executeRun（Evidence 追記込み）→
// ai annotator 行への転記 → ExtractionRuns へ完了行を追記、までを 1 関数に束ねる
// （requirements.md §4.3 / architecture.md §2）。
// running 行を Evidence より先に書くことで「Evidence の run_id は必ず ExtractionRuns で
// 解決できる」不変条件を守る（途中で実行が死んでも running 行が残り、中断として検出できる）。
// LLM 呼び出しは withRetry(withLogging(createProvider(...))) で包み、
// 全呼び出し（リトライの各試行を含む）を LLMApiLog + Drive（logs/llm/）に残す
import type { ExtractionRun, RunType } from '../../domain/extractionRun';
import type { LlmProviderId } from '../../domain/llmApiLog';
import type { DocumentRecord } from '../../domain/document';
import type { SchemaField } from '../../domain/schemaField';
import { buildAiAnnotationRows } from '../../features/extraction/aiAnnotationRows';
import {
  upsertResultsDataRows,
  upsertStudyDataRows,
} from '../../features/extraction/annotationRepository';
import { appendEvidenceRows } from '../../features/extraction/evidenceRepository';
import {
  executeRun,
  type ExecuteRunResult,
  type RunProgress,
} from '../../features/extraction/executeRun';
import { planRun, type RunPlan, type RunTokenBudget } from '../../features/extraction/planRun';
import { appendExtractionRun } from '../../features/extraction/runRepository';
import {
  EXTRACT_DATA_PROMPT_VERSION,
  type ExtractDataPage,
} from '../../features/extraction/skills/extractData';
import { uploadTextFile } from '../../lib/google/drive';
import type { GoogleApiDeps } from '../../lib/google/types';
import { appendLlmApiLog } from '../../lib/llm/apiLogRepository';
import { withLogging } from '../../lib/llm/apiLogger';
import type { LLMProvider } from '../../lib/llm/LLMProvider';
import { createProvider, type ProviderConfig } from '../../lib/llm/providerFactory';
import { withRetry } from '../../lib/llm/retry';
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
  /** テスト時に差し替え可能な provider 生成（既定は lib/llm/providerFactory.createProvider） */
  buildProvider?: (config: ProviderConfig) => LLMProvider;
  /** テスト時に差し替え可能な UUID 発番 / 現在時刻 */
  newUuid?: () => string;
  now?: () => string;
}

export interface RunExtractionParams {
  spreadsheetId: string;
  /** logs/llm フォルダの Drive ID（LLMApiLog のフル payload 保存先） */
  logsLlmFolderId: string;
  runType: RunType;
  /** 抽出対象の文献（テキスト層なしは planRun がスキップし warnings に出す） */
  documents: readonly DocumentRecord[];
  /** 当該 schema_version の抽出項目 */
  fields: readonly SchemaField[];
  /** requested_model（既定モデルはベンチマーク確定まで固定しない。Q8） */
  model: string;
  protocolContext?: string | null;
  budget?: Partial<RunTokenBudget>;
  /** S7 の進捗バー用コールバック */
  onProgress?: (progress: RunProgress) => void;
}

export interface RunExtractionOutcome {
  /** ExtractionRuns へ追記済みの行 */
  run: ExtractionRun;
  /** 実行に使った計画（コスト概算・スキップ文献・warnings を含む） */
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

  const plan = planRun({
    documents: params.documents,
    fields: params.fields,
    model: params.model,
    protocolContext: params.protocolContext,
    budget: params.budget,
  });
  if (plan.batches.length === 0) {
    throw new Error(
      '抽出できる文献がありません（対象文献がすべてテキスト層なしでスキップされました）',
    );
  }

  const baseProvider = (deps.buildProvider ?? createProvider)({
    apiKey: deps.apiKey,
    model: params.model,
    provider: deps.provider,
    endpoint: deps.endpoint,
  });
  const provider = withRetry(
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
  );

  const runId = uuid();
  const startedAt = now();
  // 実際に実行対象となる study（全文書テキスト層なしで除外された study は含めない。
  // 除外文書は plan.skippedDocuments で追跡可能）。1 バッチ = 1 study だが section 分割で
  // 同一 study が複数バッチになりうるため一意化する
  const studyIds = [...new Set(plan.batches.map((batch) => batch.studyId))];
  const runBase = {
    runId,
    runType: params.runType,
    schemaVersion: plan.schemaVersion,
    studyIds,
    provider: baseProvider.providerId,
    requestedModel: params.model,
    inputMode: 'text_only' as const, // MVP は text_only のみ（pdf_native は ※Q3）
    startedAt,
    costEstimate: plan.costEstimateUsd,
  };
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
    },
    {
      provider,
      loadDocumentPages: deps.loadDocumentPages,
      appendEvidence: (rows) => appendEvidenceRows(params.spreadsheetId, rows, deps.google),
      newUuid: deps.newUuid,
      onProgress: params.onProgress,
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
  };
  await appendExtractionRun(params.spreadsheetId, run, deps.google);

  return { run, plan, result };
}
