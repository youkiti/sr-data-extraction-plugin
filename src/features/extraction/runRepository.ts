// ExtractionRuns タブ I/O（requirements.md §3.1: 追記のみ・上書き禁止）。
// run 1 件 = 実行完了時に確定 status（done / partial_failure）で 1 行追記する。
// 実行中の進捗は UI（S7 の進捗バー）で in-memory 管理し、シートには残さない
import type { ExtractionRun, RunAuditInfo } from '../../domain/extractionRun';
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

/** ヘッダ行を検証してデータ行だけを返す（読み出し系の共通前処理） */
async function readRunRows(
  spreadsheetId: string,
  deps: GoogleApiDeps,
): Promise<(string | null)[][]> {
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
  return values.slice(1);
}

/**
 * run_id → schema_version のマップを読み込む（S8 検証画面が Evidence の表示 run から
 * スキーマ版を引くための最小読み出し。フル ExtractionRun のパースはまだ消費者がないため持たない）
 */
export async function readRunSchemaVersions(
  spreadsheetId: string,
  deps: GoogleApiDeps,
): Promise<Map<string, number>> {
  const rows = await readRunRows(spreadsheetId, deps);
  const map = new Map<string, number>();
  rows.forEach((raw, i) => {
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

/**
 * audit.csv の Evidence 結合（buildAuditCsv）が使う run の最小情報
 * （run_id / schema_version / started_at）を全 run ぶん読み込む（S10）
 */
export async function readRunAuditInfos(
  spreadsheetId: string,
  deps: GoogleApiDeps,
): Promise<RunAuditInfo[]> {
  const rows = await readRunRows(spreadsheetId, deps);
  return rows.map((raw, i) => {
    const cell = raw[2] ?? '';
    // Number('') は 0 になるため、空セルは明示的に不正として扱う（readRunSchemaVersions と同じ規約）
    const version = cell === '' ? Number.NaN : Number(cell);
    if (!Number.isInteger(version)) {
      throw new Error(`ExtractionRuns ${i + 2} 行目: schema_version "${cell}" が整数ではありません`);
    }
    const startedAt = raw[9] ?? '';
    return {
      runId: raw[0] ?? '',
      schemaVersion: version,
      startedAt: startedAt === '' ? null : startedAt,
    };
  });
}

/**
 * これまでの run（pilot / full / single_document すべて）で抽出済みの document_id 集合を返す。
 * S7 の対象選択の既定値（= 未抽出の全件）を出すための最小読み出し
 */
export async function readExtractedDocumentIds(
  spreadsheetId: string,
  deps: GoogleApiDeps,
): Promise<Set<string>> {
  const rows = await readRunRows(spreadsheetId, deps);
  const ids = new Set<string>();
  for (const raw of rows) {
    // document_ids 列（4 列目）はカンマ区切り（§3.2）
    for (const id of (raw[3] ?? '').split(',')) {
      if (id !== '') {
        ids.add(id);
      }
    }
  }
  return ids;
}
