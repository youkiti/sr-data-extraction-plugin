// study_wide.csv（requirements.md §4.4）: 1 行 = 1 study。
// StudyData の確定 annotator 行（Q6）から study_label + study レベル項目列を出力する。
// study_label は Studies 由来、行のキーは study_id（v0.10）。非アクティブ study は
// exportService 側で除外し、ここへは渡さない（並び順 = study 作成順）
// キー列と重なる既存項目は見出しだけ <名前>_field にする。
import type { StudyDataRow } from '../../domain/annotation';
import type { StudyRecord } from '../../domain/study';
import type { SchemaField } from '../../domain/schemaField';
import type { Decision } from '../../domain/decision';
import { rsetValueHeaders } from '../../domain/rsetColumns';
import { activeConsultFlags, consultFlagKey } from '../verification/consultFlags';
import { buildCsv, CSV_BOM } from './csvEncode';
import { selectFinalAnnotator } from './finalAnnotator';
import { buildMultiSelectColumns, multiSelectColumnValues } from './multiSelectColumns';

const STUDY_WIDE_KEY_HEADER = ['study_label'] as const;

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
  decisions: readonly Decision[] = [],
  draft = false,
): StudyWideCsvResult {
  const flags = activeConsultFlags(decisions);
  const studyFields = fields
    .filter((field) => field.entityLevel === 'study')
    .sort((a, b) => a.fieldIndex - b.fieldIndex);
  const valueHeaders = rsetValueHeaders(STUDY_WIDE_KEY_HEADER, studyFields.map((field) => field.fieldName));
  const used = new Set([...STUDY_WIDE_KEY_HEADER, ...fields.map((field) => field.fieldName), ...valueHeaders,
    ...(draft ? studyFields.map((field) => `${field.fieldName}__source`) : [])]);
  const columns = studyFields.map((field) => buildMultiSelectColumns(field, used));
  let consultColumn = 'consult_fields';
  for (let suffix = 2; used.has(consultColumn); suffix++) consultColumn = `consult_fields_${suffix}`;
  const header = [...STUDY_WIDE_KEY_HEADER, ...studyFields.flatMap((field, index) =>
    [valueHeaders[index]!, ...columns[index]!.map((column) => column.name),
      ...(draft ? [`${field.fieldName}__source`] : [])],
  ), consultColumn];

  const csvRows: string[][] = [];
  const skippedStudyIds: string[] = [];
  let unverifiedCellCount = 0;
  for (const study of studies) {
    const studyRows = rows.filter((row) => row.studyId === study.studyId);
    const finalRow = selectFinalAnnotator(studyRows);
    const aiRow = draft ? studyRows.find((row) => row.annotatorType === 'ai') : undefined;
    if (finalRow === null && aiRow === undefined) {
      skippedStudyIds.push(study.studyId);
      continue;
    }
    const line = [study.studyLabel];
    const consultFields: string[] = [];
    for (const [index, field] of studyFields.entries()) {
      const humanValue = finalRow?.values[field.fieldName] ?? null;
      const value = humanValue ?? aiRow?.values[field.fieldName] ?? null;
      if (humanValue === null) {
        unverifiedCellCount++; // 空セル = 未検証（NR は「未報告」でありここに含めない）
      }
      line.push(value ?? '');
      if (finalRow !== null && flags.has(consultFlagKey({ ...finalRow, fieldId: field.fieldId, entityKey: '-' }))) {
        consultFields.push(field.fieldName);
      }
      line.push(...multiSelectColumnValues(field, value, columns[index]!));
      if (draft) {
        line.push(humanValue === null ? 'ai_unverified'
          : finalRow!.annotatorType === 'consensus' ? 'consensus' : 'human');
      }
    }
    line.push(consultFields.join('|'));
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
