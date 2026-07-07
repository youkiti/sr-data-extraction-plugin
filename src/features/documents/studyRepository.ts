// Studies タブ I/O（requirements.md §3.2 v0.10）。
// study（試験）は抽出・検証・エクスポートの単位。グルーピング変更のたびに新 study_id の
// 行を追記し、旧行は監査用に残置する（§4.5）。study_label / registration_id / note は行内編集可。
// 「アクティブ study」= Documents から 1 件以上参照されている study（参照 0 は非アクティブ = 集計・
// エクスポートに出さない・削除もしない §3.2）
import type { DocumentRecord } from '../../domain/document';
import type { StudyRecord } from '../../domain/study';
import { SHEET_HEADERS } from '../../domain/sheetsSchema';
import { appendRows, getSheetValues, updateRow } from '../../lib/google/sheets';
import type { GoogleApiDeps } from '../../lib/google/types';

const STUDIES_TAB = 'Studies';

/** Sheets の values はラグ配列（末尾の空セルが落ちる）。欠けたセルは空文字として読む */
function cellAt(row: readonly string[], index: number): string {
  return row[index] ?? '';
}

function emptyToNull(value: string): string | null {
  return value === '' ? null : value;
}

/** StudyRecord → シート行。列順は SHEET_HEADERS.Studies（domain/sheetsSchema.ts）に対応 */
export function studyToRow(study: StudyRecord): (string | number | null)[] {
  return [
    study.studyId,
    study.studyLabel,
    study.registrationId,
    study.createdAt,
    study.createdBy,
    study.note,
  ];
}

interface StudiesSnapshot {
  rows: StudyRecord[];
  /** study_id → シート行番号（1 始まり） */
  rowIndexById: Map<string, number>;
}

async function fetchStudies(spreadsheetId: string, deps: GoogleApiDeps): Promise<StudiesSnapshot> {
  const values = await getSheetValues(spreadsheetId, STUDIES_TAB, deps);
  const header = values[0];
  if (header === undefined) {
    throw new Error('Studies タブにヘッダ行がありません（プロジェクト初期化が不完全です）');
  }
  SHEET_HEADERS.Studies.forEach((name, i) => {
    if (cellAt(header, i) !== name) {
      throw new Error(
        `Studies のヘッダ ${i + 1} 列目が "${name}" ではありません（実際: "${cellAt(header, i)}"）`,
      );
    }
  });

  const rows: StudyRecord[] = [];
  const rowIndexById = new Map<string, number>();
  values.slice(1).forEach((raw, i) => {
    const study: StudyRecord = {
      studyId: cellAt(raw, 0),
      studyLabel: cellAt(raw, 1),
      registrationId: emptyToNull(cellAt(raw, 2)),
      createdAt: cellAt(raw, 3),
      createdBy: cellAt(raw, 4),
      note: emptyToNull(cellAt(raw, 5)),
    };
    if (rowIndexById.has(study.studyId)) {
      throw new Error(`Studies に同一 study_id の行が複数あります（${study.studyId}）`);
    }
    rowIndexById.set(study.studyId, i + 2);
    rows.push(study);
  });
  return { rows, rowIndexById };
}

/** Studies タブの全行を作成順（シート行順）で読み込む */
export async function readStudies(
  spreadsheetId: string,
  deps: GoogleApiDeps,
): Promise<StudyRecord[]> {
  return (await fetchStudies(spreadsheetId, deps)).rows;
}

/** study 行をまとめて追記する（1 API 呼び出し）。空配列は no-op */
export async function appendStudies(
  spreadsheetId: string,
  studies: readonly StudyRecord[],
  deps: GoogleApiDeps,
): Promise<void> {
  await appendRows(spreadsheetId, STUDIES_TAB, studies.map(studyToRow), deps);
}

/** 既存行（study_id 一致）を丸ごと上書きする（study_label / registration_id / note 編集）。見つからなければ throw */
export async function updateStudy(
  spreadsheetId: string,
  study: StudyRecord,
  deps: GoogleApiDeps,
): Promise<void> {
  const { rowIndexById } = await fetchStudies(spreadsheetId, deps);
  const rowIndex = rowIndexById.get(study.studyId);
  if (rowIndex === undefined) {
    throw new Error(`Studies に study_id "${study.studyId}" の行がありません`);
  }
  await updateRow(spreadsheetId, STUDIES_TAB, rowIndex, studyToRow(study), deps);
}

/**
 * アクティブ study（Documents から 1 件以上参照されている study）だけを作成順（Studies の行順）で返す。
 * 参照 0 の行は非アクティブ = 一覧・集計・エクスポートに出さない（§3.2）
 */
export function resolveActiveStudies(
  studies: readonly StudyRecord[],
  documents: readonly DocumentRecord[],
): StudyRecord[] {
  const referenced = new Set(documents.map((doc) => doc.studyId));
  return studies.filter((study) => referenced.has(study.studyId));
}

/** study_id → study_label の解決マップ（表示ラベルの引き当て用）。見つからない id は呼び出し側でフォールバック */
export function studyLabelMap(studies: readonly StudyRecord[]): Map<string, string> {
  return new Map(studies.map((study) => [study.studyId, study.studyLabel]));
}
