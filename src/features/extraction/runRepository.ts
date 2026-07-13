// ExtractionRuns タブ I/O（requirements.md §3.1: 追記のみ・上書き禁止）。
// run 1 件 = 2 行プロトコル（requirements.md §4.3）:
//   1. 実行開始時に status='running' の行を追記（Evidence より先。中断検出の印）
//   2. 実行完了時に確定 status（done / partial_failure）の行を同じ run_id で追記
// 読み手は run_id ごとに「完了行があるか」で完了 / 中断を判別する。
// 実行中の細かい進捗は UI（S7 の進捗バー）で in-memory 管理し、シートには残さない
//
// field_ids 列（run 単位のフィールド選択。issue #80）と warnings 列（arm completeness
// チェック。issue #106）は既存プロジェクトに存在しないことがあるため、
// evidenceRepository の bbox 列と同じ方式で後方互換を取る:
// - 読み出し（readRunRows）: 先頭 14 列（旧ヘッダ）は厳格一致、15 列目以降（field_ids /
//   warnings）は「存在すれば」名前一致を要求し「欠けていれば」旧プロジェクトとして許容する
// - 書き込み（ensureRunOptionalColumns）: 旧ヘッダ（14 列 / 15 列）のプロジェクトへは
//   実行前にヘッダ行をフルヘッダへ拡張する（呼び出しは extractionService.ts の責務）
import type { LlmProviderId } from '../../domain/llmApiLog';
import type {
  ExtractionRun,
  InputMode,
  RunAuditInfo,
  RunStatus,
  RunType,
  RunWarning,
} from '../../domain/extractionRun';
import { SHEET_HEADERS } from '../../domain/sheetsSchema';
import { appendRow, getBatchValues, getSheetValues, updateRow } from '../../lib/google/sheets';
import type { GoogleApiDeps } from '../../lib/google/types';

const RUNS_TAB = 'ExtractionRuns';

/** 旧ヘッダ（field_ids 列導入前）の列数。以降 field_ids / warnings の任意列が続く */
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

/**
 * warnings セルの直列化サイズ上限。Sheets のセル上限（5 万字）を超えると完了行の追記自体が
 * 400 で失敗し、run 全体が「中断」扱いへ転落してしまう（flush 済み Evidence が S8/S9 から
 * 不可視化される）ため、保守的なマージンを取ってこの範囲へ切り詰める（issue #106 レビュー対応）
 */
export const MAX_WARNINGS_CELL_CHARS = 40_000;

/** サイズ超過時に 1 警告へ残す missingItems の上限（先頭側を残す） */
const TRUNCATED_MISSING_ITEMS_LIMIT = 5;

/**
 * warnings（null 許容の配列）をシート用の JSON 文字列へ変換する。null = 警告なし → 空文字。
 * MAX_WARNINGS_CELL_CHARS を超える場合は次の順で切り詰める（警告は補助情報であり、
 * 完了行が書けないことのほうが実害が大きいため）:
 * 1. 各警告の missingItems を先頭 TRUNCATED_MISSING_ITEMS_LIMIT 件へ切り詰め、
 *    打ち切りマーカー（truncated: true + missingItemsTotal = 元の総件数）を付ける
 * 2. それでも超える間は末尾の警告から順に落とす（少なくとも 1 件は残す）
 * 極端な入力で 1 件でも収まらない場合に備え、完了行の追記失敗時に warnings なしで
 * 1 回だけ再試行する最終安全弁を extractionService 側に持つ
 */
function warningsToCell(warnings: readonly RunWarning[] | null): string {
  if (warnings === null) {
    return '';
  }
  const full = JSON.stringify(warnings);
  if (full.length <= MAX_WARNINGS_CELL_CHARS) {
    return full;
  }
  let compact: RunWarning[] = warnings.map((warning) =>
    warning.missingItems.length > TRUNCATED_MISSING_ITEMS_LIMIT
      ? {
          ...warning,
          missingItems: warning.missingItems.slice(0, TRUNCATED_MISSING_ITEMS_LIMIT),
          truncated: true,
          missingItemsTotal: warning.missingItems.length,
        }
      : warning,
  );
  let json = JSON.stringify(compact);
  while (json.length > MAX_WARNINGS_CELL_CHARS && compact.length > 1) {
    compact = compact.slice(0, -1);
    json = JSON.stringify(compact);
  }
  return json;
}

/** RunWarning として最低限の形（kind / studyId / 配列 2 種）を満たすか */
function isRunWarning(value: unknown): value is RunWarning {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    candidate.kind === 'arm_completeness' &&
    typeof candidate.studyId === 'string' &&
    (candidate.section === null || typeof candidate.section === 'string') &&
    Array.isArray(candidate.expectedArmKeys) &&
    Array.isArray(candidate.missingItems)
  );
}

/**
 * warnings 列（16 列目）をパースする。警告は表示専用の補助情報のため寛容にパースし、
 * 空セル・列自体の欠落（旧プロジェクト）・JSON 不正・未知の形はすべて null（= 警告なし）
 * に落として読み出し自体は止めない（issue #106）
 */
function parseRunWarnings(cell: string | null | undefined): RunWarning[] | null {
  const raw = cell ?? '';
  if (raw === '') {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) {
    return null;
  }
  const warnings = parsed.filter(isRunWarning);
  return warnings.length === 0 ? null : warnings;
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
    warningsToCell(run.warnings),
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
 * ExtractionRuns タブのヘッダ行を任意列（field_ids / warnings）込みのフルヘッダへ拡張する
 * （既存プロジェクトの後方互換移行。evidenceRepository.ensureEvidenceBboxColumns と同じ方式）。
 * - 先頭 14 列（旧ヘッダ）が SHEET_HEADERS.ExtractionRuns と食い違う場合は throw
 *   （想定外のタブ・壊れたプロジェクトへの書き込み事故を防ぐ）
 * - 15 列目以降に既存の列があれば名前一致を要求する（未知の列を warnings で上書きしない）
 * - 既にフル列数（= 拡張済み）なら no-op
 * - それ以外（旧 14 列 / field_ids までの 15 列）はヘッダ行をフルヘッダで上書きする
 *
 * runExtraction が running 行の追記より前に毎回呼ぶ（extractionService.ts）。
 * ヘッダ行だけを読むため getBatchValues で `ExtractionRuns!1:1` のみ取得する（全行 GET は避ける）
 */
export async function ensureRunOptionalColumns(
  spreadsheetId: string,
  deps: GoogleApiDeps,
): Promise<void> {
  const [headerRows] = await getBatchValues(spreadsheetId, [`${RUNS_TAB}!1:1`], deps);
  const header = headerRows?.[0] ?? [];
  SHEET_HEADERS.ExtractionRuns.slice(0, LEGACY_COLUMN_COUNT).forEach((name, i) => {
    if ((header[i] ?? '') !== name) {
      throw new Error(
        `ExtractionRuns のヘッダ ${i + 1} 列目が "${name}" ではありません（実際: "${header[i] ?? ''}"）。任意列（field_ids / warnings）の移行を中止します`,
      );
    }
  });
  SHEET_HEADERS.ExtractionRuns.slice(LEGACY_COLUMN_COUNT).forEach((name, i) => {
    const idx = LEGACY_COLUMN_COUNT + i;
    if (idx < header.length && (header[idx] ?? '') !== name) {
      throw new Error(
        `ExtractionRuns のヘッダ ${idx + 1} 列目が "${name}" ではありません（実際: "${header[idx] ?? ''}"）。任意列（field_ids / warnings）の移行を中止します`,
      );
    }
  });
  if (header.length >= SHEET_HEADERS.ExtractionRuns.length) {
    // 既に拡張済み（フル列数）。no-op
    return;
  }
  await updateRow(spreadsheetId, RUNS_TAB, 1, [...SHEET_HEADERS.ExtractionRuns], deps);
}

/**
 * ヘッダ行を検証してデータ行だけを返す（読み出し系の共通前処理）。
 * 先頭 14 列（旧ヘッダ）は厳格一致。15 列目以降（field_ids / warnings）は存在すれば
 * 名前一致を要求し、欠けていれば（= 旧プロジェクト）許容する
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
  SHEET_HEADERS.ExtractionRuns.slice(LEGACY_COLUMN_COUNT).forEach((name, i) => {
    const idx = LEGACY_COLUMN_COUNT + i;
    if (idx < header.length && (header[idx] ?? '') !== name) {
      throw new Error(
        `ExtractionRuns のヘッダ ${idx + 1} 列目が "${name}" ではありません（実際: "${header[idx] ?? ''}"）`,
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
  /** run 単位の警告（issue #106: arm completeness）。null = 警告なし（S8 バナーの素材） */
  warnings: RunWarning[] | null;
}

/**
 * 完了行（done / partial_failure）のみを対象に、run_id / schema_version / started_at /
 * field_ids / warnings の最小情報をシート行順（= 追記順）で返す
 * （S8/S9 の field 単位合成ビュー + S8 の arm 欠落警告バナーの素材）。
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
      warnings: parseRunWarnings(raw[15]),
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
    warnings: parseRunWarnings(raw[15]),
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
