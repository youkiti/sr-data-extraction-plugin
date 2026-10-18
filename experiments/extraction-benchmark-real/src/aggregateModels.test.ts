import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateModel, missingModels, type RunAggregateInput } from './aggregateModels';
import type { PerRunMetrics } from './metrics';

function metrics(pdfId: string, repeat: number, accuracy: number): PerRunMetrics {
  return {
    runId: `${pdfId}__r${repeat}`,
    model: 'test-model',
    inputMode: 'text_only',
    pdfId,
    repeat,
    failed: false,
    failureReason: null,
    overall: { rowCount: 10, accuracy, accuracyNumeric: accuracy, notReportedSensitivity: null, notReportedSpecificity: null, majorErrorRate: null },
    tableLikely: {
      rowCount: 0,
      accuracy: null,
      accuracyNumeric: null,
      notReportedSensitivity: null,
      notReportedSpecificity: null,
      majorErrorRate: null,
    },
    anchorSuccessRate: null,
    verbatimRate: null,
    costUsd: 0.01,
    elapsedMs: 1000,
    tokensIn: 100,
    tokensOut: 50,
    missingGoldCount: 0,
    extraAiCount: 0,
  };
}

function input(pdfId: string, repeat: number, accuracy: number): RunAggregateInput {
  return { metrics: metrics(pdfId, repeat, accuracy), promptVersion: 9, thoughtsTokens: null, cachedTokensIn: null };
}

/** 失敗 run（凍結定義どおり全項目不正解 = accuracy 0）。failed: true・failureReason 付き */
function failedInput(pdfId: string, repeat: number): RunAggregateInput {
  const base = input(pdfId, repeat, 0);
  return { ...base, metrics: { ...base.metrics, failed: true, failureReason: 'transport error: HTTP 429' } };
}

test('母集団 SD（反復間ばらつき）と標本 SD（反復平均間）を取り違えていない', () => {
  // pdfA: 3 反復の正確度 0.6 / 0.8 / 1.0（平均 0.8・母集団分散 = ((0.2)^2*2)/3 = 0.026667・sd ≈ 0.163299）
  // pdfB: 3 反復とも 0.5（sd = 0）
  // accuracySdAcrossRepeats = (0.163299 + 0) / 2 ≈ 0.0816（pdf 間平均）
  const inputs: RunAggregateInput[] = [
    input('pdfA', 1, 0.6),
    input('pdfA', 2, 0.8),
    input('pdfA', 3, 1.0),
    input('pdfB', 1, 0.5),
    input('pdfB', 2, 0.5),
    input('pdfB', 3, 0.5),
  ];
  const aggregate = aggregateModel(inputs, { expectedPdfIds: ['pdfA', 'pdfB'], expectedRepeats: 3 });
  assert.equal(aggregate.accuracySdAcrossRepeats, 0.0816);

  // 反復ごとの pdf 間平均: r1=(0.6+0.5)/2=0.55, r2=(0.8+0.5)/2=0.65, r3=(1.0+0.5)/2=0.75
  // 標本 SD（n-1=2）: 平均 0.65・分散 = ((0.1)^2*2)/2 = 0.01・sd = 0.1
  assert.deepEqual(aggregate.accuracyByRepeat, { 1: 0.55, 2: 0.65, 3: 0.75 });
  assert.equal(aggregate.accuracySdOfRepeatMeans, 0.1);
  // 母集団 SD（n で割る: 0.02/3≈0.006667・sd≈0.0816）と標本 SD（n-1 で割る: 0.1）は別の値になるはず
  assert.notEqual(aggregate.accuracySdOfRepeatMeans, aggregate.accuracySdAcrossRepeats);
});

test('反復 1 回の pdf は SD を 0 として扱う', () => {
  const inputs: RunAggregateInput[] = [input('onlyPdf', 1, 0.7)];
  const aggregate = aggregateModel(inputs, { expectedPdfIds: ['onlyPdf'], expectedRepeats: 1 });
  assert.equal(aggregate.accuracySdAcrossRepeats, 0);
  // 反復平均が 1 点しかないので標本 SD は計算できない（null）
  assert.equal(aggregate.accuracySdOfRepeatMeans, null);
});

test('complete の判定: 対象論文 × 反復が 1 件でも欠けたら false', () => {
  const complete: RunAggregateInput[] = [
    input('p1', 1, 0.5),
    input('p1', 2, 0.6),
    input('p2', 1, 0.7),
    input('p2', 2, 0.8),
  ];
  const missingOne = complete.slice(0, 3); // p2 の repeat 2 が欠ける

  const aggComplete = aggregateModel(complete, { expectedPdfIds: ['p1', 'p2'], expectedRepeats: 2 });
  assert.equal(aggComplete.complete, true);
  assert.equal(aggComplete.expectedRunCount, 4);
  assert.equal(aggComplete.runCount, 4);

  const aggMissing = aggregateModel(missingOne, { expectedPdfIds: ['p1', 'p2'], expectedRepeats: 2 });
  assert.equal(aggMissing.complete, false);
  assert.equal(aggMissing.runCount, 3);
});

test('accuracyExcludingFailed: 失敗 run を含む主指標 accuracy とは異なる値になる', () => {
  // 3 本は成功（accuracy 1.0）、1 本は失敗（凍結定義どおり全項目不正解 = accuracy 0）
  const inputs: RunAggregateInput[] = [
    input('p1', 1, 1.0),
    input('p2', 1, 1.0),
    input('p3', 1, 1.0),
    failedInput('p4', 1),
  ];
  const aggregate = aggregateModel(inputs, { expectedPdfIds: ['p1', 'p2', 'p3', 'p4'], expectedRepeats: 1 });
  assert.equal(aggregate.failedRunCount, 1);
  // 主指標（凍結定義）は失敗 run を全項目不正解として含めたまま: (1+1+1+0)/4 = 0.75
  assert.equal(aggregate.accuracy, 0.75);
  // 参考値は失敗 run を除いた平均: (1+1+1)/3 = 1
  assert.equal(aggregate.accuracyExcludingFailed, 1);
  assert.notEqual(aggregate.accuracy, aggregate.accuracyExcludingFailed);
});

test('missingModels: run が 1 件も無い期待モデルの id を返す（順序は expectedIds のまま）', () => {
  assert.deepEqual(
    missingModels(['a', 'b', 'c'], ['b']),
    ['a', 'c'],
  );
  assert.deepEqual(missingModels(['a', 'b'], ['a', 'b']), []);
  assert.deepEqual(missingModels([], ['a']), []);
  assert.deepEqual(missingModels(['a'], []), ['a']);
});
