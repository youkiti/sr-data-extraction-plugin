// 採用理由・gold 状態・対象外セルの分類を、条件を一つずつ変えて検査する。
import assert from 'node:assert/strict';
import test from 'node:test';
import type { RunItem } from './metrics';
import type { GoldRow } from './validateGold';
import { countCorrect, outsideAgreement, replacement, summarizeReask, targetState } from './reaskMetrics';

const item: RunItem = { fieldId: 'a', entityKey: 'arm:1', value: '42', notReported: false, quote: 'age 42', anchor: { status: 'exact' } };
const run = { error: null, formatError: null, items: [item] };
const gold: GoldRow = { field_id: 'a', entity_key: 'arm:1', not_reported: false, value_gold: '42', acceptable_values: [], source_page: null, source_quote: null, note: null };

test('引用と成功アンカーのある値を採用する（exact・normalized・fuzzy）', () => {
  for (const status of ['exact', 'normalized', 'fuzzy'] as const) {
    const candidate = { ...item, anchor: { status } };
    assert.deepEqual(replacement(item, { ...run, items: [candidate] }), { item: candidate, reason: null });
  }
});
test('no_reask_run', () => assert.equal(replacement(item, undefined).reason, 'no_reask_run'));
test('reask_failed は要素の有無より優先する', () => {
  assert.equal(replacement(item, { ...run, error: 'error' }).reason, 'reask_failed');
  assert.equal(replacement(item, { ...run, formatError: 'format', items: [] }).reason, 'reask_failed');
});
test('absent は field と entity の両方を照合する', () => {
  for (const other of [{ ...item, fieldId: 'b' }, { ...item, entityKey: 'arm:2' }]) {
    assert.equal(replacement(item, { ...run, items: [other] }).reason, 'absent');
  }
});
test('still_not_reported はフラグまたは null 値で決まる', () => {
  for (const candidate of [{ ...item, notReported: true }, { ...item, value: null }]) {
    assert.equal(replacement(item, { ...run, items: [candidate] }).reason, 'still_not_reported');
  }
});
test('no_quote はアンカー失敗より優先する', () => {
  assert.equal(replacement(item, { ...run, items: [{ ...item, quote: null }] }).reason, 'no_quote');
  assert.equal(replacement(item, { ...run, items: [{ ...item, quote: null, anchor: null }] }).reason, 'no_quote');
});
test('anchor_failed は null または failed で決まる', () => {
  for (const anchor of [null, { status: 'failed' } as const]) {
    assert.equal(replacement(item, { ...run, items: [{ ...item, anchor }] }).reason, 'anchor_failed');
  }
});
test('採用規則は重複キーの最後を使う', () => {
  const missing = { ...item, notReported: true };
  assert.equal(replacement(item, { ...run, items: [item, missing] }).reason, 'still_not_reported');
  assert.equal(replacement(item, { ...run, items: [missing, item] }).reason, null);
});

for (const [label, row, adopted] of [
  ['outside_gold', undefined, replacement(item, run)],
  ['rescued_correct', gold, replacement(item, run)],
  ['rescued_mismatch', { ...gold, value_gold: '43' }, replacement(item, run)],
  ['still_missed', gold, replacement(item, undefined)],
  ['fabricated', { ...gold, not_reported: true, value_gold: null }, replacement(item, run)],
  ['kept_not_reported', { ...gold, not_reported: true, value_gold: null }, replacement(item, undefined)],
] as const) {
  test(label, () => assert.equal(targetState(row, adopted), label));
}
test('gold 外は不採用でも外、許容値は正解とする', () => {
  assert.equal(targetState(undefined, replacement(item, undefined)), 'outside_gold');
  assert.equal(targetState({ ...gold, value_gold: 'other', acceptable_values: ['４２'] }, replacement(item, run)), 'rescued_correct');
});

for (const [label, items] of [
  ['same', [{ ...item, value: ' ４２ ' }]], ['different', [{ ...item, value: '43' }]],
  ['now_not_reported', [{ ...item, notReported: true }]], ['absent', []],
] as const) {
  test(`対象外 ${label}`, () => {
    const result = outsideAgreement(run, { ...run, items: [...items] }, ['a']);
    assert.deepEqual(result.counts, { same: 0, different: 0, now_not_reported: 0, absent: 0, [label]: 1 });
    assert.equal(result.excludedPapers, 0);
  });
}
test('対象外は項目・初回フラグ・値で絞り、null 値と後勝ちも扱う', () => {
  const initial = { ...run, items: [item, item, { ...item, fieldId: 'b' }, { ...item, fieldId: 'c', notReported: true }, { ...item, fieldId: 'd', value: null }] };
  const after = { ...run, items: [item, { ...item, value: null }] };
  assert.deepEqual(outsideAgreement(initial, after, ['a', 'c', 'd']).counts, { same: 0, different: 0, now_not_reported: 1, absent: 0 });
});
test('欠落・失敗論文は対象外集計から除外する', () => {
  for (const after of [undefined, { ...run, error: 'error' }, { ...run, formatError: 'format' }]) {
    assert.deepEqual(outsideAgreement(run, after, ['a']), { counts: { same: 0, different: 0, now_not_reported: 0, absent: 0 }, excludedPapers: 1 });
  }
});
test('整数で正解数を数え、差分式と置換後の行数を照合する', () => {
  const initial = { ...run, items: [{ ...item, notReported: true, value: null }] };
  const rescued = summarizeReask(initial, run, [item], [gold]);
  assert.equal(rescued.initialCorrect, 0);
  assert.equal(rescued.mergedCorrect, 1);
  assert.equal(rescued.states.rescued_correct, 1);
  const fabricated = summarizeReask(initial, run, [item], [{ ...gold, not_reported: true, value_gold: null }]);
  assert.equal(fabricated.initialCorrect, 1);
  assert.equal(fabricated.mergedCorrect, 0);
  assert.equal(fabricated.states.fabricated, 1);
  assert.equal(countCorrect([gold], [item, { ...item, value: 'wrong' }]), 0);
  assert.throws(() => summarizeReask(run, run, [item], [gold]), /差分式/);
});
test('不採用理由と状態の全件数が対象数に一致する', () => {
  const result = summarizeReask({ ...run, items: [{ ...item, notReported: true }] }, undefined, [item], [gold]);
  assert.equal(result.targetCount, 1);
  assert.equal(result.states.still_missed, 1);
  assert.equal(result.reasons.no_reask_run, 1);
});
