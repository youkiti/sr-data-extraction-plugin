import assert from 'node:assert/strict';
import test from 'node:test';
import { answerState, errorCategory, matchesGold, metrics, scoreValues, type ScoreRun } from './score';
import { bootstrap, mulberry32, quantile } from './bootstrap';
import type { EvalValue, Label } from './evaluationSet';
import type { RunRecord, ScoringItem } from './runner';
import type { LedgerEntry } from './ledger';
import { assertLabels } from './goldLock';

const value = (overrides: Partial<EvalValue> = {}): EvalValue => ({ tier: 'cc-by', reviewId: 'REV1', studyKey: 'cc-by/REV1/S1',
  rowId: 'REV1:r:1', itemIndex: 1, field: 'experimental_mean', group: 'experimental', valueKind: 'mean', dataType: 'continuous',
  gold: '2', label: 'reported', provenance: 'unknown', figureOnly: null, ...overrides });
const item = (text: string | null = '2', overrides: Partial<ScoringItem> = {}): ScoringItem => ({ fieldId: 'experimental_mean',
  entityKey: 'outcome:o1|arm:1|time:1d', value: text, notReported: false, quote: 'Synthetic quote', anchorStatus: 'exact', ...overrides });
const run = (items: ScoringItem[], outcome: ScoreRun['outcome'] = 'ok'): ScoreRun => ({ items, outcome });

test('数値一致は表記差を許容し単位差と丸めを許容しない', () => {
  for (const [a, b] of [['78.0', '78'], ['1,234', '1234'], ['0·5', '0.5'], ['−2', '-2'], [' 2 ', '2'], ['０', '0']]) assert.ok(matchesGold(a!, b!));
  assert.equal(matchesGold('2 mg', '2'), false); assert.equal(matchesGold('2.01', '2'), false);
  assert.equal(matchesGold('1e3', '1000'), false);
});
test('全回答状態と候補の outcome・field 絞り込み', () => {
  const v = value();
  assert.equal(answerState(v, null).state, 'run_missing');
  assert.equal(answerState(v, run([], 'request_failed')).state, 'run_failed');
  assert.equal(answerState(v, run([item()])).state, 'match');
  assert.equal(answerState(v, run([item('3')])).state, 'wrong_value');
  assert.equal(answerState(v, run([item('2'), item('3')])).state, 'multiple_values');
  assert.equal(answerState(v, run([item('2'), item('2.0')])).state, 'match');
  assert.equal(answerState(v, run([item(null, { notReported: true })])).state, 'not_reported');
  assert.equal(answerState(v, run([item(null), item(' ')])).state, 'not_returned');
  assert.equal(answerState(v, run([])).state, 'not_returned');
  assert.equal(answerState(v, run([item('2', { entityKey: 'outcome:o2' }), item('2', { fieldId: 'control_mean' }), item('2', { entityKey: 'invalid' })])).state, 'not_returned');
  assert.equal(answerState(v, run([item('3'), item(null, { notReported: true })])).state, 'wrong_value');
});
test('reported の誤りは 0・1・2・3・4 の優先順位で分類', () => {
  const v = value();
  const values = [v, value({ group: 'control', field: 'control_mean', gold: '3' }), value({ itemIndex: 2, gold: '3' }), value({ itemIndex: 3, gold: '4' })];
  const category = (r: ScoreRun) => errorCategory(v, answerState(v, r), values);
  assert.equal(category(run([], 'format_error')), '0_run_failed');
  assert.equal(category(run([item(null, { notReported: true })])), '1_not_reported');
  assert.equal(category(run([])), '1_not_returned');
  assert.equal(category(run([item('3')])), '2_group');
  assert.equal(category(run([item('4')])), '3_item');
  assert.equal(category(run([item('5')])), '4_other');
  assert.equal(category(run([item('2'), item('3')])), '4_multiple_values');
  assert.equal(category(run([item('2')])), null);
  assert.equal(errorCategory(value({ label: 'different_value' }), answerState(v, run([item('3')])), values), null);
});

function handFixture() {
  const values: EvalValue[] = [];
  const items: ScoringItem[] = [];
  // 手計算: REV1 reported は 1/4、REV2 は 1/1、macro=.625、micro=.4。
  // reported の wrong=1/5、not_reported=1/5、not_returned=1/5。
  // 本文なしは回答 1/3、正確度=(2+1)/(5+3)=3/8、derivable=1/1、全 gold=5/10。
  const rows: [string, Label, string | null, boolean][] = [
    ['2', 'reported', '2', false], ['2', 'reported', '3', false], ['2', 'reported', null, true], ['2', 'reported', null, false],
    ['2', 'not_in_documents', '2', false], ['2', 'not_in_documents', null, true], ['2', 'derivable', '2', false], ['2', 'different_value', '2', false],
    ['2', 'not_in_documents', null, false],
  ];
  rows.forEach(([gold, label, text, nr], i) => {
    values.push(value({ itemIndex: i + 1, rowId: `REV1:r:${i + 1}`, gold, label }));
    if (i !== 3) items.push(item(text, { entityKey: `outcome:o${i + 1}`, notReported: nr, anchorStatus: i === 1 ? 'failed' : 'exact', quote: text ? 'Quote' : null }));
  });
  values.push(value({ reviewId: 'REV2', studyKey: 'cc-by/REV2/S2', rowId: 'REV2:r:1' }));
  const runs = new Map<string, ScoreRun>([['cc-by/REV1/S1', run(items)], ['cc-by/REV2/S2', run([item()])]]);
  return { values, runs };
}
test('二レビューの手計算による全副指標と層別、different_value の分母除外', () => {
  const { values, runs } = handFixture();
  const rows = scoreValues(values, runs);
  const records = [...runs].map(([studyKey, r], i) => ({ ...r, studyKey, runId: `run${i}`, elapsedMs: i ? 300 : 100 } as RunRecord));
  const ledger: LedgerEntry[] = records.flatMap((r) => [1, 2].map((attempt) => ({ runId: r.runId, model: 'claude-sonnet-5-5',
    studyKey: r.studyKey, attempt, attemptAt: '2026-11-24T00:00:00Z', outcome: 'ok', tokensIn: 1000000,
    tokensOut: 0, cachedTokensIn: 0, guardCostUsd: 2, costBasis: 'measured', elapsedMs: attempt === 1 ? 50 : 150,
    httpStatus: attempt === 1 ? 503 : null, failureClass: attempt === 1 ? 'server_error' : null })));
  const m = metrics(rows, records, ledger);
  assert.equal(m.primary, 0.625); assert.equal(m.micro, 0.4); assert.equal(m.reviewsUsed, 2);
  assert.equal(m.wrongValueRate, 0.2); assert.equal(m.notReportedMissRate, 0.2); assert.equal(m.notReturnedRate, 0.2);
  assert.equal(m.answerRateNotInDocuments, 1 / 3); assert.equal(m.accuracy, 3 / 8); assert.equal(m.derivableMatch, 1);
  assert.equal(m.notReturnedNotInDocuments, 1);
  assert.equal(m.goldMatch, 5 / 10); assert.equal(m.differentValueCount, 1);
  // 引用付き候補は 6、failed は 1。費用は各研究 2 試行 × $2。
  assert.equal(m.anchorSuccessRate, 5 / 6); assert.equal(m.reportCostPerStudy, 4); assert.equal(m.listCostPerStudy, 4);
  assert.equal(m.elapsedMsSuccessfulRunMean, 200); assert.equal(m.elapsedMsSuccessfulRunMedian, 200);
  assert.equal(m.elapsedMsPerRequestMean, 100); assert.equal(m.elapsedMsPerRequestMedian, 100);
  assert.equal(m.retries, 2); assert.equal(m.failureClasses.null, 2); assert.equal(m.failureClasses.server_error, 2);
  assert.equal(m.failedRuns, 0); assert.equal(m.failedRunRate, 0);
  for (const dimension of ['tier', 'dataType', 'valueKind', 'provenance', 'figureOnly', 'relabelled']) {
    const slice = Object.values(m.strata[dimension]!)[0]!; assert.equal(slice.primary, 0.625); assert.equal(slice.micro, 0.4); assert.equal(slice.values, 10);
  }
  const failedRecords = [{ ...records[0]!, outcome: 'request_failed' as const }, records[1]!];
  const failedMetrics = metrics(rows, failedRecords, ledger);
  assert.equal(failedMetrics.failedRuns, 1); assert.equal(failedMetrics.failedRunRate, 0.5); assert.equal(failedMetrics.elapsedMsSuccessfulRunMean, 300);
  assertLabels(values); assert.throws(() => assertLabels([value({ label: null })]), /未裁定/);
});
test('Haiku の研究あたり定価は全試行のトークンから計算する', () => {
  const record: RunRecord = { runId: 'haiku', studyKey: 'cc-by/REV1/S1', outcome: 'ok', items: [], elapsedMs: 100,
    model: 'claude-haiku-5-5', tier: 'cc-by', reviewId: 'REV1', promptVersion: 1, executedAt: '2026-11-25T00:00:00Z',
    attempts: 2, tokensIn: 18_000, tokensOut: 3_000, cachedTokensIn: 0, thoughtsTokens: null,
    sentSettings: null, responseModel: null, guardCostUsd: 0.0165, listCostUsd: 0.0033, reportCostUsd: 0.0033,
    costBasis: 'measured', attemptsGuardCostUsd: 0.033, error: null, rejected: [], rawText: null };
  const ledger: LedgerEntry[] = [1, 2].map((attempt) => ({ runId: record.runId, studyKey: record.studyKey,
    model: 'claude-haiku-5-5', attempt, attemptAt: '2026-11-25T00:00:00Z', outcome: 'ok',
    tokensIn: 18_000, tokensOut: 3_000, cachedTokensIn: 0, guardCostUsd: 0.0165, costBasis: 'measured', elapsedMs: 100 }));
  assert.equal(metrics([], [record], ledger).listCostPerStudy, 2 * (18_000 * 0.1 + 3_000 * 0.5) / 1e6);
});

test('ブートストラップ乱数の固定値と type 7 分位数', () => {
  const random = mulberry32(20261122);
  assert.deepEqual([random(), random(), random()], [0.8369944463483989, 0.10530598578043282, 0.0031693943310528994]);
  assert.equal(quantile([0, 10, 20, 30], 0.25), 7.5); assert.equal(quantile([], 0.5), null);
});
test('二段再抽出の決定性・ゼロ reported 除外・同じ抽出による対応差', () => {
  const { values, runs } = handFixture();
  const rows = scoreValues([...values, value({ reviewId: 'REV3', studyKey: 'cc-by/REV3/S3', label: 'derivable' })], runs);
  const allMatched = rows.map((row) => ({ ...row, answer: { ...row.answer, state: 'match' as const } }));
  const map = new Map([['first', rows], ['second', allMatched]]);
  const a = bootstrap(['first', 'second'], map, { replicates: 200, seed: 20261122 });
  assert.deepEqual(a, bootstrap(['first', 'second'], map, { replicates: 200, seed: 20261122 }));
  assert.ok(a.omittedReviewDraws > 0); assert.ok(a.emptyReplicates > 0);
  assert.equal(a.models.first!.point, 0.625); assert.equal(a.models.second!.point, 1); assert.equal(a.difference!.point, 0.375);
  const same = bootstrap(['first', 'second'], new Map([['first', rows], ['second', rows]]));
  assert.deepEqual(same.difference, { point: 0, lower: 0, upper: 0, crossesZero: true });
});
