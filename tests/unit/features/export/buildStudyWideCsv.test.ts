import { NOT_REPORTED_TOKEN } from '../../../../src/domain/annotation';
import type { StudyDataRow } from '../../../../src/domain/annotation';
import type { DocumentRecord } from '../../../../src/domain/document';
import type { SchemaField } from '../../../../src/domain/schemaField';
import { buildStudyWideCsv } from '../../../../src/features/export/buildStudyWideCsv';
import { CSV_BOM } from '../../../../src/features/export/csvEncode';

const doc = (documentId: string, studyLabel: string): DocumentRecord => ({
  documentId,
  studyLabel,
  driveFileId: 'drive-1',
  sourceFileId: 'src-1',
  filename: `${documentId}.pdf`,
  pmid: null,
  doi: null,
  textRef: 'https://example.com/text',
  textStatus: 'ok',
  pageCount: 10,
  charCount: 1000,
  importedAt: '2026-07-02T00:00:00Z',
  importedBy: 'a@example.com',
  note: null,
});

const field = (
  fieldId: string,
  fieldName: string,
  fieldIndex: number,
  entityLevel: SchemaField['entityLevel'] = 'study',
): SchemaField => ({
  schemaVersion: 1,
  fieldId,
  fieldIndex,
  section: 'identification',
  fieldName,
  fieldLabel: fieldName,
  entityLevel,
  dataType: 'text',
  unit: null,
  allowedValues: null,
  required: true,
  extractionInstruction: '指示',
  example: null,
  aiGenerated: true,
  note: null,
});

const studyRow = (
  documentId: string,
  annotatorType: StudyDataRow['annotatorType'],
  values: Record<string, string | null>,
  annotator = annotatorType === 'ai' ? 'ai' : 'a@example.com',
): StudyDataRow => ({
  documentId,
  annotator,
  annotatorType,
  schemaVersion: 1,
  runId: annotatorType === 'ai' ? 'run-1' : null,
  updatedAt: '2026-07-02T00:00:00Z',
  values,
});

describe('buildStudyWideCsv', () => {
  test('確定 annotator 行を field_index 順の study レベル列で出力する', () => {
    const documents = [doc('d1', 'Smith 2020'), doc('d2', 'Tanaka, 2021')];
    const fields = [
      field('f2', 'sample_size_total', 2),
      field('f1', 'country', 1),
      field('f3', 'event_count', 3, 'outcome_result'), // study 以外は列に含めない
    ];
    const rows = [
      studyRow('d1', 'ai', { country: 'JP(ai)', sample_size_total: '99' }),
      studyRow('d1', 'human_with_ai', { country: 'JP', sample_size_total: '120' }),
      studyRow('d2', 'consensus', { country: 'US', sample_size_total: NOT_REPORTED_TOKEN }),
    ];
    const result = buildStudyWideCsv(documents, rows, fields);
    expect(result.csv).toBe(
      `${CSV_BOM}study_label,country,sample_size_total\r\n` +
        `Smith 2020,JP,120\r\n` +
        `"Tanaka, 2021",US,NR\r\n`,
    );
    expect(result.skippedDocumentIds).toEqual([]);
    expect(result.unverifiedCellCount).toBe(0);
    expect(result.documentCount).toBe(2);
  });

  test('未検証セル（null / 値未設定）を数える。NR は未報告であり数えない', () => {
    const documents = [doc('d1', 'Smith 2020')];
    const fields = [field('f1', 'country', 1), field('f2', 'design', 2), field('f3', 'total_n', 3)];
    const rows = [
      studyRow('d1', 'human_with_ai', { country: null, total_n: NOT_REPORTED_TOKEN }), // design はキー自体なし
    ];
    const result = buildStudyWideCsv(documents, rows, fields);
    expect(result.unverifiedCellCount).toBe(2);
    expect(result.csv).toContain('Smith 2020,,,NR');
  });

  test('確定 annotator を特定できない study は除外して document_id を報告する', () => {
    const documents = [doc('d1', 'Smith 2020'), doc('d2', 'Doe 2019')];
    const fields = [field('f1', 'country', 1)];
    const rows = [studyRow('d1', 'ai', { country: 'JP' })]; // d1 は ai のみ、d2 は行なし
    const result = buildStudyWideCsv(documents, rows, fields);
    expect(result.skippedDocumentIds).toEqual(['d1', 'd2']);
    expect(result.csv).toBe(`${CSV_BOM}study_label,country\r\n`);
    expect(result.documentCount).toBe(0);
  });
});
