// study_wide.csv（requirements.md §4.4）: 1 行 = 1 study。
// StudyData の確定 annotator 行（Q6）から study_label + study レベル項目列を出力する
import type { StudyDataRow } from '../../domain/annotation';
import type { DocumentRecord } from '../../domain/document';
import type { SchemaField } from '../../domain/schemaField';
import { buildCsv } from './csvEncode';
import { selectFinalAnnotator } from './finalAnnotator';

export interface StudyWideCsvResult {
  csv: string;
  /** 確定 annotator 行を特定できず出力から除外した document_id */
  skippedDocumentIds: string[];
  /** 未検証（空セル）の個数。エクスポート前の警告ダイアログ（§4.4）に使う */
  unverifiedCellCount: number;
  /** CSV に行が出た文献数（ExportLog.document_count） */
  documentCount: number;
}

export function buildStudyWideCsv(
  documents: readonly DocumentRecord[],
  rows: readonly StudyDataRow[],
  fields: readonly SchemaField[],
): StudyWideCsvResult {
  const studyFields = fields
    .filter((field) => field.entityLevel === 'study')
    .sort((a, b) => a.fieldIndex - b.fieldIndex);
  const header = ['study_label', ...studyFields.map((field) => field.fieldName)];

  const csvRows: string[][] = [];
  const skippedDocumentIds: string[] = [];
  let unverifiedCellCount = 0;
  for (const doc of documents) {
    const docRows = rows.filter((row) => row.documentId === doc.documentId);
    const finalRow = selectFinalAnnotator(docRows);
    if (finalRow === null) {
      skippedDocumentIds.push(doc.documentId);
      continue;
    }
    const line = [doc.studyLabel];
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
    csv: buildCsv(header, csvRows),
    skippedDocumentIds,
    unverifiedCellCount,
    documentCount: csvRows.length, // 1 行 = 1 study
  };
}
