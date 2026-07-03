// 抽出実行（S6 パイロット / S7 一括 / 再抽出）のサービス層。
// planRun → executeRun（Evidence 追記込み）→ ai annotator 行への転記 →
// ExtractionRuns 追記、までを 1 関数に束ねる（requirements.md §4.3 / architecture.md §2）。
// LLM 呼び出しは withRetry(withLogging(createProvider(...))) で包み、
// 全呼び出し（リトライの各試行を含む）を LLMApiLog + Drive（logs/llm/）に残す
import type { ExtractionRun, RunType } from '../../domain/extractionRun';
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
 * 一括抽出を実行する。完了時に確定 status（done / partial_failure）で
 * ExtractionRuns へ 1 行追記し、Evidence の値を `ai` annotator 行へ転記する。
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
  });
  const provider = withRetry(
    withLogging(baseProvider, 'extract_document', {
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
  const result = await executeRun(
    { runId, plan, fields: params.fields, protocolContext: params.protocolContext },
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

  const run: ExtractionRun = {
    runId,
    runType: params.runType,
    schemaVersion: plan.schemaVersion,
    // 実際に実行対象となった文献（スキップ分は含めない。plan.skippedDocuments で追跡可能）
    documentIds: [...new Set(plan.batches.map((batch) => batch.documentId))],
    provider: baseProvider.providerId,
    requestedModel: params.model,
    modelVersion: result.modelVersion,
    inputMode: 'text_only', // MVP は text_only のみ（pdf_native は ※Q3）
    status: result.status,
    startedAt,
    finishedAt: now(),
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    costEstimate: plan.costEstimateUsd,
  };
  await appendExtractionRun(params.spreadsheetId, run, deps.google);

  return { run, plan, result };
}
