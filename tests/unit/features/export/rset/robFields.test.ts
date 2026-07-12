import { activeRobToolFieldSets } from '../../../../../src/features/export/rset/robFields';
import { makeField } from './testHelpers';

describe('activeRobToolFieldSets', () => {
  test('rob_domain レベルの judgement 項目が無ければ空配列', () => {
    const fields = [makeField({ fieldId: 'f-1', fieldName: 'sample_size', entityLevel: 'study' })];
    expect(activeRobToolFieldSets(fields)).toEqual([]);
  });

  test('rob2_judgement があれば rob2 セットを返す', () => {
    const fields = [
      makeField({ fieldId: 'f-j', fieldName: 'rob2_judgement', entityLevel: 'rob_domain' }),
      makeField({ fieldId: 'f-s', fieldName: 'rob2_support', entityLevel: 'rob_domain' }),
    ];
    const sets = activeRobToolFieldSets(fields);
    expect(sets).toHaveLength(1);
    expect(sets[0]?.tool).toBe('rob2');
    expect(sets[0]?.domains.length).toBeGreaterThan(0);
  });

  test('robins_i_judgement があれば robins_i セットを返す', () => {
    const fields = [makeField({ fieldId: 'f-j', fieldName: 'robins_i_judgement', entityLevel: 'rob_domain' })];
    const sets = activeRobToolFieldSets(fields);
    expect(sets.map((s) => s.tool)).toEqual(['robins_i']);
  });

  test('rob_domain レベル以外に同名フィールドがあっても判定に使わない', () => {
    const fields = [makeField({ fieldId: 'f-j', fieldName: 'rob2_judgement', entityLevel: 'outcome_result' })];
    expect(activeRobToolFieldSets(fields)).toEqual([]);
  });

  test('両ツールのテンプレートが同時挿入されていれば両方返す（rob2 が先頭）', () => {
    const fields = [
      makeField({ fieldId: 'f-1', fieldName: 'rob2_judgement', entityLevel: 'rob_domain' }),
      makeField({ fieldId: 'f-2', fieldName: 'robins_i_judgement', entityLevel: 'rob_domain' }),
    ];
    expect(activeRobToolFieldSets(fields).map((s) => s.tool)).toEqual(['rob2', 'robins_i']);
  });
});
