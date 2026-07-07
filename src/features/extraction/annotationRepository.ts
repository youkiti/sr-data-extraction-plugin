// StudyData / ResultsData の annotator 行 I/O（requirements.md §3.2）。
// - 更新キー: StudyData = study_id × annotator / ResultsData = study_id × annotator × entity_key × field_id
// - 書き込みは既存行を検索して上書き、なければ追記（annotator 行のみ上書き可。§3.1）
// - 同一更新キーの重複行はバリデーション違反として throw（シート側・入力側とも）
// - StudyData の値列は動的（entity_level = study 項目の field_name）。不足列はヘッダ末尾へ
//   「追加のみ」行う（削除・改名はしない。§3.2）
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
import { appendRows, getSheetValues, updateRow, writeHeaderRow } from '../../lib/google/sheets';
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

export interface AnnotationRepositoryHelpers {
  /** テスト時に差し替え可能な UUID 発番（ResultsData の result_id 採番用） */
  newUuid?: () => string;
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

/** StudyData タブの全行を読み込む（S8 検証・S10 エクスポートの素材） */
export async function readStudyDataSheet(
  spreadsheetId: string,
  deps: GoogleApiDeps,
): Promise<StudyDataSheet> {
  const { fieldNames, rows } = await fetchStudySheet(spreadsheetId, deps);
  return { fieldNames, rows };
}

/** 既存行の更新キー → シート行番号（1 始まり）。重複キーはバリデーション違反 */
function indexStudyRows(snapshot: StudySheetSnapshot): Map<string, number> {
  const index = new Map<string, number>();
  snapshot.rows.forEach((row, i) => {
    const key = keyOf(row.studyId, row.annotator);
    if (index.has(key)) {
      throw new Error(
        `StudyData に同一キーの行が複数あります（study_id=${row.studyId}, annotator=${row.annotator}）`,
      );
    }
    index.set(key, i + 2);
  });
  return index;
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
  rows: readonly StudyDataRow[],
  deps: GoogleApiDeps,
): Promise<void> {
  if (rows.length === 0) {
    return;
  }
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
  for (const row of rows) {
    const sheetRow = studyRowToSheetRow(row, fieldNames);
    const rowIndex = index.get(keyOf(row.studyId, row.annotator));
    if (rowIndex === undefined) {
      appends.push(sheetRow);
    } else {
      await updateRow(spreadsheetId, STUDY_TAB, rowIndex, sheetRow, deps);
    }
  }
  await appendRows(spreadsheetId, STUDY_TAB, appends, deps);
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

/** ResultsData タブの全行を読み込む（S8 検証・S10 エクスポートの素材） */
export async function readResultsDataRows(
  spreadsheetId: string,
  deps: GoogleApiDeps,
): Promise<ResultsDataRow[]> {
  return (await fetchResultsSheet(spreadsheetId, deps)).rows;
}

function resultsKeyOf(row: {
  studyId: string;
  annotator: string;
  entityKey: string;
  fieldId: string;
}): string {
  return keyOf(row.studyId, row.annotator, row.entityKey, row.fieldId);
}

function resultsRowToSheetRow(row: ResultsDataRow): (string | number | boolean | null)[] {
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
  rows: readonly NewResultsDataRow[],
  deps: GoogleApiDeps,
  helpers: AnnotationRepositoryHelpers = {},
): Promise<void> {
  if (rows.length === 0) {
    return;
  }
  const uuid = helpers.newUuid ?? generateUuid;
  const snapshot = await fetchResultsSheet(spreadsheetId, deps);

  const index = new Map<string, { rowIndex: number; resultId: string }>();
  snapshot.rows.forEach((row, i) => {
    const key = resultsKeyOf(row);
    if (index.has(key)) {
      throw new Error(
        `ResultsData に同一キーの行が複数あります（study_id=${row.studyId}, annotator=${row.annotator}, entity_key=${row.entityKey}, field_id=${row.fieldId}）`,
      );
    }
    index.set(key, { rowIndex: i + 2, resultId: row.resultId });
  });

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

  const appends: (string | number | boolean | null)[][] = [];
  for (const row of rows) {
    const existing = index.get(resultsKeyOf(row));
    if (existing === undefined) {
      appends.push(resultsRowToSheetRow({ ...row, resultId: uuid() }));
    } else {
      await updateRow(
        spreadsheetId,
        RESULTS_TAB,
        existing.rowIndex,
        resultsRowToSheetRow({ ...row, resultId: existing.resultId }),
        deps,
      );
    }
  }
  await appendRows(spreadsheetId, RESULTS_TAB, appends, deps);
}
