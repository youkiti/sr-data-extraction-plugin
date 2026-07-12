// ExtractionRuns タブ I/O（requirements.md §3.1: 追記のみ・上書き禁止）。
// run 1 件 = 2 行プロトコル（requirements.md §4.3）:
//   1. 実行開始時に status='running' の行を追記（Evidence より先。中断検出の印）
//   2. 実行完了時に確定 status（done / partial_failure）の行を同じ run_id で追記
// 読み手は run_id ごとに「完了行があるか」で完了 / 中断を判別する。
// 実行中の細かい進捗は UI（S7 の進捗バー）で in-memory 管理し、シートには残さない
import type { LlmProviderId } from '../../domain/llmApiLog';
import type {
  ExtractionRun,
  InputMode,
  RunAuditInfo,
  RunStatus,
  RunType,
} from '../../domain/extractionRun';
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
    run.studyIds.join(','), // シート上はカンマ区切り（§3.2）
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

/** 完了行の status（2 行プロトコルの 2 行目）。running 行しかない run は中断とみなす */
const COMPLETED_STATUSES: ReadonlySet<string> = new Set(['done', 'partial_failure']);

/** study_ids 列（4 列目）のカンマ区切りを分解する（§3.2）。ラグ配列の欠落セルは空扱い */
function parseStudyIds(cell: string | null | undefined): string[] {
  return (cell ?? '').split(',').filter((id) => id !== '');
}

export interface RunStudyCoverage {
  /** 完了行を持つ run で抽出済みの study_id 集合（S7 既定選択 = 未抽出の全件の素材） */
  extracted: Set<string>;
  /**
   * 中断された run（running 行のみで完了行がない）に含まれ、かつその後の run でも
   * 抽出されていない study_id 集合（S7 の中断バナーの素材）
   */
  interrupted: Set<string>;
}

/**
 * これまでの run（pilot / full / single_study すべて）の study カバレッジを返す。
 * 抽出済みに数えるのは完了行のみ。中断 run の文献は「未抽出」に戻るため、
 * S7 の既定選択（未抽出の全件）がそのまま再開手段になる
 */
export async function readRunStudyCoverage(
  spreadsheetId: string,
  deps: GoogleApiDeps,
): Promise<RunStudyCoverage> {
  const rows = await readRunRows(spreadsheetId, deps);
  const extracted = new Set<string>();
  const completedRunIds = new Set<string>();
  for (const raw of rows) {
    if (COMPLETED_STATUSES.has(raw[8] ?? '')) {
      completedRunIds.add(raw[0] ?? '');
      for (const id of parseStudyIds(raw[3])) {
        extracted.add(id);
      }
    }
  }
  const interrupted = new Set<string>();
  for (const raw of rows) {
    if (completedRunIds.has(raw[0] ?? '')) {
      continue;
    }
    for (const id of parseStudyIds(raw[3])) {
      if (!extracted.has(id)) {
        interrupted.add(id);
      }
    }
  }
  return { extracted, interrupted };
}

function emptyToNull(cell: string | null | undefined): string | null {
  const value = cell ?? '';
  return value === '' ? null : value;
}

/** 必須の整数セル（schema_version 等）。空セルは Number('') = 0 と誤読しないよう明示的に不正扱い */
function parseRequiredInteger(cell: string | null | undefined, context: string, label: string): number {
  const raw = cell ?? '';
  const value = raw === '' ? Number.NaN : Number(raw);
  if (!Number.isInteger(value)) {
    throw new Error(`${context}: ${label} "${raw}" が整数ではありません`);
  }
  return value;
}

/** null 許容の整数セル（tokens_in / tokens_out）。空セルは null */
function parseNullableInteger(cell: string | null | undefined, context: string, label: string): number | null {
  const raw = cell ?? '';
  if (raw === '') {
    return null;
  }
  const value = Number(raw);
  if (!Number.isInteger(value)) {
    throw new Error(`${context}: ${label} "${raw}" が整数ではありません`);
  }
  return value;
}

/** null 許容の数値セル（cost_estimate は小数）。空セルは null */
function parseNullableNumber(cell: string | null | undefined, context: string, label: string): number | null {
  const raw = cell ?? '';
  if (raw === '') {
    return null;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`${context}: ${label} "${raw}" が数値ではありません`);
  }
  return value;
}

/**
 * ExtractionRuns の 1 行を ExtractionRun へパースする（列順は SHEET_HEADERS.ExtractionRuns）。
 * 列挙型（run_type / provider / input_mode / status）は自プロジェクトが書いた値のため
 * 検証せずキャストで受ける（数値列のみ厳格に検証する。readRun* の他関数と同じ規約）
 */
function rowToExtractionRun(raw: (string | null)[], rowIndex: number): ExtractionRun {
  const context = `ExtractionRuns ${rowIndex + 2} 行目`;
  return {
    runId: raw[0] ?? '',
    // run_type / status は readPilotRuns が 'pilot' + 完了行を確認済みのため非 null が保証される
    runType: raw[1] as RunType,
    schemaVersion: parseRequiredInteger(raw[2], context, 'schema_version'),
    studyIds: parseStudyIds(raw[3]),
    provider: (raw[4] ?? '') as LlmProviderId,
    requestedModel: raw[5] ?? '',
    modelVersion: emptyToNull(raw[6]),
    inputMode: (raw[7] ?? '') as InputMode,
    status: raw[8] as RunStatus,
    startedAt: emptyToNull(raw[9]),
    finishedAt: emptyToNull(raw[10]),
    tokensIn: parseNullableInteger(raw[11], context, 'tokens_in'),
    tokensOut: parseNullableInteger(raw[12], context, 'tokens_out'),
    costEstimate: parseNullableNumber(raw[13], context, 'cost_estimate'),
  };
}

/**
 * Methods 文案カード（S10。docs/methods-boilerplate.md）が使う完了 run の最小情報。
 * run_type ごとに集計方法が異なる（full → モデル / provider 列挙、pilot → 対象 study 数）ため、
 * 呼び出し側（exportService）で run_type ごとにフィルタして畳み込む
 */
export interface MethodsRunFact {
  runType: RunType;
  provider: LlmProviderId;
  modelVersion: string | null;
  studyIds: string[];
}

/**
 * これまでの run（全 run_type）の完了行（2 行プロトコルの完了行のみ）を新しい順で返す。
 * schema_version 等の数値検証は行わない（Methods 文案は文字列の集計のみで済むため）
 */
export async function readMethodsRunFacts(
  spreadsheetId: string,
  deps: GoogleApiDeps,
): Promise<MethodsRunFact[]> {
  const rows = await readRunRows(spreadsheetId, deps);
  const facts: MethodsRunFact[] = [];
  for (const raw of rows) {
    if (!COMPLETED_STATUSES.has(raw[8] ?? '')) {
      continue;
    }
    facts.push({
      runType: (raw[1] ?? '') as RunType,
      provider: (raw[4] ?? '') as LlmProviderId,
      modelVersion: emptyToNull(raw[6]),
      studyIds: parseStudyIds(raw[3]),
    });
  }
  return facts.reverse(); // シート追記順の逆 = 新しい順
}

/**
 * これまでのパイロット run（run_type='pilot' の完了行）を新しい順で返す（S6 の履歴読込）。
 * 2 行プロトコルの完了行（done / partial_failure）だけを対象にし、running 行のみの中断 run は
 * 含めない（Evidence が揃っている保証がないため。readRunStudyCoverage と同じ完了判定）。
 * シート追記順の逆順 = 実行の新しい順で返す
 */
export async function readPilotRuns(
  spreadsheetId: string,
  deps: GoogleApiDeps,
): Promise<ExtractionRun[]> {
  const rows = await readRunRows(spreadsheetId, deps);
  const runs: ExtractionRun[] = [];
  rows.forEach((raw, i) => {
    if ((raw[1] ?? '') !== 'pilot') {
      return;
    }
    if (!COMPLETED_STATUSES.has(raw[8] ?? '')) {
      return;
    }
    runs.push(rowToExtractionRun(raw, i));
  });
  return runs.reverse();
}
