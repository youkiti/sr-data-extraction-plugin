// StudyData / ResultsData の annotator 行 I/O（requirements.md §3.2）。
// - 更新キー: StudyData = study_id × annotator / ResultsData = study_id × annotator × entity_key × field_id
// - 書き込みは既存行を検索して上書き、なければ追記（annotator 行のみ上書き可。§3.1）
// - 更新キーの重複行の扱い:
//   - シート側（読み込んだ既存行同士）は致命エラーにしない。updated_at の文字列比較で最大の
//     行を winner として自己修復する（1 組の重複でプロジェクト全体の書き込みが恒久的に
//     止まるのを防ぐため）。敗者行は削除も書き換えもせずシートに残し、console.warn で警告する
//   - 入力側（upsert 呼び出しの引数 rows 内の重複）は呼び出し側のコード契約違反のため
//     従来どおり throw する
// - StudyData の値列は動的（entity_level = study 項目の field_name）。不足列はヘッダ末尾へ
//   「追加のみ」行う（削除・改名はしない。§3.2）
// - 新規行の追記は 1 回の values:append あたり DEFAULT_MAX_ROWS_PER_APPEND 行までに区切り、
//   逐次呼び出す（Sheets API のリクエストサイズ超過・429 対策。issue #69）
// - 既存行の上書きも 1 行ずつの PUT ではなく values:batchUpdate へまとめる（issue #185）:
//   2 回目以降の full run では既存 ai 行（数百〜数千行）の更新が発生し、per-row PUT だと
//   書き込みクォータ（60 回/分/ユーザー）を必ず超えて転記が死に、ExtractionRuns の完了行が
//   書かれないまま run 全体が「中断」扱いへ転落する
// - expectedUpdatedAt（省略可）による楽観ロック（issue #64）: 独立二重レビューで同一 annotator が
//   2 コンテキスト（別タブ・別端末）から同じ行を書くと read-modify-write の後勝ち上書きが起きうる。
//   行の updated_at 列をバージョントークンとして使う（新列を増やさない）。
//   undefined = チェックなし（ai 転記・consensus・オフラインキュー再送）、
//   null = 「行がまだ無い」ことを期待、文字列 = 既存行の updated_at との完全一致を期待。
//   不一致は書き込み開始前（updateRow / append を 1 件も呼ぶ前）の検証パスで検出し、
//   AnnotationConflictError を throw する（部分書き込みを起こさない）
import type {
  AnnotatorType,
  ResultsDataRow,
  StudyDataRow,
} from '../../domain/annotation';
import {
  SHEET_HEADERS,
  STUDY_DATA_FIXED_HEADERS,
  buildStudyDataHeader,
} from '../../domain/sheetsSchema';
import { appendRows, batchUpdateRows, getSheetValues, writeHeaderRow } from '../../lib/google/sheets';
import type { GoogleApiDeps } from '../../lib/google/types';
import { generateUuid } from '../../utils/uuid';
import type { NewResultsDataRow } from './aiAnnotationRows';

const STUDY_TAB = 'StudyData';
const RESULTS_TAB = 'ResultsData';

const ANNOTATOR_TYPES: readonly AnnotatorType[] = [
  'ai',
  'human_with_ai',
  'human_independent',
  'consensus',
];

/**
 * 1 回の values:append に載せる行数上限の既定値（Sheets API のリクエストサイズ超過・429 対策）。
 * Evidence 側（executeRun.ts の DEFAULT_MAX_ROWS_PER_FLUSH）と同値だが、リポジトリ層から
 * ユースケース層（executeRun.ts）への逆依存を避けるためここで値を重複定義する。
 */
export const DEFAULT_MAX_ROWS_PER_APPEND = 500;

/**
 * StudyData / ResultsData の annotator 行 upsert 時の楽観ロック競合（issue #64）。
 * 独立二重レビューで同一 annotator が 2 コンテキスト（別タブ・別端末）から同じ行を編集すると、
 * 読み込み時に見た版と実際のシート上の版が食い違う可能性がある。expectedUpdatedAt に
 * 「読み込み時に見た updated_at」を渡すことで検出する
 */
export class AnnotationConflictError extends Error {
  readonly tab: 'StudyData' | 'ResultsData';
  readonly studyId: string;
  readonly annotator: string;
  /** ResultsData のみ非 null。StudyData は null */
  readonly entityKey: string | null;
  /** ResultsData のみ非 null。StudyData は null */
  readonly fieldId: string | null;
  readonly expectedUpdatedAt: string | null;
  readonly actualUpdatedAt: string | null;

  constructor(params: {
    tab: 'StudyData' | 'ResultsData';
    studyId: string;
    annotator: string;
    entityKey: string | null;
    fieldId: string | null;
    expectedUpdatedAt: string | null;
    actualUpdatedAt: string | null;
  }) {
    const keyInfo =
      params.entityKey !== null && params.fieldId !== null
        ? `study_id=${params.studyId}, annotator=${params.annotator}, entity_key=${params.entityKey}, field_id=${params.fieldId}`
        : `study_id=${params.studyId}, annotator=${params.annotator}`;
    super(
      `読み込み後に別の場所で更新されています。再読み込みしてから判定し直してください（${params.tab}: ${keyInfo}）`,
    );
    this.name = 'AnnotationConflictError';
    this.tab = params.tab;
    this.studyId = params.studyId;
    this.annotator = params.annotator;
    this.entityKey = params.entityKey;
    this.fieldId = params.fieldId;
    this.expectedUpdatedAt = params.expectedUpdatedAt;
    this.actualUpdatedAt = params.actualUpdatedAt;
  }
}

/** upsertStudyDataRows の入力行（expectedUpdatedAt は省略可。楽観ロックの期待値。issue #64） */
export type StudyDataUpsertRow = StudyDataRow & {
  /** undefined = チェックなし / null = 行がまだ無いことを期待 / 文字列 = 既存行の updated_at と一致を期待 */
  expectedUpdatedAt?: string | null;
};

/** upsertResultsDataRows の入力行（expectedUpdatedAt は省略可。楽観ロックの期待値。issue #64） */
export type ResultsDataUpsertRow = NewResultsDataRow & {
  /** undefined = チェックなし / null = 行がまだ無いことを期待 / 文字列 = 既存行の updated_at と一致を期待 */
  expectedUpdatedAt?: string | null;
};

export interface AnnotationRepositoryHelpers {
  /** テスト時に差し替え可能な UUID 発番（ResultsData の result_id 採番用） */
  newUuid?: () => string;
  /**
   * 1 回の values:append に載せる行数上限（既定 DEFAULT_MAX_ROWS_PER_APPEND = 500）。
   * 0 以下・小数は 1 以上の整数へ丸める
   */
  maxRowsPerAppend?: number;
}

/**
 * rows を maxRowsPerAppend 行ずつに区切り、appendRows を逐次 await で呼び出す
 * （Sheets API のリクエストサイズ超過・429 対策）。並列にしないのは行順を保存するため。
 * 空配列はループに入らないため何も呼ばない
 */
async function appendRowsInChunks(
  spreadsheetId: string,
  tab: string,
  rows: readonly (readonly (string | number | boolean | null)[])[],
  deps: GoogleApiDeps,
  maxRowsPerAppend: number,
): Promise<void> {
  for (let i = 0; i < rows.length; i += maxRowsPerAppend) {
    await appendRows(spreadsheetId, tab, rows.slice(i, i + maxRowsPerAppend), deps);
  }
}

/**
 * 既存行の上書きを maxRowsPerAppend 行ずつの values:batchUpdate へまとめて逐次発行する
 * （issue #185: per-row PUT だと 2 回目以降の full run の転記が書き込みクォータ
 * 60 回/分/ユーザーを超えて死ぬ。チャンク幅は追記側と同じ knob を使う =
 * 「1 リクエストに載せる行数の上限」という同じ意味のため）。空配列は何も呼ばない
 */
async function updateRowsInChunks(
  spreadsheetId: string,
  tab: string,
  updates: readonly { rowIndex: number; row: readonly (string | number | boolean | null)[] }[],
  deps: GoogleApiDeps,
  maxRowsPerAppend: number,
): Promise<void> {
  for (let i = 0; i < updates.length; i += maxRowsPerAppend) {
    await batchUpdateRows(spreadsheetId, tab, updates.slice(i, i + maxRowsPerAppend), deps);
  }
}

/** Sheets の values はラグ配列（末尾の空セルが落ちる）。欠けたセルは空文字として読む */
function cellAt(row: readonly string[], index: number): string {
  return row[index] ?? '';
}

function emptyToNull(value: string): string | null {
  return value === '' ? null : value;
}

/** appendRow が boolean を書くと Sheets 上は TRUE になるため、大文字小文字を無視して読む */
function parseBool(value: string): boolean {
  return /^true$/i.test(value);
}

function parseAnnotatorType(value: string, context: string): AnnotatorType {
  if ((ANNOTATOR_TYPES as readonly string[]).includes(value)) {
    return value as AnnotatorType;
  }
  throw new Error(`${context}: annotator_type "${value}" が不正です`);
}

function parseSchemaVersion(value: string, context: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${context}: schema_version "${value}" が整数ではありません`);
  }
  return parsed;
}

/** 更新キーの文字列化。値に任意文字が使えるため区切り文字ではなく JSON 配列でキー化する */
function keyOf(...parts: string[]): string {
  return JSON.stringify(parts);
}

/**
 * シート側の重複行（同一更新キーが複数行に存在する状態）を updated_at で解決する
 * （StudyData / ResultsData 共通ロジック）。updated_at の文字列比較で最大の行を winner とし、
 * 同着ならシート上でより下の行（rowIndex が大きい方）を winner とする。
 * 重複を検出したら console.warn で警告する（敗者行はここでは削除も書き換えもしない。呼び出し側が
 * winner の rowIndex だけを使い続けることで、シート上に残ったままの敗者行に自然と触れなくなる）
 */
function resolveDuplicateWinners<T extends { rowIndex: number; updatedAt: string }>(
  tab: 'StudyData' | 'ResultsData',
  rows: readonly T[],
  keyOfRow: (row: T) => string,
  describeRow: (row: T) => string,
): Map<string, T> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOfRow(row);
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, [row]);
    } else {
      group.push(row);
    }
  }

  const winners = new Map<string, T>();
  groups.forEach((group, key) => {
    let winner = group[0]!; // group は必ず 1 件以上（push でしか作られないため）
    for (let i = 1; i < group.length; i += 1) {
      const candidate = group[i]!;
      // 同着（updatedAt が等しい）場合も候補側（シート上でより下の行）を winner にする
      if (candidate.updatedAt >= winner.updatedAt) {
        winner = candidate;
      }
    }
    winners.set(key, winner);

    if (group.length > 1) {
      const loserRowNumbers = group
        .filter((row) => row !== winner)
        .map((row) => row.rowIndex)
        .join(', ');
      console.warn(
        `${tab} に同一キー（${describeRow(winner)}）の重複行があります。` +
          `updated_at が最新の ${winner.rowIndex} 行目を有効とし、${loserRowNumbers} 行目は無視します` +
          `（敗者行はシートから削除しません）。`,
      );
    }
  });
  return winners;
}

// ---------------------------------------------------------------------------
// StudyData（wide・動的値列）
// ---------------------------------------------------------------------------

export interface StudyDataSheet {
  /** 動的値列の field_name（ヘッダの固定 6 列より後ろ、シート上の並び順） */
  fieldNames: string[];
  /** データ行（シート行順） */
  rows: StudyDataRow[];
}

interface StudySheetSnapshot extends StudyDataSheet {
  /** 生の values（行番号算出用。[0] がヘッダ行） */
  values: string[][];
}

async function fetchStudySheet(
  spreadsheetId: string,
  deps: GoogleApiDeps,
): Promise<StudySheetSnapshot> {
  const values = await getSheetValues(spreadsheetId, STUDY_TAB, deps);
  const header = values[0];
  if (header === undefined) {
    throw new Error('StudyData タブにヘッダ行がありません（プロジェクト初期化が不完全です）');
  }
  STUDY_DATA_FIXED_HEADERS.forEach((name, i) => {
    if (cellAt(header, i) !== name) {
      throw new Error(
        `StudyData のヘッダ ${i + 1} 列目が "${name}" ではありません（実際: "${cellAt(header, i)}"）`,
      );
    }
  });
  const fieldNames = header.slice(STUDY_DATA_FIXED_HEADERS.length);

  const rows = values.slice(1).map((raw, i) => {
    const context = `StudyData ${i + 2} 行目`;
    const row: StudyDataRow = {
      studyId: cellAt(raw, 0),
      annotator: cellAt(raw, 1),
      annotatorType: parseAnnotatorType(cellAt(raw, 2), context),
      schemaVersion: parseSchemaVersion(cellAt(raw, 3), context),
      runId: emptyToNull(cellAt(raw, 4)),
      updatedAt: cellAt(raw, 5),
      values: {},
    };
    fieldNames.forEach((name, j) => {
      row.values[name] = emptyToNull(cellAt(raw, STUDY_DATA_FIXED_HEADERS.length + j));
    });
    return row;
  });
  return { fieldNames, rows, values };
}

/**
 * StudyData タブの全行を読み込む（S8 検証・S10 エクスポートの素材）。
 * シート側に重複キーがあれば updated_at が最新の行（winner）だけを返す。
 * 生き残った行の並びはシート行順を保つ
 */
export async function readStudyDataSheet(
  spreadsheetId: string,
  deps: GoogleApiDeps,
): Promise<StudyDataSheet> {
  const snapshot = await fetchStudySheet(spreadsheetId, deps);
  const index = indexStudyRows(snapshot);
  const winnerRowIndices = new Set(Array.from(index.values(), (v) => v.rowIndex));
  const rows = snapshot.rows.filter((_, i) => winnerRowIndices.has(i + 2));
  return { fieldNames: snapshot.fieldNames, rows };
}

/**
 * 既存行の更新キー → シート行番号（1 始まり）+ updated_at。
 * シート側に重複キーがあれば updated_at が最新の行を winner として解決する
 */
function indexStudyRows(
  snapshot: StudySheetSnapshot,
): Map<string, { rowIndex: number; updatedAt: string }> {
  const indexedRows = snapshot.rows.map((row, i) => ({ ...row, rowIndex: i + 2 }));
  const winners = resolveDuplicateWinners(
    'StudyData',
    indexedRows,
    (row) => keyOf(row.studyId, row.annotator),
    (row) => `study_id=${row.studyId}, annotator=${row.annotator}`,
  );
  const index = new Map<string, { rowIndex: number; updatedAt: string }>();
  winners.forEach((row, key) => {
    index.set(key, { rowIndex: row.rowIndex, updatedAt: row.updatedAt });
  });
  return index;
}

/**
 * 楽観ロックの期待値検証（issue #64）。expectedUpdatedAt が undefined の行はチェックしない。
 * 不一致があれば AnnotationConflictError を throw する。
 * 呼び出し側は「書き込みを 1 件も行う前」にこれを回す（部分書き込み防止）
 */
function checkStudyRowConflict(
  row: StudyDataUpsertRow,
  existing: { rowIndex: number; updatedAt: string } | undefined,
): void {
  if (row.expectedUpdatedAt === undefined) {
    return;
  }
  const actualUpdatedAt = existing?.updatedAt ?? null;
  if (row.expectedUpdatedAt !== actualUpdatedAt) {
    throw new AnnotationConflictError({
      tab: 'StudyData',
      studyId: row.studyId,
      annotator: row.annotator,
      entityKey: null,
      fieldId: null,
      expectedUpdatedAt: row.expectedUpdatedAt,
      actualUpdatedAt,
    });
  }
}

/** StudyDataRow → シート行（ヘッダ順）。values に無い列は空セル（null） */
function studyRowToSheetRow(
  row: StudyDataRow,
  fieldNames: readonly string[],
): (string | number | null)[] {
  return [
    row.studyId,
    row.annotator,
    row.annotatorType,
    row.schemaVersion,
    row.runId,
    row.updatedAt,
    ...fieldNames.map((name) => row.values[name] ?? null),
  ];
}

/**
 * StudyData の annotator 行を upsert する。
 * 既存行（study_id × annotator 一致）は上書き、なければ追記。
 * 行の values に「ヘッダに無い field_name」があればヘッダ末尾へ列を追加する（追加のみ）
 */
export async function upsertStudyDataRows(
  spreadsheetId: string,
  rows: readonly StudyDataUpsertRow[],
  deps: GoogleApiDeps,
  helpers: AnnotationRepositoryHelpers = {},
): Promise<void> {
  if (rows.length === 0) {
    return;
  }
  const maxRowsPerAppend = Math.max(
    1,
    Math.floor(helpers.maxRowsPerAppend ?? DEFAULT_MAX_ROWS_PER_APPEND),
  );
  const snapshot = await fetchStudySheet(spreadsheetId, deps);
  const index = indexStudyRows(snapshot);

  // 入力側の重複キーは呼び出し契約違反
  const inputKeys = new Set<string>();
  for (const row of rows) {
    const key = keyOf(row.studyId, row.annotator);
    if (inputKeys.has(key)) {
      throw new Error(
        `upsertStudyDataRows の入力に同一キーの行が複数あります（study_id=${row.studyId}, annotator=${row.annotator}）`,
      );
    }
    inputKeys.add(key);
  }

  // 楽観ロックの期待値検証（issue #64）。書き込み（ヘッダ追加・updateRow・append）を
  // 1 件も行う前に全行を検証し、不一致があれば throw する（部分書き込みを起こさない）
  for (const row of rows) {
    checkStudyRowConflict(row, index.get(keyOf(row.studyId, row.annotator)));
  }

  // 不足列をヘッダ末尾へ追加（buildStudyDataHeader が固定列との衝突・重複を検証する）
  const fieldNames = [...snapshot.fieldNames];
  for (const row of rows) {
    for (const name of Object.keys(row.values)) {
      if (!fieldNames.includes(name)) {
        fieldNames.push(name);
      }
    }
  }
  if (fieldNames.length > snapshot.fieldNames.length) {
    await writeHeaderRow(spreadsheetId, STUDY_TAB, buildStudyDataHeader(fieldNames), deps);
  }

  const appends: (string | number | null)[][] = [];
  const updates: { rowIndex: number; row: (string | number | null)[] }[] = [];
  for (const row of rows) {
    const sheetRow = studyRowToSheetRow(row, fieldNames);
    const existing = index.get(keyOf(row.studyId, row.annotator));
    if (existing === undefined) {
      appends.push(sheetRow);
    } else {
      updates.push({ rowIndex: existing.rowIndex, row: sheetRow });
    }
  }
  await updateRowsInChunks(spreadsheetId, STUDY_TAB, updates, deps, maxRowsPerAppend);
  await appendRowsInChunks(spreadsheetId, STUDY_TAB, appends, deps, maxRowsPerAppend);
}

// ---------------------------------------------------------------------------
// ResultsData（long・固定列）
// ---------------------------------------------------------------------------

interface ResultsSheetSnapshot {
  rows: ResultsDataRow[];
}

async function fetchResultsSheet(
  spreadsheetId: string,
  deps: GoogleApiDeps,
): Promise<ResultsSheetSnapshot> {
  const values = await getSheetValues(spreadsheetId, RESULTS_TAB, deps);
  const header = values[0];
  if (header === undefined) {
    throw new Error('ResultsData タブにヘッダ行がありません（プロジェクト初期化が不完全です）');
  }
  SHEET_HEADERS.ResultsData.forEach((name, i) => {
    if (cellAt(header, i) !== name) {
      throw new Error(
        `ResultsData のヘッダ ${i + 1} 列目が "${name}" ではありません（実際: "${cellAt(header, i)}"）`,
      );
    }
  });
  const rows = values.slice(1).map((raw, i) => {
    const context = `ResultsData ${i + 2} 行目`;
    return {
      resultId: cellAt(raw, 0),
      studyId: cellAt(raw, 1),
      fieldId: cellAt(raw, 2),
      annotator: cellAt(raw, 3),
      annotatorType: parseAnnotatorType(cellAt(raw, 4), context),
      schemaVersion: parseSchemaVersion(cellAt(raw, 5), context),
      entityKey: cellAt(raw, 6),
      runId: emptyToNull(cellAt(raw, 7)),
      value: emptyToNull(cellAt(raw, 8)),
      notReported: parseBool(cellAt(raw, 9)),
      updatedAt: cellAt(raw, 10),
    };
  });
  return { rows };
}

/**
 * ResultsData タブの全行を読み込む（S8 検証・S10 エクスポートの素材）。
 * シート側に重複キーがあれば updated_at が最新の行（winner）だけを返す。
 * 生き残った行の並びはシート行順を保つ
 */
export async function readResultsDataRows(
  spreadsheetId: string,
  deps: GoogleApiDeps,
): Promise<ResultsDataRow[]> {
  const snapshot = await fetchResultsSheet(spreadsheetId, deps);
  const index = indexResultsRows(snapshot);
  const winnerRowIndices = new Set(Array.from(index.values(), (v) => v.rowIndex));
  return snapshot.rows.filter((_, i) => winnerRowIndices.has(i + 2));
}

function resultsKeyOf(row: {
  studyId: string;
  annotator: string;
  entityKey: string;
  fieldId: string;
}): string {
  return keyOf(row.studyId, row.annotator, row.entityKey, row.fieldId);
}

/**
 * 既存行の更新キー → シート行番号（1 始まり）+ result_id + updated_at。
 * シート側に重複キーがあれば updated_at が最新の行を winner として解決する
 * （indexStudyRows と対称の関数として切り出し）
 */
function indexResultsRows(
  snapshot: ResultsSheetSnapshot,
): Map<string, { rowIndex: number; resultId: string; updatedAt: string }> {
  const indexedRows = snapshot.rows.map((row, i) => ({ ...row, rowIndex: i + 2 }));
  const winners = resolveDuplicateWinners(
    'ResultsData',
    indexedRows,
    (row) => resultsKeyOf(row),
    (row) =>
      `study_id=${row.studyId}, annotator=${row.annotator}, entity_key=${row.entityKey}, field_id=${row.fieldId}`,
  );
  const index = new Map<string, { rowIndex: number; resultId: string; updatedAt: string }>();
  winners.forEach((row, key) => {
    index.set(key, { rowIndex: row.rowIndex, resultId: row.resultId, updatedAt: row.updatedAt });
  });
  return index;
}

/**
 * expectedUpdatedAt を受け付けるのは呼び出し側が ResultsDataUpsertRow + resultId で
 * スプレッドして渡すため（excess property を起こさないよう型を合わせる）。
 * expectedUpdatedAt はシート行へは書かない（下記の配列に含めない）
 */
function resultsRowToSheetRow(
  row: ResultsDataRow & { expectedUpdatedAt?: string | null },
): (string | number | boolean | null)[] {
  return [
    row.resultId,
    row.studyId,
    row.fieldId,
    row.annotator,
    row.annotatorType,
    row.schemaVersion,
    row.entityKey,
    row.runId,
    row.value,
    row.notReported,
    row.updatedAt,
  ];
}

/**
 * ResultsData の annotator 行を upsert する。
 * 既存行（study_id × annotator × entity_key × field_id 一致)は result_id を保持したまま上書き、
 * なければ result_id を採番して追記する（result_id は行識別子であり更新キーではない。§3.2）
 */
export async function upsertResultsDataRows(
  spreadsheetId: string,
  rows: readonly ResultsDataUpsertRow[],
  deps: GoogleApiDeps,
  helpers: AnnotationRepositoryHelpers = {},
): Promise<void> {
  if (rows.length === 0) {
    return;
  }
  const uuid = helpers.newUuid ?? generateUuid;
  const maxRowsPerAppend = Math.max(
    1,
    Math.floor(helpers.maxRowsPerAppend ?? DEFAULT_MAX_ROWS_PER_APPEND),
  );
  const snapshot = await fetchResultsSheet(spreadsheetId, deps);
  const index = indexResultsRows(snapshot);

  const inputKeys = new Set<string>();
  for (const row of rows) {
    const key = resultsKeyOf(row);
    if (inputKeys.has(key)) {
      throw new Error(
        `upsertResultsDataRows の入力に同一キーの行が複数あります（study_id=${row.studyId}, annotator=${row.annotator}, entity_key=${row.entityKey}, field_id=${row.fieldId}）`,
      );
    }
    inputKeys.add(key);
  }

  // 楽観ロックの期待値検証（issue #64）。書き込み（updateRow・append）を 1 件も行う前に
  // 全行を検証し、不一致があれば throw する（部分書き込みを起こさない）
  for (const row of rows) {
    if (row.expectedUpdatedAt === undefined) {
      continue;
    }
    const existing = index.get(resultsKeyOf(row));
    const actualUpdatedAt = existing?.updatedAt ?? null;
    if (row.expectedUpdatedAt !== actualUpdatedAt) {
      throw new AnnotationConflictError({
        tab: 'ResultsData',
        studyId: row.studyId,
        annotator: row.annotator,
        entityKey: row.entityKey,
        fieldId: row.fieldId,
        expectedUpdatedAt: row.expectedUpdatedAt,
        actualUpdatedAt,
      });
    }
  }

  const appends: (string | number | boolean | null)[][] = [];
  const updates: { rowIndex: number; row: (string | number | boolean | null)[] }[] = [];
  for (const row of rows) {
    const existing = index.get(resultsKeyOf(row));
    if (existing === undefined) {
      appends.push(resultsRowToSheetRow({ ...row, resultId: uuid() }));
    } else {
      updates.push({
        rowIndex: existing.rowIndex,
        row: resultsRowToSheetRow({ ...row, resultId: existing.resultId }),
      });
    }
  }
  await updateRowsInChunks(spreadsheetId, RESULTS_TAB, updates, deps, maxRowsPerAppend);
  await appendRowsInChunks(spreadsheetId, RESULTS_TAB, appends, deps, maxRowsPerAppend);
}
