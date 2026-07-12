import {
  applyNotApplicable,
  BINARY_ONLY_FIELD_NAMES,
  CONTINUOUS_ONLY_FIELD_NAMES,
} from '../../../../../src/features/export/rset/presetFields';
import type { RSetStatus } from '../../../../../src/features/export/rset/rsetStatus';

describe('CONTINUOUS_ONLY_FIELD_NAMES / BINARY_ONLY_FIELD_NAMES', () => {
  test('outcomeTemplates.ts のプリセット項目名から導出される', () => {
    expect(CONTINUOUS_ONLY_FIELD_NAMES.has('outcome_mean')).toBe(true);
    expect(CONTINUOUS_ONLY_FIELD_NAMES.has('outcome_sd')).toBe(true);
    expect(CONTINUOUS_ONLY_FIELD_NAMES.has('outcome_n')).toBe(true);
    expect(BINARY_ONLY_FIELD_NAMES.has('outcome_events')).toBe(true);
    expect(BINARY_ONLY_FIELD_NAMES.has('outcome_total')).toBe(true);
    // 2 集合は互いに素
    for (const name of CONTINUOUS_ONLY_FIELD_NAMES) {
      expect(BINARY_ONLY_FIELD_NAMES.has(name)).toBe(false);
    }
  });
});

describe('applyNotApplicable', () => {
  test('基底ステータスが no_data 以外ならそのまま返す（対岸判定は行わない）', () => {
    const siblings = new Map<string, RSetStatus>([['outcome_events', 'verified']]);
    expect(applyNotApplicable('outcome_mean', 'verified', siblings)).toBe('verified');
    expect(applyNotApplicable('outcome_mean', 'unverified', siblings)).toBe('unverified');
    expect(applyNotApplicable('outcome_mean', 'not_reported', siblings)).toBe('not_reported');
  });

  test('連続専用項目が no_data で、対岸の二値専用項目に実データがあれば not_applicable', () => {
    const siblings = new Map<string, RSetStatus>([
      ['outcome_mean', 'no_data'],
      ['outcome_events', 'verified'],
      ['outcome_total', 'verified'],
    ]);
    expect(applyNotApplicable('outcome_mean', 'no_data', siblings)).toBe('not_applicable');
  });

  test('二値専用項目が no_data で、対岸の連続専用項目に実データがあれば not_applicable', () => {
    const siblings = new Map<string, RSetStatus>([
      ['outcome_events', 'no_data'],
      ['outcome_mean', 'verified'],
    ]);
    expect(applyNotApplicable('outcome_events', 'no_data', siblings)).toBe('not_applicable');
  });

  test('対岸側も全滅（no_data のみ）なら no_data のまま', () => {
    const siblings = new Map<string, RSetStatus>([
      ['outcome_mean', 'no_data'],
      ['outcome_events', 'no_data'],
    ]);
    expect(applyNotApplicable('outcome_mean', 'no_data', siblings)).toBe('no_data');
  });

  test('対岸のプリセット項目が siblings に一切現れない（スキーマに無い）場合も no_data のまま', () => {
    const siblings = new Map<string, RSetStatus>([['outcome_mean', 'no_data']]);
    expect(applyNotApplicable('outcome_mean', 'no_data', siblings)).toBe('no_data');
  });

  test('どちらのプリセットにも属さない項目は no_data のまま（認識できない場合の既定）', () => {
    const siblings = new Map<string, RSetStatus>([
      ['custom_field', 'no_data'],
      ['outcome_events', 'verified'],
    ]);
    expect(applyNotApplicable('custom_field', 'no_data', siblings)).toBe('no_data');
  });
});
