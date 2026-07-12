import {
  collectResultsDataDroppedFieldIssues,
  collectResultsDataDuplicateKeyIssues,
  collectStudyDataDroppedFieldIssues,
  collectStudyDataDuplicateKeyIssues,
} from '../../../../../src/features/export/rset/issues';
import { makeField, makeResultsDataRow, makeStudyDataRow } from './testHelpers';

describe('collectStudyDataDuplicateKeyIssues', () => {
  test('重複が無ければ空配列', () => {
    const rows = [makeStudyDataRow({ annotator: 'a@example.com' })];
    expect(collectStudyDataDuplicateKeyIssues(rows)).toEqual([]);
  });

  test('同一 (study_id, annotator, annotator_type) の重複を検出する', () => {
    const rows = [
      makeStudyDataRow({ annotator: 'a@example.com', updatedAt: 't1' }),
      makeStudyDataRow({ annotator: 'a@example.com', updatedAt: 't2' }),
    ];
    const issues = collectStudyDataDuplicateKeyIssues(rows);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ issueType: 'duplicate_key', studyId: 'study-1' });
    expect(issues[0]?.detail).toContain('2 件重複');
  });
});

describe('collectResultsDataDuplicateKeyIssues', () => {
  test('重複が無ければ空配列', () => {
    const rows = [makeResultsDataRow()];
    expect(collectResultsDataDuplicateKeyIssues(rows)).toEqual([]);
  });

  test('同一 (study_id, annotator, annotator_type, entity_key, field_id) の重複を検出する', () => {
    const rows = [
      makeResultsDataRow({ resultId: 'r-1' }),
      makeResultsDataRow({ resultId: 'r-2' }),
      makeResultsDataRow({ resultId: 'r-3' }),
    ];
    const issues = collectResultsDataDuplicateKeyIssues(rows);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.detail).toContain('3 件重複');
    expect(issues[0]?.fieldId).toBe('f-1');
    expect(issues[0]?.entityKey).toBe('outcome:mortality|arm:1');
  });
});

describe('collectStudyDataDroppedFieldIssues', () => {
  test('現行スキーマに存在する値列は issue にならない', () => {
    const fields = [makeField({ fieldName: 'sample_size', entityLevel: 'study' })];
    const rows = [makeStudyDataRow({ values: { sample_size: '120' } })];
    expect(collectStudyDataDroppedFieldIssues(rows, fields)).toEqual([]);
  });

  test('現行スキーマに無い値列を検出する（重複は 1 件に畳み込む）', () => {
    const fields = [makeField({ fieldName: 'sample_size', entityLevel: 'study' })];
    const rows = [
      makeStudyDataRow({ annotator: 'a@example.com', values: { old_field: '1' } }),
      makeStudyDataRow({ annotator: 'b@example.com', values: { old_field: '2' } }),
    ];
    const issues = collectStudyDataDroppedFieldIssues(rows, fields);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ issueType: 'dropped_unknown_field', studyId: 'study-1' });
    expect(issues[0]?.detail).toContain('old_field');
  });
});

describe('collectResultsDataDroppedFieldIssues', () => {
  test('現行 SchemaFields に存在する field_id は issue にならない', () => {
    const fields = [makeField({ fieldId: 'f-1' })];
    const rows = [makeResultsDataRow({ fieldId: 'f-1' })];
    expect(collectResultsDataDroppedFieldIssues(rows, fields)).toEqual([]);
  });

  test('現行 SchemaFields に無い field_id を検出する（重複は 1 件に畳み込む）', () => {
    const fields = [makeField({ fieldId: 'f-1' })];
    const rows = [
      makeResultsDataRow({ resultId: 'r-1', fieldId: 'f-unknown' }),
      makeResultsDataRow({ resultId: 'r-2', fieldId: 'f-unknown' }),
    ];
    const issues = collectResultsDataDroppedFieldIssues(rows, fields);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      issueType: 'dropped_unknown_field',
      studyId: 'study-1',
      fieldId: 'f-unknown',
      entityKey: 'outcome:mortality|arm:1',
    });
  });
});
