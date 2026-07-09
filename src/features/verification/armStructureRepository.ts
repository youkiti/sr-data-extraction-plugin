// ArmStructures タブ I/O（requirements.md §3.2 v0.7: 追記のみ・上書き禁止）。
// 群構成の確定・改訂のたびに全 arm 行を新 version で追記し、
// document × annotator の最新 version を「現在の確定内容」として読み出す。
// v0.7 より前に作られた既存プロジェクトにはタブが無いため、
// 読み出しは「タブなし = 未確定（空）」、書き込みは「タブがなければ作る」で後方互換を取る
import type { AnnotatorType } from '../../domain/annotation';
import type { ArmStructureRow, ConfirmedArmStructure } from '../../domain/armStructure';
import { SHEET_HEADERS } from '../../domain/sheetsSchema';
import {
  addSheetTab,
  appendRows,
  getSheetTitles,
  getSheetValues,
  writeHeaderRow,
} from '../../lib/google/sheets';
import type { GoogleApiDeps } from '../../lib/google/types';

const ARM_STRUCTURES_TAB = 'ArmStructures';

const ANNOTATOR_TYPES: readonly AnnotatorType[] = [
  'ai',
  'human_with_ai',
  'human_independent',
  'consensus',
];

/** Sheets の values はラグ配列（末尾の空セルが落ちる）。欠けたセルは空文字として読む */
function cellAt(row: readonly string[], index: number): string {
  return row[index] ?? '';
}

/** ArmStructureRow → シート行。列順は SHEET_HEADERS.ArmStructures に対応 */
export function armStructureToRow(row: ArmStructureRow): (string | number | null)[] {
  return [
    row.studyId,
    row.version,
    row.armKey,
    row.armName,
    row.annotator,
    row.annotatorType,
    row.confirmedAt,
    row.note,
  ];
}

function parseAnnotatorType(value: string, context: string): AnnotatorType {
  if ((ANNOTATOR_TYPES as readonly string[]).includes(value)) {
    return value as AnnotatorType;
  }
  throw new Error(`${context}: annotator_type "${value}" が不正です`);
}

function parseVersion(value: string, context: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${context}: version "${value}" が正の整数ではありません`);
  }
  return parsed;
}

function assertHeader(header: readonly string[]): void {
  SHEET_HEADERS.ArmStructures.forEach((name, i) => {
    if (cellAt(header, i) !== name) {
      throw new Error(
        `ArmStructures のヘッダ ${i + 1} 列目が "${name}" ではありません（実際: "${cellAt(header, i)}"）`,
      );
    }
  });
}

function parseAllRows(values: string[][]): ArmStructureRow[] {
  const rows: ArmStructureRow[] = [];
  values.slice(1).forEach((raw, i) => {
    const context = `ArmStructures ${i + 2} 行目`;
    rows.push({
      studyId: cellAt(raw, 0),
      version: parseVersion(cellAt(raw, 1), context),
      armKey: cellAt(raw, 2),
      armName: cellAt(raw, 3),
      annotator: cellAt(raw, 4),
      annotatorType: parseAnnotatorType(cellAt(raw, 5), context),
      confirmedAt: cellAt(raw, 6),
      note: cellAt(raw, 7) === '' ? null : cellAt(raw, 7),
    });
  });
  return rows;
}

function parseRows(values: string[][], studyId: string): ArmStructureRow[] {
  return parseAllRows(values).filter((row) => row.studyId === studyId);
}

/**
 * ArmStructures タブの全行を読み込む（進捗一覧 / ダッシュボード用）。
 * タブ自体が無い旧プロジェクトは「まだ誰も確定していない」として空配列を返す
 */
export async function readAllArmStructures(
  spreadsheetId: string,
  deps: GoogleApiDeps,
): Promise<ArmStructureRow[]> {
  const titles = await getSheetTitles(spreadsheetId, deps);
  if (!titles.includes(ARM_STRUCTURES_TAB)) {
    return [];
  }
  const values = await getSheetValues(spreadsheetId, ARM_STRUCTURES_TAB, deps);
  const header = values[0];
  if (header === undefined) {
    throw new Error('ArmStructures タブにヘッダ行がありません（プロジェクト初期化が不完全です）');
  }
  assertHeader(header);
  return parseAllRows(values);
}

/**
 * 指定 study の群構成行をすべて読み込む（全 version・全 annotator）。
 * タブ自体が無い旧プロジェクトは「まだ誰も確定していない」として空配列を返す
 */
export async function readArmStructuresByStudy(
  spreadsheetId: string,
  studyId: string,
  deps: GoogleApiDeps,
): Promise<ArmStructureRow[]> {
  const titles = await getSheetTitles(spreadsheetId, deps);
  if (!titles.includes(ARM_STRUCTURES_TAB)) {
    return [];
  }
  const values = await getSheetValues(spreadsheetId, ARM_STRUCTURES_TAB, deps);
  const header = values[0];
  if (header === undefined) {
    throw new Error('ArmStructures タブにヘッダ行がありません（プロジェクト初期化が不完全です）');
  }
  assertHeader(header);
  return parseRows(values, studyId);
}

/**
 * 指定 annotator の最新 version を畳み込んで「現在の確定内容」を返す。
 * 1 行もなければ null（= arm 未確定。検証画面で arm / outcome タブをディム表示）
 */
export function latestArmStructure(
  rows: readonly ArmStructureRow[],
  annotator: string,
): ConfirmedArmStructure | null {
  const own = rows.filter((row) => row.annotator === annotator);
  if (own.length === 0) {
    return null;
  }
  const version = Math.max(...own.map((row) => row.version));
  const arms = own
    .filter((row) => row.version === version)
    .map((row) => ({ armKey: row.armKey, armName: row.armName }));
  return { version, arms };
}

export interface ConfirmArmStructureInput {
  studyId: string;
  arms: readonly { armKey: string; armName: string }[];
  annotator: string;
  annotatorType: AnnotatorType;
  confirmedAt: string;
  note?: string | null;
}

/**
 * 群構成の確定・改訂を新 version として追記する（要件: 全 arm 行を同一 version で追記）。
 * 旧プロジェクトでタブが無ければ作成 + ヘッダ書き込みしてから追記する。
 * 戻り値は追記後の確定内容（UI の楽観反映用）
 */
export async function appendArmStructureVersion(
  spreadsheetId: string,
  input: ConfirmArmStructureInput,
  deps: GoogleApiDeps,
): Promise<ConfirmedArmStructure> {
  if (input.arms.length === 0) {
    throw new Error('群構成には少なくとも 1 つの arm が必要です');
  }
  const titles = await getSheetTitles(spreadsheetId, deps);
  let existing: ArmStructureRow[] = [];
  if (!titles.includes(ARM_STRUCTURES_TAB)) {
    await addSheetTab(spreadsheetId, ARM_STRUCTURES_TAB, deps);
    await writeHeaderRow(spreadsheetId, ARM_STRUCTURES_TAB, SHEET_HEADERS.ArmStructures, deps);
  } else {
    const values = await getSheetValues(spreadsheetId, ARM_STRUCTURES_TAB, deps);
    const header = values[0];
    if (header !== undefined) {
      assertHeader(header);
      existing = parseRows(values, input.studyId);
    }
  }
  const own = existing.filter((row) => row.annotator === input.annotator);
  const version = own.length === 0 ? 1 : Math.max(...own.map((row) => row.version)) + 1;
  const rows: ArmStructureRow[] = input.arms.map((arm) => ({
    studyId: input.studyId,
    version,
    armKey: arm.armKey,
    armName: arm.armName,
    annotator: input.annotator,
    annotatorType: input.annotatorType,
    confirmedAt: input.confirmedAt,
    note: input.note ?? null,
  }));
  await appendRows(spreadsheetId, ARM_STRUCTURES_TAB, rows.map(armStructureToRow), deps);
  return { version, arms: input.arms.map((arm) => ({ ...arm })) };
}
