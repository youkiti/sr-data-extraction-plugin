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

  test('quadas3_rob_judgement + quadas3_applicability_judgement があれば quadas3 / quadas3_applicability の 2 セットを返す（issue #88）', () => {
    const fields = [
      makeField({ fieldId: 'f-j', fieldName: 'quadas3_rob_judgement', entityLevel: 'rob_domain' }),
      makeField({ fieldId: 'f-s', fieldName: 'quadas3_rob_support', entityLevel: 'rob_domain' }),
      makeField({ fieldId: 'f-aj', fieldName: 'quadas3_applicability_judgement', entityLevel: 'rob_domain' }),
      makeField({ fieldId: 'f-as', fieldName: 'quadas3_applicability_support', entityLevel: 'rob_domain' }),
    ];
    const sets = activeRobToolFieldSets(fields);
    expect(sets.map((s) => s.tool)).toEqual(['quadas3', 'quadas3_applicability']);
    expect(sets[0]?.domains.length).toBe(5); // D1〜D4 + overall
    expect(sets[1]?.domains.length).toBe(4); // D1〜D3 + overall（Analysis を除く）
  });

  test('quips_judgement があれば quips セットを返す（issue #88）', () => {
    const fields = [makeField({ fieldId: 'f-j', fieldName: 'quips_judgement', entityLevel: 'rob_domain' })];
    const sets = activeRobToolFieldSets(fields);
    expect(sets.map((s) => s.tool)).toEqual(['quips']);
    expect(sets[0]?.domains.length).toBe(6); // overall は無い
  });

  test('5 ツールすべてのテンプレートが同時挿入されていれば全 5 セットを定義順で返す', () => {
    const fields = [
      makeField({ fieldId: 'f-1', fieldName: 'rob2_judgement', entityLevel: 'rob_domain' }),
      makeField({ fieldId: 'f-2', fieldName: 'robins_i_judgement', entityLevel: 'rob_domain' }),
      makeField({ fieldId: 'f-3', fieldName: 'quadas3_rob_judgement', entityLevel: 'rob_domain' }),
      makeField({ fieldId: 'f-4', fieldName: 'quadas3_applicability_judgement', entityLevel: 'rob_domain' }),
      makeField({ fieldId: 'f-5', fieldName: 'quips_judgement', entityLevel: 'rob_domain' }),
    ];
    expect(activeRobToolFieldSets(fields).map((s) => s.tool)).toEqual([
      'rob2',
      'robins_i',
      'quadas3',
      'quadas3_applicability',
      'quips',
    ]);
  });
});
