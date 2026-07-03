// LLMApiLog タブへの追記（requirements.md §3.2）。
// apiLogger（withLogging）の appendLogEntry 依存として注入する。
// フル payload は Drive（logs/llm/）側で、シートにはメタ情報 + 参照 URL のみを残す
import type { LlmApiLogEntry } from '../../domain/llmApiLog';
import { appendRow } from '../google/sheets';
import type { GoogleApiDeps } from '../google/types';

const LOG_TAB = 'LLMApiLog';

/** LlmApiLogEntry → シート行。列順は SHEET_HEADERS.LLMApiLog（domain/sheetsSchema.ts）に対応 */
export function logEntryToRow(entry: LlmApiLogEntry): (string | number | null)[] {
  return [
    entry.logId,
    entry.timestamp,
    entry.provider,
    entry.model,
    entry.purpose,
    entry.promptRef,
    entry.responseRef,
    entry.promptSummary,
    entry.tokensIn,
    entry.tokensOut,
    entry.latencyMs,
    entry.costEstimateUsd,
    entry.error,
  ];
}

export async function appendLlmApiLog(
  spreadsheetId: string,
  entry: LlmApiLogEntry,
  deps: GoogleApiDeps,
): Promise<void> {
  await appendRow(spreadsheetId, LOG_TAB, logEntryToRow(entry), deps);
}
