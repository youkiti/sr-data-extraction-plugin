import { NOT_REPORTED_TOKEN } from '../../../../../src/domain/annotation';
import { parseCsv } from '../../../../../src/features/export/parseCsv';
import { buildTab1Csv } from '../../../../../src/features/export/rset/buildTab1Csv';
import { makeEvidence, makeField, makeStudy, makeStudyDataRow } from './testHelpers';

describe('buildTab1Csv', () => {
  test('study が無ければヘッダーのみ', () => {
    const result = buildTab1Csv([], [], [], [], []);
    expect(result.csv).toBe(`${result.header.join(',')}\r\n`);
    expect(result.statusCsv).toBe(`${result.header.join(',')}\r\n`);
    expect(result.rowCount).toBe(0);
    expect(result.issues).toEqual([]);
  });

  test('verified / not_reported / unverified / no_data の 4 状態を横持ちし、値表は verified のみ実値を出す', () => {
    const fields = [
      makeField({ fieldId: 'f-verified', fieldName: 'sample_size', fieldIndex: 1, entityLevel: 'study' }),
      makeField({ fieldId: 'f-nr', fieldName: 'blinding', fieldIndex: 2, entityLevel: 'study' }),
      makeField({ fieldId: 'f-unverified', fieldName: 'design', fieldIndex: 3, entityLevel: 'study' }),
      makeField({ fieldId: 'f-nodata', fieldName: 'setting', fieldIndex: 4, entityLevel: 'study' }),
    ];
    const studies = [makeStudy({ studyId: 'study-1', studyLabel: 'Smith 2020', registrationId: 'NCT001' })];
    const studyRows = [
      makeStudyDataRow({
        studyId: 'study-1',
        annotator: 'reviewer@example.com',
        annotatorType: 'human_with_ai',
        schemaVersion: 4,
        values: { sample_size: '120', blinding: NOT_REPORTED_TOKEN, design: null },
      }),
    ];
    // design は AI Evidence があるが人間の判定 0 件 → unverified、setting は Evidence すら無い → no_data
    const evidences = [makeEvidence({ studyId: 'study-1', fieldId: 'f-unverified', entityKey: '-' })];

    const result = buildTab1Csv(studies, studyRows, evidences, ['study-1'], fields);
    const valueRecords = parseCsv(result.csv);
    const statusRecords = parseCsv(result.statusCsv);

    expect(valueRecords[0]).toEqual([
      'study_id',
      'study_label',
      'registration_id',
      'n_documents',
      'schema_version',
      'sample_size',
      'blinding',
      'design',
      'setting',
    ]);
    expect(valueRecords[1]).toEqual(['study-1', 'Smith 2020', 'NCT001', '1', '4', '120', '', '', '']);
    expect(statusRecords[1]).toEqual([
      'study-1',
      'Smith 2020',
      'NCT001',
      '1',
      '4',
      'verified',
      'not_reported',
      'unverified',
      'no_data',
    ]);
    expect(result.rowCount).toBe(1);

    // unverified セルは issue として明示される
    const unverifiedIssues = result.issues.filter((issue) => issue.issueType === 'unverified_cell');
    expect(unverifiedIssues).toHaveLength(1);
    expect(unverifiedIssues[0]).toMatchObject({ studyId: 'study-1', fieldId: 'f-unverified', entityKey: '-' });
  });

  test('registration_id が無い study は空文字、n_documents は 0 件なら 0', () => {
    const fields = [makeField({ fieldId: 'f-1', fieldName: 'sample_size', entityLevel: 'study' })];
    const studies = [makeStudy({ studyId: 'study-1', registrationId: null })];
    const studyRows = [makeStudyDataRow({ studyId: 'study-1', values: { sample_size: '10' } })];
    const result = buildTab1Csv(studies, studyRows, [], [], fields);
    const records = parseCsv(result.csv);
    expect(records[1]?.[2]).toBe(''); // registration_id
    expect(records[1]?.[3]).toBe('0'); // n_documents
  });

  test('n_documents は Documents 1 件 = 1 要素の studyId 配列を件数集計する', () => {
    const fields = [makeField({ fieldId: 'f-1', fieldName: 'sample_size', entityLevel: 'study' })];
    const studies = [makeStudy({ studyId: 'study-1' })];
    const studyRows = [makeStudyDataRow({ studyId: 'study-1', values: { sample_size: '10' } })];
    const result = buildTab1Csv(studies, studyRows, [], ['study-1', 'study-1', 'study-2'], fields);
    const records = parseCsv(result.csv);
    expect(records[1]?.[3]).toBe('2');
  });

  test('確定 annotator の行が 0 件（未着手）の study は issue を積まず黙って除外する', () => {
    const fields = [makeField({ fieldId: 'f-1', fieldName: 'sample_size', entityLevel: 'study' })];
    const studies = [makeStudy({ studyId: 'study-1' })];
    const result = buildTab1Csv(studies, [], [], [], fields);
    expect(result.rowCount).toBe(0);
    expect(result.issues).toEqual([]);
  });

  test('確定 annotator を一意に特定できない study（human 行複数）は issue を積んで除外する', () => {
    const fields = [makeField({ fieldId: 'f-1', fieldName: 'sample_size', entityLevel: 'study' })];
    const studies = [makeStudy({ studyId: 'study-1' })];
    const studyRows = [
      makeStudyDataRow({ studyId: 'study-1', annotator: 'a@example.com', values: { sample_size: '1' } }),
      makeStudyDataRow({ studyId: 'study-1', annotator: 'b@example.com', values: { sample_size: '2' } }),
    ];
    const result = buildTab1Csv(studies, studyRows, [], [], fields);
    expect(result.rowCount).toBe(0);
    expect(result.issues).toEqual([
      {
        issueType: 'skipped_study_no_final_annotator',
        studyId: 'study-1',
        fieldId: '',
        entityKey: '-',
        detail: expect.stringContaining('tab1.csv'),
      },
    ]);
  });

  test('study_label が重複していても study_id で行を区別する', () => {
    const fields = [makeField({ fieldId: 'f-1', fieldName: 'sample_size', entityLevel: 'study' })];
    const studies = [
      makeStudy({ studyId: 'study-1', studyLabel: 'Smith 2020' }),
      makeStudy({ studyId: 'study-2', studyLabel: 'Smith 2020' }),
    ];
    const studyRows = [
      makeStudyDataRow({ studyId: 'study-1', values: { sample_size: '10' } }),
      makeStudyDataRow({ studyId: 'study-2', values: { sample_size: '20' } }),
    ];
    const result = buildTab1Csv(studies, studyRows, [], [], fields);
    const records = parseCsv(result.csv);
    expect(records.slice(1).map((r) => [r[0], r[1], r[5]])).toEqual([
      ['study-1', 'Smith 2020', '10'],
      ['study-2', 'Smith 2020', '20'],
    ]);
  });

  test('consensus 行が確定 annotator のときは consensus の schema_version を採用する', () => {
    const fields = [makeField({ fieldId: 'f-1', fieldName: 'sample_size', entityLevel: 'study' })];
    const studies = [makeStudy({ studyId: 'study-1' })];
    const studyRows = [
      makeStudyDataRow({
        studyId: 'study-1',
        annotator: 'human@example.com',
        annotatorType: 'human_with_ai',
        schemaVersion: 1,
        values: { sample_size: '1' },
      }),
      makeStudyDataRow({
        studyId: 'study-1',
        annotator: 'consensus',
        annotatorType: 'consensus',
        schemaVersion: 2,
        values: { sample_size: '2' },
      }),
    ];
    const result = buildTab1Csv(studies, studyRows, [], [], fields);
    const records = parseCsv(result.csv);
    expect(records[1]).toEqual(['study-1', 'Smith 2020', '', '0', '2', '2']);
  });
});
