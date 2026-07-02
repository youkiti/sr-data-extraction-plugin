// ExtractionRuns タブ I/O（requirements.md §3.1: 追記のみ・上書き禁止）。
// run 1 件 = 実行完了時に確定 status（done / partial_failure）で 1 行追記する。
// 実行中の進捗は UI（S7 の進捗バー）で in-memory 管理し、シートには残さない
import type { ExtractionRun } from '../../domain/extractionRun';
import { SHEET_HEADERS } from '../../domain/sheetsSchema';
import { appendRow, getSheetValues } from '../../lib/google/sheets';
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

/**
 * run_id → schema_version のマップを読み込む（S8 検証画面が Evidence の表示 run から
 * スキーマ版を引くための最小読み出し。フル ExtractionRun のパースはまだ消費者がないため持たない）
 */
export async function readRunSchemaVersions(
  spreadsheetId: string,
  deps: GoogleApiDeps,
): Promise<Map<string, number>> {
  const values = await getSheetValues(spreadsheetId, RUNS_TAB, deps);
  const header = values[0];
  if (header === undefined) {
    throw new Error('ExtractionRuns タブにヘッダ行がありません（プロジェクト初期化が不完全です）');
  }
  SHEET_HEADERS.ExtractionRuns.forEach((name, i) => {
    if ((header[i] ?? '') !== name) {
      throw new Error(
        `ExtractionRuns のヘッダ ${i + 1} 列目が "${name}" ではありません（実際: "${header[i] ?? ''}"）`,
      );
    }
  });
  const map = new Map<string, number>();
  values.slice(1).forEach((raw, i) => {
    const runId = raw[0] ?? '';
    const cell = raw[2] ?? '';
    // Number('') は 0 になるため、空セルは明示的に不正として扱う
    const version = cell === '' ? Number.NaN : Number(cell);
    if (!Number.isInteger(version)) {
      throw new Error(`ExtractionRuns ${i + 2} 行目: schema_version "${cell}" が整数ではありません`);
    }
    map.set(runId, version);
  });
  return map;
}
