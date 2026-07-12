// study_wide.csv（requirements.md §4.4）: 1 行 = 1 study。
// StudyData の確定 annotator 行（Q6）から study_label + study レベル項目列を出力する。
// study_label は Studies 由来、行のキーは study_id（v0.10）。非アクティブ study は
// exportService 側で除外し、ここへは渡さない（並び順 = study 作成順）
import type { StudyDataRow } from '../../domain/annotation';
import type { StudyRecord } from '../../domain/study';
import type { SchemaField } from '../../domain/schemaField';
import { buildCsv, CSV_BOM } from './csvEncode';
import { selectFinalAnnotator } from './finalAnnotator';

export interface StudyWideCsvResult {
  csv: string;
  /** 確定 annotator 行を特定できず出力から除外した study_id */
  skippedStudyIds: string[];
  /** 未検証（空セル）の個数。エクスポート前の警告ダイアログ（§4.4）に使う */
  unverifiedCellCount: number;
  /** CSV に行が出た study 数（ExportLog.study_count） */
  studyCount: number;
}

export function buildStudyWideCsv(
  studies: readonly StudyRecord[],
  rows: readonly StudyDataRow[],
  fields: readonly SchemaField[],
): StudyWideCsvResult {
  const studyFields = fields
    .filter((field) => field.entityLevel === 'study')
    .sort((a, b) => a.fieldIndex - b.fieldIndex);
  const header = ['study_label', ...studyFields.map((field) => field.fieldName)];

  const csvRows: string[][] = [];
  const skippedStudyIds: string[] = [];
  let unverifiedCellCount = 0;
  for (const study of studies) {
    const studyRows = rows.filter((row) => row.studyId === study.studyId);
    const finalRow = selectFinalAnnotator(studyRows);
    if (finalRow === null) {
      skippedStudyIds.push(study.studyId);
      continue;
    }
    const line = [study.studyLabel];
    for (const field of studyFields) {
      const value = finalRow.values[field.fieldName] ?? null;
      if (value === null) {
        unverifiedCellCount++; // 空セル = 未検証（NR は「未報告」でありここに含めない）
      }
      line.push(value ?? '');
    }
    csvRows.push(line);
  }
  return {
    // Excel との相性優先で BOM を前置（buildCsv 自体は BOM なし。R セットとの違いは csvEncode.ts 参照）
    csv: CSV_BOM + buildCsv(header, csvRows),
    skippedStudyIds,
    unverifiedCellCount,
    studyCount: csvRows.length, // 1 行 = 1 study
  };
}
