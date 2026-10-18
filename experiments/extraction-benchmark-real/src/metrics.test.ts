import assert from 'node:assert/strict';
import test from 'node:test';
import { computePerRunMetrics, mean, matchesValue, matchesValueNumeric, type ScorableRun } from './metrics';
import type { GoldFile } from './validateGold';

const gold: GoldFile = {
  pdf_id: 'paper',
  pmcid: '', schema_version: 1, created_by: 'test', created_at: '2026-07-22',
  rows: [
    { field_id: 'age_mean', entity_key: 'arm:1', not_reported: false, value_gold: '42', acceptable_values: [], source_page: null, source_quote: null, note: null },
    { field_id: 'age_sd', entity_key: 'arm:1', not_reported: true, value_gold: null, acceptable_values: [], source_page: null, source_quote: null, note: null },
    { field_id: 'country', entity_key: '-', not_reported: false, value_gold: 'Japan', acceptable_values: [], source_page: null, source_quote: null, note: null },
  ],
};

function makeRun(): ScorableRun {
  return {
    runId: 'run', model: 'model', inputMode: 'text_with_page_images', pdfId: 'paper', repeat: 1,
    elapsedMs: 100, tokensIn: 10, tokensOut: 5, costUsd: 0.01, error: null, formatError: null,
    items: [
      { fieldId: 'age_mean', entityKey: 'arm:1', value: '42', notReported: false, quote: 'age 42', anchor: { status: 'exact' } },
      { fieldId: 'age_sd', entityKey: 'arm:1', value: null, notReported: true, quote: null, anchor: null },
      { fieldId: 'country', entityKey: '-', value: 'wrong', notReported: false, quote: 'Japan', anchor: { status: 'failed' } },
      { fieldId: 'extra', entityKey: '-', value: 'x', notReported: false, quote: null, anchor: null },
    ],
  };
}

test('全体と表由来 slice、not_reported、anchor、欠落・余剰を集計する', () => {
  const result = computePerRunMetrics(makeRun(), gold);
  assert.equal(result.overall.accuracy, 0.6667);
  assert.equal(result.tableLikely.accuracy, 1);
  assert.equal(result.overall.notReportedSensitivity, 1);
  assert.equal(result.overall.notReportedSpecificity, 1);
  assert.equal(result.overall.majorErrorRate, 0.5);
  assert.equal(result.anchorSuccessRate, 0.5);
  assert.equal(result.verbatimRate, 0.5);
  assert.equal(result.missingGoldCount, 0);
  assert.equal(result.extraAiCount, 1);
  assert.equal(result.failed, false);
});

test('失敗理由、欠落、空 slice と null 平均を扱う', () => {
  const run = makeRun();
  run.error = 'transport';
  run.items = [];
  const result = computePerRunMetrics(run, { ...gold, rows: [gold.rows[2]!] });
  assert.equal(result.failed, true);
  assert.equal(result.failureReason, 'transport');
  assert.equal(result.tableLikely.accuracy, null);
  assert.equal(result.anchorSuccessRate, null);
  assert.equal(result.missingGoldCount, 1);
  assert.equal(mean([null, null]), null);
  assert.equal(mean([1, null, 0]), 0.5);
});


test('数値一致: 中黒・ゼロ・桁区切り・符号を十進文字列として比較する', () => {
  for (const [ai, expected] of [
    ['19·2', '19.2'], ['19⋅2', '19.2'], ['4.70', '4.7'], ['12.00', '12'],
    ['1,234', '1234'], ['12,345.6', '12345.6'], ['+0012.', '12'], ['−4.70', '-4.7'],
    ['-0.00', '0'], [' .50 ', '0.5'], ['-1,234', '-1234'],
    ['9007199254740993.00', '9007199254740993'],
  ]) {
    const row = { ...gold.rows[0]!, value_gold: expected! };
    assert.equal(matchesValueNumeric(ai!, row), true, ai);
  }
});

test('数値一致: 単位・範囲・空・不正な区切り・異なる数値を同一視しない', () => {
  for (const [ai, expected] of [
    ['87%', '87'], ['3-5', '3'], ['', '0'], ['1,23', '123'], ['0.87', '87'],
    ['5.78', '346.8'], ['9007199254740993', '9007199254740992'], ['1e3', '1000'],
  ]) assert.equal(matchesValueNumeric(ai!, { ...gold.rows[0]!, value_gold: expected! }), false, ai);
  assert.equal(matchesValueNumeric(null, gold.rows[0]!), false);
  assert.equal(matchesValueNumeric('Japan', gold.rows[2]!), true);
  assert.equal(matchesValueNumeric('4.70', { ...gold.rows[0]!, acceptable_values: ['4.7'] }), true);
});

test('副指標: 未報告・欠落・空 slice は主指標と同じ扱いで、主指標を変えない', () => {
  const run = makeRun();
  run.items[0]!.value = '42.00';
  assert.equal(matchesValue(run.items[0]!.value, gold.rows[0]!), false);
  const result = computePerRunMetrics(run, gold);
  assert.equal(result.overall.accuracy, 0.3333);
  assert.equal(result.overall.accuracyNumeric, 0.6667);
  assert.equal(result.overall.majorErrorRate, 1);
  run.items = [];
  assert.equal(computePerRunMetrics(run, gold).overall.accuracyNumeric, 0);
  assert.equal(computePerRunMetrics(run, { ...gold, rows: [] }).overall.accuracyNumeric, null);
});
