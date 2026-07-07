import type { ResultsDataRow } from '../../../../src/domain/annotation';
import type { StudyRecord } from '../../../../src/domain/study';
import type { SchemaField } from '../../../../src/domain/schemaField';
import { buildResultsLongCsv } from '../../../../src/features/export/buildResultsLongCsv';
import { CSV_BOM } from '../../../../src/features/export/csvEncode';

const study = (studyId: string, studyLabel: string): StudyRecord => ({
  studyId,
  studyLabel,
  registrationId: null,
  createdAt: '2026-07-02T00:00:00Z',
  createdBy: 'a@example.com',
  note: null,
});

const field = (
  fieldId: string,
  fieldName: string,
  fieldIndex: number,
  unit: string | null = null,
): SchemaField => ({
  schemaVersion: 1,
  fieldId,
  fieldIndex,
  section: 'outcomes',
  fieldName,
  fieldLabel: fieldName,
  entityLevel: 'outcome_result',
  dataType: 'integer',
  unit,
  allowedValues: null,
  required: true,
  extractionInstruction: '指示',
  example: null,
  aiGenerated: true,
  note: null,
});

const resultRow = (
  studyId: string,
  fieldId: string,
  entityKey: string,
  value: string | null,
  overrides: Partial<ResultsDataRow> = {},
): ResultsDataRow => ({
  resultId: `${studyId}-${fieldId}-${entityKey}`,
  studyId,
  fieldId,
  annotator: 'a@example.com',
  annotatorType: 'human_with_ai',
  schemaVersion: 1,
  entityKey,
  runId: null,
  value,
  notReported: false,
  updatedAt: '2026-07-02T00:00:00Z',
  ...overrides,
});

describe('buildResultsLongCsv', () => {
  test('確定 annotator の行を entity_key → field_index 順で出力する', () => {
    const studies = [study('d1', 'Smith 2020')];
    const fields = [field('f1', 'event_count', 1), field('f2', 'group_n', 2, 'persons')];
    const rows = [
      resultRow('d1', 'f2', 'arm:1', '50'),
      resultRow('d1', 'f1', 'arm:2', '3'),
      resultRow('d1', 'f1', 'arm:1', '5'),
      resultRow('d1', 'f1', 'arm:1', '4', { annotator: 'ai', annotatorType: 'ai', runId: 'run-1' }),
    ];
    const result = buildResultsLongCsv(studies, rows, fields);
    expect(result.csv).toBe(
      `${CSV_BOM}study_label,annotator,entity_key,field_name,value,unit,not_reported\r\n` +
        `Smith 2020,a@example.com,arm:1,event_count,5,,false\r\n` +
        `Smith 2020,a@example.com,arm:1,group_n,50,persons,false\r\n` +
        `Smith 2020,a@example.com,arm:2,event_count,3,,false\r\n`,
    );
    expect(result.skippedStudyIds).toEqual([]);
    expect(result.droppedRowCount).toBe(0);
    expect(result.studyCount).toBe(1);
  });

  test('not_reported 行は value 空 + true になる', () => {
    const studies = [study('d1', 'Smith 2020')];
    const fields = [field('f1', 'event_count', 1)];
    const rows = [resultRow('d1', 'f1', 'arm:1', null, { notReported: true })];
    const result = buildResultsLongCsv(studies, rows, fields);
    expect(result.csv).toContain('Smith 2020,a@example.com,arm:1,event_count,,,true');
  });

  test('SchemaFields にない field_id の行は除外して数える', () => {
    const studies = [study('d1', 'Smith 2020')];
    const fields = [field('f1', 'event_count', 1)];
    const rows = [resultRow('d1', 'f1', 'arm:1', '5'), resultRow('d1', 'f-unknown', 'arm:1', '9')];
    const result = buildResultsLongCsv(studies, rows, fields);
    expect(result.droppedRowCount).toBe(1);
    expect(result.csv).not.toContain(',9,');
  });

  test('確定 annotator を特定できない study は除外して報告する（ai のみ）', () => {
    const studies = [study('d1', 'Smith 2020')];
    const fields = [field('f1', 'event_count', 1)];
    const rows = [
      resultRow('d1', 'f1', 'arm:1', '4', { annotator: 'ai', annotatorType: 'ai', runId: 'run-1' }),
    ];
    const result = buildResultsLongCsv(studies, rows, fields);
    expect(result.skippedStudyIds).toEqual(['d1']);
    expect(result.csv).toBe(
      `${CSV_BOM}study_label,annotator,entity_key,field_name,value,unit,not_reported\r\n`,
    );
  });

  test('long 行がない study は正常（skipped に数えない）', () => {
    const studies = [study('d1', 'Smith 2020')];
    const result = buildResultsLongCsv(studies, [], [field('f1', 'event_count', 1)]);
    expect(result.skippedStudyIds).toEqual([]);
    expect(result.droppedRowCount).toBe(0);
    expect(result.studyCount).toBe(0);
  });

  test('行が全て除外された study は studyCount に数えない', () => {
    const studies = [study('d1', 'Smith 2020'), study('d2', 'Doe 2019')];
    const fields = [field('f1', 'event_count', 1)];
    const rows = [resultRow('d1', 'f1', 'arm:1', '5'), resultRow('d2', 'f-unknown', 'arm:1', '9')];
    const result = buildResultsLongCsv(studies, rows, fields);
    expect(result.studyCount).toBe(1);
    expect(result.droppedRowCount).toBe(1);
  });
});
