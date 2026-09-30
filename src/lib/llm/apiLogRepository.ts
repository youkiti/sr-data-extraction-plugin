// LLMApiLog タブへの追記（requirements.md §3.2）。
// apiLogger（withLogging）の appendLogEntry 依存として注入する。
// フル payload は Drive（logs/llm/）側で、シートにはメタ情報 + 参照 URL のみを残す
import type { LlmApiLogEntry } from '../../domain/llmApiLog';
import { SHEET_HEADERS } from '../../domain/sheetsSchema';
import { appendRow, getBatchValues, getSheetValues, updateRow } from '../google/sheets';
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
    entry.cachedTokensIn,
    entry.runId,
    entry.studyId,
    entry.section,
    entry.promptVersion,
    entry.thoughtsTokensOut,
  ];
}

export async function appendLlmApiLog(
  spreadsheetId: string,
  entry: LlmApiLogEntry,
  deps: GoogleApiDeps,
): Promise<void> {
  await appendRow(spreadsheetId, LOG_TAB, logEntryToRow(entry), deps);
}

/** 先頭 13 列を検証し、後付け列の欠けたヘッダだけを拡張する（旧行は変更しない）。 */
export async function ensureLlmApiLogColumns(
  spreadsheetId: string,
  deps: GoogleApiDeps,
): Promise<void> {
  const [headerRows] = await getBatchValues(spreadsheetId, [`${LOG_TAB}!1:1`], deps);
  const header = headerRows?.[0] ?? [];
  SHEET_HEADERS.LLMApiLog.slice(0, 13).forEach((name, i) => {
    if (header[i] !== undefined && header[i] !== null && header[i] !== '' && header[i] !== name) {
      throw new Error(
        `LLMApiLog のヘッダ ${i + 1} 列目が "${name}" ではありません（実際: "${header[i]}"）。任意列の移行を中止します`,
      );
    }
  });
  if (
    header.length >= SHEET_HEADERS.LLMApiLog.length &&
    SHEET_HEADERS.LLMApiLog.slice(0, 13).every((name, i) => header[i] === name)
  ) {
    return;
  }
  await updateRow(spreadsheetId, LOG_TAB, 1, [...SHEET_HEADERS.LLMApiLog], deps);
}

/** 空セル・欠落セルは null とする。 */
function nullableCell(cell: string | null | undefined): string | null {
  return cell === undefined || cell === null || cell === '' ? null : cell;
}

/** 数値セルは Number で読む。空セル・有限数にならない値は不明として残す。 */
function numericCell(cell: string | null | undefined): number | null {
  const value = nullableCell(cell);
  if (value === null) {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * 行は logEntryToRow と同じ列位置で読む（旧ヘッダが 13 / 14 列でも追記行は広がり得る）。
 * provider / purpose の未知の値もそのまま保持する。union へのキャストは検証ではない。
 */
export async function readLlmApiLogEntries(
  spreadsheetId: string,
  deps: GoogleApiDeps,
): Promise<LlmApiLogEntry[]> {
  const rows = await getSheetValues(spreadsheetId, LOG_TAB, deps);
  return rows
    .slice(1)
    .filter((row) => row.some((cell) => nullableCell(cell) !== null))
    .map((row) => ({
      logId: row[0] ?? '',
      timestamp: row[1] ?? '',
      provider: (row[2] ?? '') as LlmApiLogEntry['provider'],
      model: row[3] ?? '',
      purpose: (row[4] ?? '') as LlmApiLogEntry['purpose'],
      promptRef: row[5] ?? '',
      responseRef: row[6] ?? '',
      promptSummary: nullableCell(row[7]),
      tokensIn: numericCell(row[8]),
      tokensOut: numericCell(row[9]),
      latencyMs: numericCell(row[10]),
      costEstimateUsd: numericCell(row[11]),
      error: nullableCell(row[12]),
      cachedTokensIn: numericCell(row[13]),
      runId: nullableCell(row[14]),
      studyId: nullableCell(row[15]),
      section: nullableCell(row[16]),
      promptVersion: numericCell(row[17]),
      thoughtsTokensOut: numericCell(row[18]),
    }));
}
