// 一括抽出（S7）の実行: planRun の計画を消費し、バッチごとに
// 「プロンプト構築 → LLM 呼び出し → 応答検証 → quote アンカリング → Evidence 生成」を回す
// （requirements.md §4.3 / architecture.md「実行・進捗・partial_failure 処理」）。
// - LLMApiLog への記録は withLogging 済み provider を注入することで賄う（lib/llm/apiLogger.ts）
// - バッチ失敗（API エラー / 応答形式不正 / 本文取得失敗 / 保存失敗）と要素破棄（validateAiOutput
//   の rejected）はどちらも partial_failure。失敗したバッチを飛ばして残りは続行する
// - ExtractionRuns 行の作成・status/tokens の書き込み、ai annotator 行への転記（§4.3）は
//   呼び出し側（サービス層）の責務。本関数は素材（ExecuteRunResult）を返すだけ
import type { NormalizedPage } from '../../domain/anchor';
import type { Evidence } from '../../domain/evidence';
import type { RunStatus } from '../../domain/extractionRun';
import type { SchemaField } from '../../domain/schemaField';
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
  documentId: string;
  section: string | null;
  reason: BatchFailureReason;
  detail: string;
}

/** validateAiOutput が破棄した要素に、どのバッチ由来かを付与したもの */
export interface RejectedBatchItem extends RejectedAiItem {
  documentId: string;
  section: string | null;
}

export interface RunProgress {
  totalBatches: number;
  /** 処理済みバッチ数（失敗したバッチも数える） */
  completedBatches: number;
  /** 直近に処理したバッチ */
  documentId: string;
  section: string | null;
  /** 直近のバッチが失敗していればその内訳（S7 の document 単位進捗リストの素材）。成功なら null */
  failure: BatchFailure | null;
}

export interface ExecuteRunDeps {
  /** withRetry / withLogging（purpose: extract_document）で包んだ provider を注入する */
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

function toDetail(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 検証済み要素 → Evidence 行。quote があればこの時点でアンカリングを確定する（§5） */
function buildEvidenceRow(
  item: ValidatedAiItem,
  runId: string,
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

/** 文献本文のロード結果（document 単位で 1 回だけロードし、バッチ間で使い回す） */
type LoadedDocument =
  | { kind: 'ok'; pages: ExtractDataPage[]; normalizedPages: NormalizedPage[] }
  | { kind: 'error'; detail: string };

export async function executeRun(
  input: ExecuteRunInput,
  deps: ExecuteRunDeps,
): Promise<ExecuteRunResult> {
  // 契約検証: plan と fields の対応が取れない呼び出しはバグなので実行前に throw
  if (input.fields.some((field) => field.schemaVersion !== input.plan.schemaVersion)) {
    throw new Error('executeRun に plan と異なる schema_version の項目が渡されています');
  }
  const fieldById = new Map(input.fields.map((field) => [field.fieldId, field]));
  for (const batch of input.plan.batches) {
    for (const fieldId of batch.fieldIds) {
      if (!fieldById.has(fieldId)) {
        throw new Error(`plan の field_id "${fieldId}" が fields に見つかりません`);
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

  const failBatch = (batch: PlannedBatch, reason: BatchFailureReason, detail: string): BatchFailure => {
    const failure: BatchFailure = {
      documentId: batch.documentId,
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
      documentId: batch.documentId,
      section: batch.section,
      failure,
    });
  };

  for (const batch of input.plan.batches) {
    let loaded = loadedDocuments.get(batch.documentId);
    if (loaded === undefined) {
      try {
        const pages = await deps.loadDocumentPages(batch.documentId);
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
      loadedDocuments.set(batch.documentId, loaded);
    }
    if (loaded.kind === 'error') {
      reportProgress(batch, failBatch(batch, 'load_failed', loaded.detail));
      continue;
    }

    const batchFields = batch.fieldIds.map((fieldId) => fieldById.get(fieldId) as SchemaField);
    const messages: ChatMessage[] = [
      { role: 'system', content: EXTRACT_DATA_SYSTEM_PROMPT },
      {
        role: 'user',
        content: buildExtractDataUserPrompt({
          fields: batchFields,
          pages: loaded.pages,
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
      validated = parseExtractDataResponse(response.text, batchFields);
    } catch (err) {
      reportProgress(batch, failBatch(batch, 'format_error', toDetail(err)));
      continue;
    }
    for (const item of validated.rejected) {
      rejectedItems.push({ ...item, documentId: batch.documentId, section: batch.section });
    }

    const rows = validated.items.map((item) =>
      buildEvidenceRow(item, input.runId, batch.documentId, loaded.normalizedPages, uuid),
    );
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
