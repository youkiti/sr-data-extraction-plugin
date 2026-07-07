// ExportLog タブ I/O（requirements.md §3.1: 追記のみ・上書き禁止）。
// エクスポート 1 回 = Drive 保存の完了後に 1 行追記する
import type { ExportLogEntry } from '../../domain/exportLog';
import { appendRow } from '../../lib/google/sheets';
import type { GoogleApiDeps } from '../../lib/google/types';

const EXPORT_LOG_TAB = 'ExportLog';

/** ExportLogEntry → シート行。列順は SHEET_HEADERS.ExportLog（domain/sheetsSchema.ts）に対応 */
export function exportLogToRow(entry: ExportLogEntry): (string | number)[] {
  return [
    entry.exportId,
    entry.format,
    entry.schemaVersion,
    entry.studyCount,
    entry.fileRef,
    entry.exportedAt,
    entry.exportedBy,
  ];
}

export async function appendExportLog(
  spreadsheetId: string,
  entry: ExportLogEntry,
  deps: GoogleApiDeps,
): Promise<void> {
  await appendRow(spreadsheetId, EXPORT_LOG_TAB, exportLogToRow(entry), deps);
}
