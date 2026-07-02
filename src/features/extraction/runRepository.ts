// ExtractionRuns タブ I/O（requirements.md §3.1: 追記のみ・上書き禁止）。
// run 1 件 = 実行完了時に確定 status（done / partial_failure）で 1 行追記する。
// 実行中の進捗は UI（S7 の進捗バー）で in-memory 管理し、シートには残さない
import type { ExtractionRun } from '../../domain/extractionRun';
import { appendRow } from '../../lib/google/sheets';
import type { GoogleApiDeps } from '../../lib/google/types';

const RUNS_TAB = 'ExtractionRuns';

/** ExtractionRun → シート行。列順は SHEET_HEADERS.ExtractionRuns（domain/sheetsSchema.ts）に対応 */
export function extractionRunToRow(run: ExtractionRun): (string | number | null)[] {
  return [
    run.runId,
    run.runType,
    run.schemaVersion,
    run.documentIds.join(','), // シート上はカンマ区切り（§3.2）
    run.provider,
    run.requestedModel,
    run.modelVersion,
    run.inputMode,
    run.status,
    run.startedAt,
    run.finishedAt,
    run.tokensIn,
    run.tokensOut,
    run.costEstimate,
  ];
}

export async function appendExtractionRun(
  spreadsheetId: string,
  run: ExtractionRun,
  deps: GoogleApiDeps,
): Promise<void> {
  await appendRow(spreadsheetId, RUNS_TAB, extractionRunToRow(run), deps);
}
