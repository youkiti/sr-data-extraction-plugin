import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOutcomeGold } from './outcomeGold';
import type { GoldRow } from './validateGold';

function row(field_id: string, value_gold: string | null = '4', entity_key = 'arm:1'): GoldRow {
  return { field_id, entity_key, value_gold, not_reported: value_gold === null,
    acceptable_values: ['4.0'], source_page: 2, source_quote: 'quote', note: 'note' };
}
test('群と時点のキーを作り、値と許容値だけを保持する', () => {
  const result = buildOutcomeGold([row('severity_bl_mean'), row('severity_bl_sd'), row('severity_bl_n')]);
  assert.deepEqual(result.map((r) => r.field_id), ['or_mean', 'or_sd', 'or_n']);
  for (const r of result) {
    assert.equal(r.entity_key, 'outcome:severity|arm:1|time:baseline');
    assert.equal(r.value_gold, '4'); assert.deepEqual(r.acceptable_values, ['4.0']);
    assert.equal(r.source_page, null); assert.equal(r.source_quote, null); assert.equal(r.note, null);
  }
});
test('3 項目とも未報告なら組を出さない', () => {
  assert.deepEqual(buildOutcomeGold(['severity_bl_mean', 'severity_bl_sd', 'severity_bl_n'].map((id) => row(id, null))), []);
});
test('一部だけ報告済みなら未報告項目も行にする', () => {
  const result = buildOutcomeGold([row('severity_bl_mean', null), row('severity_bl_sd'), row('severity_bl_n', null)]);
  assert.deepEqual(result.map((r) => [r.not_reported, r.value_gold]), [[true, null], [false, '4'], [true, null]]);
});
test('存在しない元項目を未報告扱いにする', () => {
  const result = buildOutcomeGold([row('se_n')]);
  assert.deepEqual(result.map((r) => r.not_reported), [true, true, false]);
  assert.deepEqual(result[0]!.acceptable_values, []);
});
test('study と対応表外の項目は無視する', () => {
  assert.deepEqual(buildOutcomeGold([row('severity_bl_mean', '4', '-'), row('unknown')]), []);
});
test('群番号、対応表、項目の順に並べる', () => {
  const result = buildOutcomeGold([row('r_long', '4', 'arm:10'), row('remission', '4', 'arm:2'), row('severity_ep_n', '4', 'arm:2'), row('severity_bl_n', '4', 'arm:2')]);
  assert.deepEqual(result.map((r) => `${r.entity_key} ${r.field_id}`), [
    ...['or_mean', 'or_sd', 'or_n'].map((f) => `outcome:severity|arm:2|time:baseline ${f}`),
    ...['or_mean', 'or_sd', 'or_n'].map((f) => `outcome:severity|arm:2|time:post ${f}`),
    'outcome:remission|arm:2|time:post or_events', 'outcome:remission|arm:10|time:long or_events',
  ]);
});
test('remission は or_events の 1 行だけ', () => {
  const result = buildOutcomeGold([row('remission')]);
  assert.equal(result.length, 1); assert.equal(result[0]!.field_id, 'or_events');
});
test('対応表のすべての連続アウトカムを変換する', () => {
  const source = ['severity_mean_long', 'tst_mean', 'sol_mean', 'waso_mean'];
  assert.deepEqual(buildOutcomeGold(source.map((id) => row(id))).filter((r) => r.field_id === 'or_mean').map((r) => r.entity_key), [
    'outcome:severity|arm:1|time:long', 'outcome:tst|arm:1|time:post', 'outcome:sol|arm:1|time:post', 'outcome:waso|arm:1|time:post',
  ]);
});
