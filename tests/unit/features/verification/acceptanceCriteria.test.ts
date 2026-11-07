import { buildAcceptanceCriteriaCsv, confirmCriteria, criteriaToRow, currentCriteria, emptyCriteriaDraft, evaluateCriteria,
  parseCriteriaRows, pilotStudyIds, validateCriteriaDraft, CRITERIA_GROUPS, type CriteriaDraft } from '../../../../src/features/verification/acceptanceCriteria';
import type { ComparisonCell } from '../../../../src/features/verification/aiHumanComparison';
import { parseCsv } from '../../../../src/features/export/parseCsv';

export const draft = (patch: Partial<CriteriaDraft> = {}): CriteriaDraft => ({ ...emptyCriteriaDraft(), min_accuracy: '75', ...patch });
export const criteria = (patch: Partial<CriteriaDraft> = {}) => confirmCriteria(draft(patch), [], 'owner@example.com', '2026-11-07T00:00:00Z', 0);
export const cell = (patch: Partial<ComparisonCell> = {}): ComparisonCell => ({ studyId: 's1', studyLabel: 'Study',
  fieldId: 'f1', fieldName: 'name', fieldLabel: 'Name', entityLevel: 'study', entityKey: 'study', group: 'independent',
  annotator: 'human', annotatorType: 'human_independent', category: 'match', reason: null, aiValue: 'a', humanValue: 'a', missingQuote: false, ...patch });
const pilots = [{ runType: 'pilot', studyIds: ['s1', 's2', 'inactive'] }, { runType: 'pilot', studyIds: ['s1'] },
  { runType: 'batch', studyIds: ['s3'] }];
const active = new Set(['s1', 's2', 's3']);

test('初期値は空、率を 1 つ以上必須とし、範囲・有限数・正の整数・レベルを検証する', () => {
  expect(emptyCriteriaDraft().min_accuracy).toBe('');
  expect(validateCriteriaDraft(emptyCriteriaDraft())).toEqual(['rates_required']);
  expect(validateCriteriaDraft(draft())).toEqual([]);
  for (const value of ['-1', '101', 'NaN', 'Infinity']) {
    expect(validateCriteriaDraft(draft({ max_fabrication_rate: value }))).toContain('max_fabrication_rate');
  }
  expect(validateCriteriaDraft(draft({ min_accuracy: '0', max_fabrication_rate: '100', min_compared_cells: '2' }))).toEqual([]);
  for (const value of ['0', '-1', '1.5', 'Infinity']) {
    expect(validateCriteriaDraft(draft({ min_compared_cells: value }))).toContain('min_compared_cells');
  }
  expect(validateCriteriaDraft(draft({ entity_levels: [] }))).toContain('entity_levels');
  expect(validateCriteriaDraft(draft({ entity_levels: ['invalid' as 'study'] }))).toContain('entity_levels');
  expect(validateCriteriaDraft(draft({ comparator: 'invalid' as 'independent' }))).toContain('comparator');
});

test('最大版を選び、開始済みパイロット数と確定者を記録する', () => {
  const first = criteria();
  const second = confirmCriteria(draft({ min_compared_cells: '3' }), [first], 'a@b', first.confirmed_at, 2);
  expect(second.version).toBe(2);
  expect(second.pilot_runs_before).toBe(2);
  expect(second.min_compared_cells).toBe(3);
  expect(currentCriteria([])).toBeNull();
  expect(currentCriteria([second, first])).toBe(second);
  for (const [value, email, now] of [[emptyCriteriaDraft(), 'a@b', first.confirmed_at], [draft(), '', first.confirmed_at], [draft(), 'a@b', 'bad']] as const) {
    expect(() => confirmCriteria(value, [], email, now, 0)).toThrow();
  }
});

test('行の往復、空欄・壊れた行の除外と並べ替え', () => {
  const first = criteria({ note: '改行\nと,カンマ' });
  const second = { ...first, version: 4 };
  const valid = criteriaToRow(first);
  const broken = [[], ...[0, 1, 2, 3, 4, 5, 9, 10].map((index) => valid.map((value, i) => i === index ? 'bad' : value)),
    valid.map((value, i) => i === 10 ? '' : value), valid.map((value, i) => i === 0 ? '0' : value),
    valid.map((value, i) => i === 10 ? '-1' : value)];
  for (const index of [1, 2]) {
    const missing = [...valid];
    delete missing[index];
    broken.push(missing);
  }
  const parsed = parseCriteriaRows([valid, ...broken, criteriaToRow(second)]);
  expect(parsed.versions).toEqual([second, first]);
  expect(parsed.ignoredCount).toBe(broken.length);
});

test('パイロットの研究の和集合とアクティブ制限', () => {
  expect([...pilotStudyIds(pilots, active)]).toEqual(['s1', 's2']);
});

test.each(CRITERIA_GROUPS)('比較相手 %s の全体だけを判定し、レベルと研究を絞る', (group) => {
  const c = criteria({ comparator: group, entity_levels: ['study'], min_accuracy: '100' });
  const cells = [cell({ group }), cell({ group, studyId: 'inactive', category: 'omission' }),
    cell({ group, studyId: 's3', category: 'omission' }), cell({ group, entityLevel: 'arm', category: 'omission' }),
    cell({ group: group === 'consensus' ? 'independent' : 'consensus', category: 'wrong_value' })];
  expect(evaluateCriteria(c, cells, pilots, active)).toMatchObject({ result: 'met', compared: 1, accuracy: 100, pilot_studies: 2 });
});

test('3 値とすべての判定不能理由、最小数と境界の等号', () => {
  const cells = [cell(), cell(), cell(), cell({ category: 'fabrication' })];
  const c = criteria({ max_fabrication_rate: '25', max_omission_rate: '0', max_wrong_value_rate: '0', min_compared_cells: '4' });
  expect(evaluateCriteria(c, cells, pilots, active)).toMatchObject({ result: 'met', compared: 4, accuracy: 75, fabrication_rate: 25 });
  expect(evaluateCriteria(c, cells, [], active).not_evaluable_reason).toBe('no_pilot');
  expect(evaluateCriteria(c, [], pilots, active).not_evaluable_reason).toBe('no_compared_cells');
  expect(evaluateCriteria(c, [cell({ category: 'incomparable' })], pilots, active).result).toBe('not_evaluable');
  expect(evaluateCriteria(c, [cell()], pilots, active).not_evaluable_reason).toBe('below_minimum');
  for (const patch of [{ min_accuracy: '75.01' }, { max_fabrication_rate: '24.99' }]) {
    expect(evaluateCriteria(criteria(patch), cells, pilots, active).result).toBe('not_met');
  }
  for (const [category, key] of [['omission', 'max_omission_rate'], ['wrong_value', 'max_wrong_value_rate']] as const) {
    expect(evaluateCriteria(criteria({ min_accuracy: '', [key]: '0' }), [cell({ category })], pilots, active).result).toBe('not_met');
  }
  expect(evaluateCriteria(criteria({ min_accuracy: '', max_fabrication_rate: '0' }), [cell()], pilots, active).result).toBe('met');
  const boundary = Array.from({ length: 100 }, (_, index) => cell({ category: index < 29 ? 'match' : 'omission' }));
  expect(evaluateCriteria(criteria({ min_accuracy: '29', max_omission_rate: '71' }), boundary, pilots, active).result).toBe('met');
  expect(evaluateCriteria(c, [], [], active).result).toBe('not_evaluable');
});

test('CSV は全版を現在値で判定し、空版はヘッダーのみ、率は百分率', () => {
  const csv = buildAcceptanceCriteriaCsv([criteria({ note: 'a,b\nc' })], [cell()], pilots, active);
  const rows = parseCsv(csv);
  expect(rows[0]).toContain('pilot_studies');
  expect(rows[1]).toContain('a,b\nc');
  expect(rows[1]).toContain('met');
  expect(rows[1]).toContain('100');
  expect(parseCsv(buildAcceptanceCriteriaCsv([], [], [], active))).toHaveLength(1);
  expect(buildAcceptanceCriteriaCsv([criteria()], [], [], active)).toContain('not_evaluable,no_pilot,0,');
});
