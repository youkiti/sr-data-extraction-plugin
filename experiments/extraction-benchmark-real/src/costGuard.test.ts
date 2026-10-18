import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { estimateCostUsd } from '../../../src/lib/llm/pricing';
import { FALLBACK_PRICING } from './config';
import {
  appendLedger,
  assertPricingAvailable,
  attemptCount,
  billedCostUsd,
  failedCostUsd,
  extractThoughtsTokens,
  readLedger,
  redactSecret,
  totalCostUsd,
  recalculateRunCost,
  recalculateLedger,
  readLedgerRuns,
  isCostLimitReached,
  type RecordedCostRun,
  type LedgerEntry,
} from './costGuard';

// 費用計算を確かめるためのトークン使用量:
// promptTokenCount 28322 / candidatesTokenCount 10947 / thoughtsTokenCount 17035。
// 記録された costUsd 0.141006 は candidates 分だけの計算で、thoughtsTokenCount 分の課金を数えていない
// （当時の tokensOut は candidatesTokenCount のみ）。
const SAMPLE_TOKENS_IN = 28322;
const SAMPLE_TOKENS_OUT = 10947;
const SAMPLE_THOUGHTS = 17035;

test('billedCostUsd: 思考トークン込みの課金対象出力で、本番 estimateCostUsd と同じ式になる', () => {
  const expected = estimateCostUsd(
    'gemini-3.5-flash',
    SAMPLE_TOKENS_IN,
    SAMPLE_TOKENS_OUT + SAMPLE_THOUGHTS,
    null,
  );
  const result = billedCostUsd({
    model: 'gemini-3.5-flash',
    tokensIn: SAMPLE_TOKENS_IN,
    ...{ tokensOut: SAMPLE_TOKENS_OUT, thoughtsTokens: SAMPLE_THOUGHTS },
    rawResponse: { usageMetadata: { candidatesTokenCount: SAMPLE_TOKENS_OUT, thoughtsTokenCount: SAMPLE_THOUGHTS } },
    cachedTokensIn: null,
  });
  assert.equal(result.costSource, 'production_pricing');
  assert.equal(result.costUsd, expected);
  // candidates 分だけで計算した旧値（0.141006 付近）より必ず高くなる（思考トークン分が乗る）
  const candidatesOnly = estimateCostUsd('gemini-3.5-flash', SAMPLE_TOKENS_IN, SAMPLE_TOKENS_OUT, null);
  assert.ok((result.costUsd ?? 0) > (candidatesOnly ?? 0));
});

test('billedCostUsd: 応答が無い試行の costUsd は null', () => {
  const result = billedCostUsd({
    model: 'gemini-3.5-flash',
    tokensIn: null,
    rawResponse: null,
    cachedTokensIn: null,
  });
  assert.equal(result.costUsd, null);
});

test('billedCostUsd: キャッシュ分の割引が本番 estimateCostUsd 経由で効く', () => {
  const withoutCache = billedCostUsd({
    model: 'gemini-3.5-flash',
    tokensIn: 100_000,
    rawResponse: { usageMetadata: { candidatesTokenCount: 1_000 } },
    cachedTokensIn: 0,
  });
  const withCache = billedCostUsd({
    model: 'gemini-3.5-flash',
    tokensIn: 100_000,
    rawResponse: { usageMetadata: { candidatesTokenCount: 1_000 } },
    cachedTokensIn: 50_000,
  });
  const expectedWithCache = estimateCostUsd('gemini-3.5-flash', 100_000, 1_000, 50_000);
  assert.equal(withCache.costUsd, expectedWithCache);
  assert.ok((withCache.costUsd ?? 0) < (withoutCache.costUsd ?? 0));
});

test('billedCostUsd: 本番単価表に無いモデルは FALLBACK_PRICING を使い costSource が変わる', () => {
  const fallback = FALLBACK_PRICING['gemini-3.8-flash'];
  assert.ok(fallback !== undefined, 'テスト前提: config.FALLBACK_PRICING に gemini-3.8-flash がある');
  const tokensIn = 10_000;
  const tokensOut = 2_000;
  const thoughtsTokens = 500;
  // 本番表を空の fixture に差し替え、モデル追加に左右されず fallback 分岐を通す。
  const result = billedCostUsd({
    model: 'gemini-3.8-flash', tokensIn, cachedTokensIn: null,
    rawResponse: { usageMetadata: { candidatesTokenCount: tokensOut, thoughtsTokenCount: thoughtsTokens } },
  }, { production: {}, fallback: FALLBACK_PRICING, estimate: estimateCostUsd });
  const expected =
    (tokensIn / 1_000_000) * fallback.inputPerMillion + ((tokensOut + thoughtsTokens) / 1_000_000) * fallback.outputPerMillion;
  assert.equal(result.costSource, 'bench_fallback');
  assert.equal(result.costUsd, expected);
});

test('assertPricingAvailable: どちらの表にも無いモデルは throw する', () => {
  assert.throws(() => assertPricingAvailable(['no-such-model-xyz']));
  assert.doesNotThrow(() => assertPricingAvailable(['gemini-3.5-flash', 'gemini-3.8-flash']));
});

test('extractThoughtsTokens: usageMetadata.thoughtsTokenCount を取り出す。無ければ null', () => {
  assert.equal(extractThoughtsTokens({ usageMetadata: { thoughtsTokenCount: 17035 } }), 17035);
  assert.equal(extractThoughtsTokens({ usageMetadata: {} }), null);
  assert.equal(extractThoughtsTokens({}), null);
  assert.equal(extractThoughtsTokens(null), null);
  assert.equal(extractThoughtsTokens('not an object'), null);
  assert.equal(extractThoughtsTokens({ usageMetadata: { thoughtsTokenCount: 'x' } }), null);
});

test('redactSecret: 生のキーと URL エンコードされたキーの両方を置換する', () => {
  const secret = 'AIzaSy+Test/Key=1';
  const encoded = encodeURIComponent(secret);
  const raw = `fetch failed: https://example.com/x?key=${secret} and also ${encoded}`;
  const result = redactSecret(raw, secret);
  assert.ok(!result.includes(secret));
  assert.ok(!result.includes(encoded));
  assert.ok(result.includes('[REDACTED]'));
  // 空文字の secret では何もしない
  assert.equal(redactSecret('unchanged', ''), 'unchanged');
});

test('レジャ: append → read の往復と attemptCount / totalCostUsd', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'costguard-ledger-'));
  const ledgerPath = path.join(dir, 'ledger.jsonl');
  try {
    const entry = (overrides: Partial<LedgerEntry>): LedgerEntry => ({
      runId: 'model__text_only__pdf__r1',
      attemptAt: new Date().toISOString(),
      model: 'gemini-3.5-flash',
      pdfId: 'pdf',
      repeat: 1,
      outcome: 'ok',
      tokensIn: 100,
      tokensOut: 50,
      thoughtsTokens: null,
      cachedTokensIn: null,
      costUsd: 0.01,
      costSource: 'production_pricing',
      elapsedMs: 1000,
      ...overrides,
    });
    await appendLedger(ledgerPath, entry({}));
    await appendLedger(ledgerPath, entry({ outcome: 'transport_error', costUsd: null }));
    const entries = await readLedger(ledgerPath);
    assert.equal(entries.length, 2);
    assert.equal(attemptCount(entries, 'model__text_only__pdf__r1'), 2);
    assert.equal(attemptCount(entries, 'no-such-run'), 0);
    assert.equal(totalCostUsd(entries), 0.01); // null は 0 として扱う
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('レジャ: 空ファイル無し(ENOENT)は空配列、壊れた行があれば throw する', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'costguard-ledger-'));
  try {
    const missingPath = path.join(dir, 'missing.jsonl');
    assert.deepEqual(await readLedger(missingPath), []);

    const brokenPath = path.join(dir, 'broken.jsonl');
    await writeFile(brokenPath, '{"runId":"a"}\nnot json\n', 'utf8');
    await assert.rejects(() => readLedger(brokenPath));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});


test('billedCostUsd: tokensOut が思考込みでも二重計上しない', () => {
  const run = {
    model: 'gemini-3.5-flash', tokensIn: SAMPLE_TOKENS_IN,
    tokensOut: SAMPLE_TOKENS_OUT + SAMPLE_THOUGHTS, thoughtsTokens: SAMPLE_THOUGHTS,
    cachedTokensIn: null,
    rawResponse: { usageMetadata: { candidatesTokenCount: SAMPLE_TOKENS_OUT, thoughtsTokenCount: SAMPLE_THOUGHTS } },
  };
  const result = billedCostUsd(run);
  assert.equal(result.billedTokensOut, SAMPLE_TOKENS_OUT + SAMPLE_THOUGHTS);
  assert.equal(result.costUsd, estimateCostUsd(run.model, run.tokensIn, run.tokensOut, null));
});

test('billedCostUsd: thoughts が無いモデルは candidates のみ', () => {
  const result = billedCostUsd({ model: 'gemini-3.5-flash', tokensIn: 100, cachedTokensIn: null,
    rawResponse: { usageMetadata: { candidatesTokenCount: 50 } } });
  assert.equal(result.billedTokensOut, 50);
  assert.equal(result.costUsd, estimateCostUsd('gemini-3.5-flash', 100, 50));
});

test('billedCostUsd: candidates が無ければ thoughts のみ', () => {
  const result = billedCostUsd({ model: 'gemini-3.5-flash', tokensIn: 100, cachedTokensIn: null,
    rawResponse: { usageMetadata: { thoughtsTokenCount: 25 } } });
  assert.equal(result.billedTokensOut, 25);
  assert.equal(result.costUsd, estimateCostUsd('gemini-3.5-flash', 100, 25));
});

test('billedCostUsd: usageMetadata が無ければトークン記録があっても費用不明', () => {
  const run = { model: 'gemini-3.5-flash', tokensIn: 100, tokensOut: 50, thoughtsTokens: 25,
    cachedTokensIn: null, rawResponse: {} };
  assert.equal(billedCostUsd(run).costUsd, null);
  assert.equal(billedCostUsd(run).billedTokensOut, null);
});

test('billedCostUsd: 両単価表に無いモデルは費用不明', () => {
  const result = billedCostUsd({ model: 'no-such-model-xyz', tokensIn: 100, cachedTokensIn: null,
    rawResponse: { usageMetadata: { candidatesTokenCount: 50 } } });
  assert.equal(result.costUsd, null);
  assert.equal(result.costSource, 'bench_fallback');
});

const costRun: RecordedCostRun = {
  runId: 'model__pdf__r1', model: 'gemini-3.5-flash', tokensIn: 100_000,
  tokensOut: 30_000, thoughtsTokens: 20_000, cachedTokensIn: 50_000, costUsd: 0.5325,
  rawResponse: { usageMetadata: { candidatesTokenCount: 10_000, thoughtsTokenCount: 20_000 } },
};
const costEntry: LedgerEntry = {
  ...costRun, thoughtsTokens: 20_000, cachedTokensIn: 50_000,
  attemptAt: '2026-10-04T00:00:00Z', pdfId: 'pdf', repeat: 1,
  outcome: 'ok', costSource: 'production_pricing', elapsedMs: 1000,
};

test('採点費用: 使用量があれば再計算し、無い場合だけ記録値を維持する', () => {
  const corrected = recalculateRunCost(costRun);
  assert.equal(corrected.costUsd, estimateCostUsd(costRun.model, 100_000, 30_000, 50_000));
  assert.equal(corrected.usedRecordedCost, false);
  assert.deepEqual(recalculateRunCost({ ...costRun, rawResponse: null }),
    { costUsd: costRun.costUsd, usedRecordedCost: true });
  assert.deepEqual(recalculateRunCost({ ...costRun, model: 'no-such-model-xyz' }),
    { costUsd: null, usedRecordedCost: false });
});

test('レジャ再計算: トークン値が一致する古い行だけ数え直し、上限判定に使う', () => {
  const entries = [costEntry];
  const runs = new Map([[costRun.runId, costRun]]);
  const before = JSON.stringify({ entries, runs: [...runs] });
  const result = recalculateLedger(entries, runs);
  assert.equal(result.recalculatedCount, 1);
  assert.equal(result.recordedCount, 0);
  assert.equal(result.recordedTotalUsd, costEntry.costUsd);
  assert.equal(result.totalUsd, recalculateRunCost(costRun).costUsd);
  assert.equal(isCostLimitReached(result.recordedTotalUsd, 0.4), true);
  assert.equal(isCostLimitReached(result.totalUsd, 0.4), false);
  assert.equal(isCostLimitReached(result.totalUsd, result.totalUsd), true);
  assert.equal(JSON.stringify({ entries, runs: [...runs] }), before);
});

test('レジャ再計算: 新形式・トークン不一致・run 欠落・使用量欠落は記録費用を維持', () => {
  const cases: Array<{ entry: LedgerEntry; run?: RecordedCostRun }> = [
    { entry: { ...costEntry, billedTokensOut: 30_000 }, run: costRun },
    { entry: { ...costEntry, billedTokensOut: null }, run: costRun },
    { entry: { ...costEntry, tokensOut: 10_000 }, run: costRun },
    { entry: { ...costEntry, thoughtsTokens: null }, run: costRun },
    { entry: costEntry },
    { entry: costEntry, run: { ...costRun, rawResponse: {} } },
    { entry: costEntry, run: { ...costRun, runId: 'different' } },
  ];
  for (const { entry, run } of cases) {
    const result = recalculateLedger([entry], new Map(run ? [[entry.runId, run]] : []));
    assert.deepEqual(result, { recalculatedCount: 0, recordedCount: 1,
      recordedTotalUsd: entry.costUsd, totalUsd: entry.costUsd });
  }
  assert.deepEqual(recalculateLedger([], new Map()),
    { recalculatedCount: 0, recordedCount: 0, recordedTotalUsd: 0, totalUsd: 0 });
});

test('レジャ run 読み込み: 欠落を許容し、新形式は読まず、JSON 破損は通知する', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'costguard-runs-'));
  try {
    assert.equal((await readLedgerRuns(dir, [costEntry])).size, 0);
    const file = path.join(dir, `${costEntry.runId}.json`);
    await writeFile(file, JSON.stringify(costRun), 'utf8');
    assert.deepEqual((await readLedgerRuns(dir, [costEntry])).get(costEntry.runId), costRun);
    await writeFile(file, 'broken', 'utf8');
    assert.equal((await readLedgerRuns(dir, [{ ...costEntry, billedTokensOut: null }])).size, 0);
    await assert.rejects(() => readLedgerRuns(dir, [costEntry]));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});


test('失敗費用: 思考込みの実測・上限見積もり・不明を区別する', () => {
  const model = 'gemini-3.5-flash';
  const measured = failedCostUsd(model, { usage: { tokensIn: 100, tokensOut: 75,
    thoughtsTokensOut: 25, cachedTokensIn: 20 } }, 999, 32768);
  assert.equal(measured.costBasis, 'measured_failure');
  assert.equal(measured.billedTokensOut, 75);
  assert.equal(measured.costUsd, estimateCostUsd(model, 100, 75, 20));
  for (const usage of [null, {}, { tokensIn: NaN, tokensOut: 75 }, { tokensIn: 100, tokensOut: -1 }]) {
    const estimated = failedCostUsd(model, { failureKind: 'output_limit', usage }, 101, 32768);
    assert.equal(estimated.costBasis, 'estimated_output_limit');
    assert.equal(estimated.costUsd, estimateCostUsd(model, 26, 32768, null));
  }
  for (const error of [null, new Error('network'), { status: 401 }, { status: 429 }, { status: 503 }]) {
    const unknown = failedCostUsd(model, error, 101, 32768);
    assert.equal(unknown.costBasis, 'unknown');
    assert.equal(unknown.costUsd, null);
  }
});

test('古いレジャ: 成功は実測、費用 null は不明として読む', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cost-basis-'));
  const file = path.join(dir, 'ledger.jsonl');
  await writeFile(file, [costEntry, { ...costEntry, costUsd: null }].map((entry) => JSON.stringify(entry)).join('\n'), 'utf8');
  const entries = await readLedger(file);
  assert.deepEqual(entries.map((entry) => entry.costBasis), ['measured', 'unknown']);
});

test('失敗費用: 再計算後も保存値を維持し、累計と費用上限に含める', () => {
  for (const costBasis of ['measured_failure', 'estimated_output_limit'] as const) {
    const entry = { ...costEntry, costBasis, costUsd: 1 };
    const run = { ...costRun, costBasis, costUsd: 1 };
    assert.equal(recalculateRunCost(run).costUsd, 1);
    assert.equal(recalculateLedger([entry], new Map([[run.runId, run]])).totalUsd, 1);
    assert.equal(isCostLimitReached(totalCostUsd([entry]), 1), true);
  }
});
