// ExtractionRuns タブ I/O（requirements.md §3.1: 追記のみ・上書き禁止）。
// run 1 件 = 2 行プロトコル（requirements.md §4.3）:
//   1. 実行開始時に status='running' の行を追記（Evidence より先。中断検出の印）
//   2. 実行完了時に確定 status（done / partial_failure）の行を同じ run_id で追記
// 読み手は run_id ごとに「完了行があるか」で完了 / 中断を判別する。
// 実行中の細かい進捗は UI（S7 の進捗バー）で in-memory 管理し、シートには残さない
//
// field_ids 列（run 単位のフィールド選択。issue #80）は既存プロジェクトに存在しないことが
// あるため、evidenceRepository の bbox 列と同じ方式で後方互換を取る:
// - 読み出し（readRunRows）: 先頭 14 列（旧ヘッダ）は厳格一致、15 列目（field_ids）は
//   「存在すれば」名前一致を要求し「欠けていれば」旧プロジェクトとして許容する
// - 書き込み（ensureRunFieldIdsColumn）: 旧 14 列ヘッダのプロジェクトへは実行前に
//   ヘッダ行を 15 列のフルヘッダへ拡張する（呼び出しは extractionService.ts の責務）
import type { LlmProviderId } from '../../domain/llmApiLog';
import type {
  ExtractionRun,
  InputMode,
  RunAuditInfo,
  RunStatus,
  RunType,
} from '../../domain/extractionRun';
import { SHEET_HEADERS } from '../../domain/sheetsSchema';
import { appendRow, getBatchValues, getSheetValues, updateRow } from '../../lib/google/sheets';
import type { GoogleApiDeps } from '../../lib/google/types';

const RUNS_TAB = 'ExtractionRuns';

/** 旧ヘッダ（field_ids 列導入前）の列数。以降 field_ids 1 列 */
const LEGACY_COLUMN_COUNT = 14;

/** field_ids（null 許容の配列）をシート用のカンマ区切り文字列へ変換する。null = 全項目 → 空文字 */
function fieldIdsToCell(fieldIds: readonly string[] | null): string {
  return fieldIds === null ? '' : fieldIds.join(',');
}

/** field_ids 列（15 列目）をパースする。空セル・列自体の欠落（旧プロジェクト） = 全項目（null） */
function parseFieldIds(cell: string | null | undefined): string[] | null {
  const raw = cell ?? '';
  return raw === '' ? null : raw.split(',').filter((id) => id !== '');
}

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
    fieldIdsToCell(run.fieldIds),
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
 * ExtractionRuns タブのヘッダ行を field_ids 込みの 15 列へ拡張する（既存プロジェクトの
 * 後方互換移行。evidenceRepository.ensureEvidenceBboxColumns と同じ方式）。
 * - 先頭 14 列（旧ヘッダ）が SHEET_HEADERS.ExtractionRuns と食い違う場合は throw
 *   （想定外のタブ・壊れたプロジェクトへの書き込み事故を防ぐ）
 * - 既に 15 列以上（= 拡張済み）なら no-op
 * - それ以外（旧 14 列のまま）はヘッダ行を SHEET_HEADERS.ExtractionRuns のフル 15 列で上書きする
 *
 * runExtraction が running 行の追記より前に毎回呼ぶ（extractionService.ts）。
 * ヘッダ行だけを読むため getBatchValues で `ExtractionRuns!1:1` のみ取得する（全行 GET は避ける）
 */
export async function ensureRunFieldIdsColumn(
  spreadsheetId: string,
  deps: GoogleApiDeps,
): Promise<void> {
  const [headerRows] = await getBatchValues(spreadsheetId, [`${RUNS_TAB}!1:1`], deps);
  const header = headerRows?.[0] ?? [];
  SHEET_HEADERS.ExtractionRuns.slice(0, LEGACY_COLUMN_COUNT).forEach((name, i) => {
    if ((header[i] ?? '') !== name) {
      throw new Error(
        `ExtractionRuns のヘッダ ${i + 1} 列目が "${name}" ではありません（実際: "${header[i] ?? ''}"）。field_ids 列の移行を中止します`,
      );
    }
  });
  if (header.length > LEGACY_COLUMN_COUNT) {
    // 既に拡張済み（15 列）。no-op
    return;
  }
  await updateRow(spreadsheetId, RUNS_TAB, 1, [...SHEET_HEADERS.ExtractionRuns], deps);
}

/**
 * ヘッダ行を検証してデータ行だけを返す（読み出し系の共通前処理）。
 * 先頭 14 列（旧ヘッダ）は厳格一致。15 列目（field_ids）は存在すれば名前一致を要求し、
 * 欠けていれば（= 旧プロジェクト）許容する
 */
async function readRunRows(
  spreadsheetId: string,
  deps: GoogleApiDeps,
): Promise<(string | null)[][]> {
  const values = await getSheetValues(spreadsheetId, RUNS_TAB, deps);
  const header = values[0];
  if (header === undefined) {
    throw new Error('ExtractionRuns タブにヘッダ行がありません（プロジェクト初期化が不完全です）');
  }
  SHEET_HEADERS.ExtractionRuns.slice(0, LEGACY_COLUMN_COUNT).forEach((name, i) => {
    if ((header[i] ?? '') !== name) {
      throw new Error(
        `ExtractionRuns のヘッダ ${i + 1} 列目が "${name}" ではありません（実際: "${header[i] ?? ''}"）`,
      );
    }
  });
  if (header.length > LEGACY_COLUMN_COUNT) {
    SHEET_HEADERS.ExtractionRuns.slice(LEGACY_COLUMN_COUNT).forEach((name, i) => {
      const idx = LEGACY_COLUMN_COUNT + i;
      if ((header[idx] ?? '') !== name) {
        throw new Error(
          `ExtractionRuns のヘッダ ${idx + 1} 列目が "${name}" ではありません（実際: "${header[idx] ?? ''}"）`,
        );
      }
    });
  }
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

/**
 * field 単位合成ビュー（app/services/verifyService.ts の composeEvidenceByStudy）が使う
 * run の最小情報（issue #80: run 単位のフィールド選択）
 */
export interface CompletedRunMeta {
  runId: string;
  schemaVersion: number;
  startedAt: string | null;
  /** null = 全項目（後方互換規約） */
  fieldIds: string[] | null;
}

/**
 * 完了行（done / partial_failure）のみを対象に、run_id / schema_version / started_at /
 * field_ids の最小情報をシート行順（= 追記順）で返す（S8/S9 の field 単位合成ビューの素材）。
 * 中断 run（running 行のみ）は含めない（readRunStudyCoverage と同じ完了判定）
 */
export async function readCompletedRunMetas(
  spreadsheetId: string,
  deps: GoogleApiDeps,
): Promise<CompletedRunMeta[]> {
  const rows = await readRunRows(spreadsheetId, deps);
  const metas: CompletedRunMeta[] = [];
  rows.forEach((raw, i) => {
    if (!COMPLETED_STATUSES.has(raw[8] ?? '')) {
      return;
    }
    const context = `ExtractionRuns ${i + 2} 行目`;
    metas.push({
      runId: raw[0] ?? '',
      schemaVersion: parseRequiredInteger(raw[2], context, 'schema_version'),
      startedAt: emptyToNull(raw[9]),
      fieldIds: parseFieldIds(raw[14]),
    });
  });
  return metas;
}

/**
 * S7 の「直近 run は n/m 項目」バッジ注記の素材（issue #80）。readCompletedRunMetas と同じ
 * 完了判定・列パースだが、study_id ごとの畳み込みに要る study_ids も併せ持つ
 */
export interface CompletedRunStudySummary {
  runId: string;
  studyIds: string[];
  schemaVersion: number;
  startedAt: string | null;
  /** null = 全項目（後方互換規約） */
  fieldIds: string[] | null;
}

/**
 * 完了行（done / partial_failure）のみを対象に、run_id・study_ids・schema_version・
 * started_at・field_ids をシート行順（= 追記順）で返す（S7 バッジ注記の素材の下ごしらえ。
 * readRunStudyCoverage が読み込み済みの rows から呼ぶため fetch はしない）
 */
function parseCompletedRunStudySummaries(
  rows: readonly (string | null)[][],
): CompletedRunStudySummary[] {
  const summaries: CompletedRunStudySummary[] = [];
  rows.forEach((raw, i) => {
    if (!COMPLETED_STATUSES.has(raw[8] ?? '')) {
      return;
    }
    const context = `ExtractionRuns ${i + 2} 行目`;
    summaries.push({
      runId: raw[0] ?? '',
      studyIds: parseStudyIds(raw[3]),
      schemaVersion: parseRequiredInteger(raw[2], context, 'schema_version'),
      startedAt: emptyToNull(raw[9]),
      fieldIds: parseFieldIds(raw[14]),
    });
  });
  return summaries; // シート行順。並べ替えは pickLatestCompletedRunByStudy が行う
}

/**
 * study_id ごとに「その study を含む最新の完了 run」を選ぶ（started_at 昇順で比較。null は最古、
 * 同値・null 同士は安定ソートによりシート行順を保つ = app/services/verifyService.ts の
 * composeEvidenceByStudy と同じ規約）
 */
export function pickLatestCompletedRunByStudy(
  summaries: readonly CompletedRunStudySummary[],
): Map<string, CompletedRunStudySummary> {
  const sorted = [...summaries].sort((a, b) => {
    const ak = a.startedAt ?? '';
    const bk = b.startedAt ?? '';
    if (ak < bk) {
      return -1;
    }
    if (ak > bk) {
      return 1;
    }
    return 0; // 同値・null 同士は安定ソートによりシート行順を保つ
  });
  const result = new Map<string, CompletedRunStudySummary>();
  for (const summary of sorted) {
    for (const studyId of summary.studyIds) {
      result.set(studyId, summary); // 昇順で上書きしていくため最後の代入が最新
    }
  }
  return result;
}

export interface RunStudyCoverage {
  /** 完了行を持つ run で抽出済みの study_id 集合（S7 既定選択 = 未抽出の全件の素材） */
  extracted: Set<string>;
  /**
   * 中断された run（running 行のみで完了行がない）に含まれ、かつその後の run でも
   * 抽出されていない study_id 集合（S7 の中断バナーの素材）
   */
  interrupted: Set<string>;
  /**
   * study_id ごとの直近完了 run（S7 の「直近 run は n/m 項目」バッジ注記の素材。issue #80）。
   * ExtractionRuns を 1 回読むだけで extracted / interrupted と一緒に組み立てる
   * （バッジ専用の別読み出しにすると同じタブを 2 回 GET することになるため）
   */
  latestCompletedRunByStudy: Map<string, CompletedRunStudySummary>;
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
  const latestCompletedRunByStudy = pickLatestCompletedRunByStudy(
    parseCompletedRunStudySummaries(rows),
  );
  return { extracted, interrupted, latestCompletedRunByStudy };
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
    fieldIds: parseFieldIds(raw[14]),
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
