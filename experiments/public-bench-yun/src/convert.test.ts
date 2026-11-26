import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { writeJson } from '../../cochrane-numeric-benchmark/src/io';
import type { LedgerEntry } from '../../cochrane-numeric-benchmark/src/ledger';
import type { RunRecord, ScoringItem } from './runner';
import type { Study } from './dataset';
import { convertField, convertStudies, loadRuns, secondaryMetrics, TASK_FIELDS, toUpstreamValue, toUpstreamValueNoComma } from './convert';

const field = 'intervention_events';
const item = (value: string | null, overrides: Partial<ScoringItem> = {}): ScoringItem => ({ fieldId: field,
  entityKey: 'outcome:o1|arm:1|time:1d', value, notReported: false, quote: '引用', anchorStatus: 'exact', ...overrides });
const study: Study = { pmcid: 2, studyKey: 'PMC2', icos: [
  { id: 1, outcomeId: 'o1', outcome_type: 'binary', outcome: 'a', intervention: 'i', comparator: 'c' },
  { id: 2, outcomeId: 'o2', outcome_type: 'continuous', outcome: 'b', intervention: 'i', comparator: 'c' },
] };

test('数値化は指定のカンマ・先頭マイナスだけを扱う', () => {
  for (const [text, expected] of [['12', 12], [' 3.50 ', 3.5], ['1,525', 1525], ['−1.2', -1.2], ['－1.2', -1.2],
    ['12%', '12%'], ['1e3', '1e3'], ['1,52', '1,52'], ['−12%', '−12%'], ['+.5', 0.5], ['-1,525', -1525]] as const) {
    assert.equal(toUpstreamValue(text), expected);
  }
  assert.equal(toUpstreamValueNoComma('1,525'), '1,525');
  assert.equal(toUpstreamValueNoComma('−1.2'), -1.2);
});
test('run 欠落を拒否し、失敗は全 ICO・全フィールドで x と一致させない', () => {
  assert.throws(() => convertField(field, 'o1', null), /未実行/);
  assert.throws(() => convertStudies([study], new Map()), /未実行/);
  for (const outcome of ['format_error', 'request_failed'] as const) {
    const rows = convertStudies([study], new Map([['PMC2', { outcome, items: [item('12')] }]]));
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(Object.keys(row.fields).length, TASK_FIELDS[row.outcomeType].length);
      for (const answer of Object.values(row.fields)) assert.deepEqual(answer, {
        value: '__run_failed__', valueNoComma: '__run_failed__', raw: null, state: 'run_failed',
      });
    }
  }
});
test('候補は outcome と field で絞り、arm と time は無視する', () => {
  const answer = convertField(field, 'o1', { outcome: 'ok', items: [item('12'),
    item('12.0', { entityKey: 'outcome:o1|arm:2|time:2d' }), item('99', { entityKey: 'outcome:o2' }),
    item('99', { fieldId: 'comparator_events' }), item('99', { entityKey: 'arm:1' }),
    item('99', { entityKey: 'rob:domain|outcome:o1' }), item('99', { entityKey: 'invalid' })] });
  assert.deepEqual(answer, { value: 12, valueNoComma: 12, raw: '12', state: 'value' });
});
test('重複した数値は一つ、異なる値は不一致、未報告と未返却は区別', () => {
  const answer = (items: ScoringItem[]) => convertField(field, 'o1', { outcome: 'ok', items });
  assert.equal(answer([item('12'), item('12.0')]).value, 12);
  assert.equal(answer([item('12'), item('13')]).value, '__multiple_values__');
  assert.equal(answer([item('12'), item('13')]).state, 'multiple_values');
  assert.equal(answer([item('12', { notReported: true })]).state, 'not_reported');
  assert.equal(answer([item(null), item('  ')]).state, 'not_returned');
  assert.equal(answer([]).value, 'x');
  assert.equal(answer([item(null, { notReported: true })]).value, 'x');
  assert.equal(answer([item(null, { notReported: true }), item('12')]).state, 'value');
  assert.deepEqual(answer([item('1,525')]), { value: 1525, valueNoComma: '1,525', raw: '1,525', state: 'value' });
  assert.equal(answer([item('1,525'), item('1525')]).valueNoComma, '__multiple_values__');
});
test('予定 run ファイルと台帳が揃うまで読み込みを拒否する', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yun-convert-'));
  const run = { runId: 'model__PMC2', model: 'model', studyKey: 'PMC2', promptVersion: 17, outcome: 'ok', items: [] };
  try {
    await assert.rejects(loadRuns(dir, 'model', [study], [], 17), /未実行/);
    await writeJson(path.join(dir, 'model__PMC2.json'), run);
    await assert.rejects(loadRuns(dir, 'model', [study], [], 17), /台帳/);
    const ledger = [{ runId: run.runId }] as LedgerEntry[];
    assert.equal((await loadRuns(dir, 'model', [study], ledger, 17)).length, 1);
    await assert.rejects(loadRuns(dir, 'model', [study], ledger, 18), /版数/);
    await writeJson(path.join(dir, 'model__PMC2.json'), { ...run, model: 'other' });
    await assert.rejects(loadRuns(dir, 'model', [study], ledger, 17), /識別子/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('副指標は全試行を合算し、codex の費用を null にする', () => {
  const run = { runId: 'gpt-6.2-sol__PMC2', model: 'gpt-6.2-sol', studyKey: 'PMC2', outcome: 'ok', elapsedMs: 50,
    items: [item('12'), item(null, { notReported: true }), item('13', { anchorStatus: 'failed' }), item('14', { anchorStatus: null })] } as RunRecord;
  const ledger: LedgerEntry[] = [1, 2].map((attempt) => ({ runId: run.runId, attempt, attemptAt: '2026-11-27T00:00:00Z',
    model: run.model, studyKey: run.studyKey, outcome: attempt === 1 ? 'request_failed' : 'ok', tokensIn: 10, tokensOut: 2,
    cachedTokensIn: null, guardCostUsd: 0, costBasis: 'measured', elapsedMs: 30, failureClass: attempt === 1 ? 'timeout' : null }));
  const stats = secondaryMetrics(run.model, [study], [run], ledger);
  assert.equal(stats.attempts.total, 2); assert.equal(stats.attempts.retries, 1);
  assert.equal(stats.attempts.byFailureClass.timeout, 1);
  assert.equal(stats.tokens.tokensIn.total, 20); assert.equal(stats.tokens.tokensOut.perRctMean, 4);
  assert.equal(stats.elapsed.mean, 50); assert.equal(stats.elapsed.median, 50); assert.equal(stats.elapsed.totalLedger, 60);
  assert.equal(stats.quotes.total, 3); assert.equal(stats.quotes.successRate, 1 / 3);
  assert.equal(stats.quotes.nonFailedRate, 2 / 3);
  assert.equal(stats.cost.reportCostUsd, null); assert.equal(stats.cost.listCostUsd, null);
  assert.equal(stats.cost.costNote, 'subscription_not_computable');
});
