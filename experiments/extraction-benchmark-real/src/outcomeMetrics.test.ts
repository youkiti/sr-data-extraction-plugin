import assert from 'node:assert/strict';
import test from 'node:test';
import { discoverValue, outcomeState, outcomeVocabulary, type OutcomeRun, type OutcomeState } from './outcomeMetrics';
import type { GoldRow } from './validateGold';
import type { RunItem } from './metrics';

const gold: GoldRow = { field_id: 'or_mean', entity_key: 'outcome:severity|arm:1|time:post',
  value_gold: '4', not_reported: false, acceptable_values: ['4.0'], source_page: null, source_quote: null, note: null };
const item: RunItem = { fieldId: 'or_mean', entityKey: gold.entity_key, value: '4', notReported: false, quote: null, anchor: null };
const run = (items: RunItem[] = [item]): OutcomeRun => ({ error: null, formatError: null, items });
const cases: Array<[boolean, OutcomeRun | undefined, OutcomeState]> = [
  [false, undefined, 'no_run'], [false, { ...run(), error: 'error' }, 'run_failed'],
  [false, run([]), 'omitted'], [false, run([{ ...item, notReported: true }]), 'said_not_reported'],
  [false, run(), 'correct'], [false, run([{ ...item, value: '5' }]), 'wrong_value'],
  [true, undefined, 'no_run'], [true, { ...run(), formatError: 'error' }, 'run_failed'],
  [true, run([]), 'nr_omitted'], [true, run([{ ...item, notReported: true }]), 'nr_correct'],
  [true, run(), 'nr_gave_value'],
];
for (const [nr, input, expected] of cases) test(`状態 ${nr ? '未報告' : '報告済み'} ${expected}`, () => {
  assert.equal(outcomeState({ ...gold, not_reported: nr, value_gold: nr ? null : '4' }, input), expected);
});
test('null 値は未報告扱い、重複キーは後勝ち、許容値も一致する', () => {
  assert.equal(outcomeState(gold, run([{ ...item, value: null }])), 'said_not_reported');
  assert.equal(outcomeState({ ...gold, not_reported: true }, run([{ ...item, value: null }])), 'nr_correct');
  assert.equal(outcomeState(gold, run([item, { ...item, value: '5' }])), 'wrong_value');
  assert.equal(outcomeState(gold, run([{ ...item, value: '4.0' }])), 'correct');
  assert.equal(outcomeState(gold, run([{ ...item, entityKey: 'outcome:severity|arm:2|time:post' }])), 'omitted');
  assert.equal(outcomeState(gold, run([{ ...item, fieldId: 'or_sd' }])), 'omitted');
});
test('値の発見は slug と time を無視し、群一致版だけ群を比較する', () => {
  assert.deepEqual(discoverValue(gold, run([{ ...item, entityKey: 'outcome:other|arm:1' }])), { foundSameArm: true, foundAnyArm: true });
  assert.deepEqual(discoverValue(gold, run([{ ...item, entityKey: 'outcome:other|arm:2' }])), { foundSameArm: false, foundAnyArm: true });
});
test('失敗・欠落・項目違い・非 outcome・未報告・不一致は発見しない', () => {
  for (const input of [undefined, { ...run(), error: 'error' }, { ...run(), formatError: 'error' }, run([]),
    run([{ ...item, fieldId: 'or_n' }]), run([{ ...item, entityKey: 'arm:1' }]),
    run([{ ...item, notReported: true }]), run([{ ...item, value: null }]), run([{ ...item, value: '8' }])]) {
    assert.deepEqual(discoverValue(gold, input), { foundSameArm: false, foundAnyArm: false });
  }
  assert.deepEqual(discoverValue({ ...gold, not_reported: true }, run()), { foundSameArm: false, foundAnyArm: false });
});
test('語の一覧は昇順・重複なし、任意セグメント欠落と組・要素を数える', () => {
  assert.deepEqual(outcomeVocabulary([item, item, { ...item, entityKey: 'outcome:abc' },
    { ...item, entityKey: 'arm:1' }, { ...item, entityKey: 'invalid' }]), {
    slugs: ['abc', 'severity'], times: ['(none)', 'post'], arms: ['(none)', '1'], groupCount: 2, elementCount: 3,
  });
});
