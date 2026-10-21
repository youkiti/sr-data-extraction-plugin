import type { Decision } from '../../../../src/domain/decision';
import type { ResultsDataRow } from '../../../../src/domain/annotation';
import type { StudyRecord } from '../../../../src/domain/study';
import type { SchemaField } from '../../../../src/domain/schemaField';
import { buildResultsLongCsv } from '../../../../src/features/export/buildResultsLongCsv';
import { CSV_BOM } from '../../../../src/features/export/csvEncode';

const study = (studyId: string, studyLabel: string): StudyRecord => ({
  studyId,
  reviewSet: null,
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
  maxQuotes: null,
  multiSelect: null,
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
      `${CSV_BOM}study_label,annotator,entity_key,field_name,value,unit,not_reported,flag\r\n` +
        `Smith 2020,a@example.com,arm:1,event_count,5,,false,\r\n` +
        `Smith 2020,a@example.com,arm:1,group_n,50,persons,false,\r\n` +
        `Smith 2020,a@example.com,arm:2,event_count,3,,false,\r\n`,
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
      `${CSV_BOM}study_label,annotator,entity_key,field_name,value,unit,not_reported,flag\r\n`,
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

test('仮 long は人の値・空文字・未報告を保持し、未検証と欠落行を AI で補う', () => {
  const studies = [study('s', '確認中'), study('ai', 'AIのみ'), study('c', '裁定'), study('amb', '複数人')];
  const ai = { annotator: 'ai', annotatorType: 'ai' as const };
  const rows = [
    ...['1', '2', '3', '4', '5'].map((key) => resultRow('s', 'f', key, 'AI', ai)),
    resultRow('s', 'f', '1', '人'),
    resultRow('s', 'f', '2', null),
    resultRow('s', 'f', '3', ''),
    resultRow('s', 'f', '4', null, { notReported: true }),
    resultRow('ai', 'f', '1', 'AI', ai),
    resultRow('ai', 'unknown', '2', '除外', ai),
    resultRow('c', 'f', '1', '裁定', { annotator: 'consensus', annotatorType: 'consensus' }),
    resultRow('amb', 'f', '1', 'A'),
    resultRow('amb', 'f', '1', 'B', { annotator: 'b' }),
  ];
  const fields = [field('f', 'value', 1)];
  const result = buildResultsLongCsv(studies, rows, fields, [], true);
  expect(result.csv).toBe(CSV_BOM +
    'study_label,annotator,entity_key,field_name,value,unit,not_reported,flag,source\r\n' +
    '確認中,a@example.com,1,value,人,,false,,human\r\n' +
    '確認中,ai,2,value,AI,,false,,ai_unverified\r\n' +
    '確認中,a@example.com,3,value,,,false,,human\r\n' +
    '確認中,a@example.com,4,value,,,true,,human\r\n' +
    '確認中,ai,5,value,AI,,false,,ai_unverified\r\n' +
    'AIのみ,ai,1,value,AI,,false,,ai_unverified\r\n' +
    '裁定,consensus,1,value,裁定,,false,,consensus\r\n');
  expect(result.skippedStudyIds).toEqual(['amb']);
  expect(result.droppedRowCount).toBe(1);
  expect(buildResultsLongCsv(studies, rows, fields, [], false)).toEqual(buildResultsLongCsv(studies, rows, fields));
});

test('仮 long は flag の後に source を出し、AI 補完セルには人の印を付けない', () => {
  const ai = { annotator: 'ai', annotatorType: 'ai' as const };
  const rows = [resultRow('d1', 'f1', 'arm:1', '5'), resultRow('d1', 'f1', 'arm:1', '6', ai),
    resultRow('d1', 'f1', 'arm:2', null), resultRow('d1', 'f1', 'arm:2', '8', ai)];
  const flags: Decision[] = ['arm:1', 'arm:2'].map((entityKey) => ({
    studyId: 'd1', fieldId: 'f1', entityKey, annotator: 'a@example.com', annotatorType: 'human_with_ai',
    schemaVersion: 1, decidedAt: 't1', decidedBy: 'a@example.com', action: 'flag_consult', value: null, note: null,
  }));
  const result = buildResultsLongCsv([study('d1', 'Study')], rows, [field('f1', 'events', 1)], flags, true);
  expect(result.csv).toBe(CSV_BOM +
    'study_label,annotator,entity_key,field_name,value,unit,not_reported,flag,source\r\n' +
    'Study,a@example.com,arm:1,events,5,,false,consult,human\r\n' +
    'Study,ai,arm:2,events,8,,false,,ai_unverified\r\n');
});
