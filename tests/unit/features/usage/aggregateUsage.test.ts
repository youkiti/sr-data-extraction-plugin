import type { LlmApiLogEntry } from '../../../../src/domain/llmApiLog';
import type { UsageRun } from '../../../../src/features/extraction/runRepository';
import {
  aggregateUsage,
  budgetStatus,
  buildUsageCsv,
} from '../../../../src/features/usage/aggregateUsage';

function log(overrides: Partial<LlmApiLogEntry> = {}): LlmApiLogEntry {
  return {
    logId: 'log',
    timestamp: '2026-08-04T00:00:00Z',
    provider: 'gemini',
    model: 'model-a',
    purpose: 'extract_study',
    promptRef: 'prompt',
    responseRef: 'response',
    promptSummary: null,
    tokensIn: 100,
    tokensOut: 20,
    latencyMs: 1,
    costEstimateUsd: 2,
    error: null,
    cachedTokensIn: 80,
    runId: 'r1',
    studyId: 's1',
    section: null,
    promptVersion: 9,
    thoughtsTokensOut: 0,
    ...overrides,
  };
}

function run(overrides: Partial<UsageRun> = {}): UsageRun {
  return {
    runId: 'r1',
    runType: 'full',
    status: 'done',
    studyIds: ['s1', 's2'],
    requestedModel: 'model-a',
    startedAt: '2026-08-01T00:00:00Z',
    finishedAt: '2026-08-10T00:00:00Z',
    ...overrides,
  };
}

describe('aggregateUsage', () => {
  test('空入力は費用と件数 0、トークン・比率・study 単価は null', () => {
    const summary = aggregateUsage({ logs: [], runs: [] });
    expect(summary).toMatchObject({
      totals: {
        calls: 0,
        errorCalls: 0,
        tokensIn: null,
        tokensOut: null,
        cachedTokensIn: null,
        costUsd: 0,
        unknownPriceCalls: 0,
        wastedCostUsd: 0,
        cacheHitRate: null,
      },
      byRun: [],
      byPurpose: [],
      byModel: [],
      byMonth: [],
      succeededStudies: 0,
      costPerStudyUsd: null,
      successCountEstimated: false,
      estimatedCalls: 0,
      estimatedCostUsd: 0,
      unassignedCalls: 0,
      unassignedCostUsd: 0,
      undercountedGeminiCalls: 0,
      undercountedGeminiCostUsd: 0,
    });
    expect(summary.byRunType.map((row) => [row.key, row.costPerStudyUsd])).toEqual([
      ['pilot', null],
      ['full', null],
      ['single_study', null],
    ]);
  });

  test('全 purpose の費用、失敗費用、使用量、価格不明件数を合算し、警告は全軸で除外する', () => {
    const logs = [
      log(),
      log({
        error: '打ち切り',
        costEstimateUsd: 3,
        tokensIn: 50,
        tokensOut: 10,
        cachedTokensIn: null,
        purpose: 'draft_schema',
        model: 'model-b',
      }),
      log({ costEstimateUsd: null, tokensIn: null, tokensOut: 5, cachedTokensIn: 20 }),
      log({ costEstimateUsd: null, tokensIn: 10, tokensOut: null, cachedTokensIn: 0 }),
      log({
        error: '通信失敗',
        costEstimateUsd: null,
        tokensIn: null,
        tokensOut: null,
        cachedTokensIn: null,
      }),
      log({ costEstimateUsd: null, tokensIn: 0, tokensOut: 0, cachedTokensIn: 0 }),
      log({ error: '', costEstimateUsd: 1, timestamp: '2026-09-01T00:00:00Z' }),
      log({
        promptRef: '',
        responseRef: '',
        error: '警告',
        costEstimateUsd: 999,
        timestamp: '2026-10-01T00:00:00Z',
        tokensIn: 999,
        thoughtsTokensOut: null,
      }),
    ];
    const before = JSON.stringify(logs);
    const summary = aggregateUsage({ logs, runs: [run()] });
    expect(summary.totals).toEqual({
      calls: 7,
      errorCalls: 2,
      tokensIn: 260,
      tokensOut: 55,
      cachedTokensIn: 180,
      costUsd: 6,
      unknownPriceCalls: 3,
      wastedCostUsd: 3,
      cacheHitRate: 160 / 210,
    });
    expect(summary.byPurpose.map((row) => [row.key, row.calls, row.costUsd])).toEqual([
      ['extract_study', 6, 3],
      ['draft_schema', 1, 3],
    ]);
    expect(summary.byModel.map((row) => [row.key, row.calls, row.costUsd])).toEqual([
      ['model-a', 6, 3],
      ['model-b', 1, 3],
    ]);
    expect(summary.byMonth.map((row) => [row.key, row.calls, row.costUsd])).toEqual([
      ['2026-08', 6, 5],
      ['2026-09', 1, 1],
    ]);
    expect(summary.byRun[0]).toMatchObject({ calls: 6, costUsd: 3 });
    expect(summary.undercountedGeminiCalls).toBe(0);
    expect(JSON.stringify(logs)).toBe(before);
  });

  test('警告だけなら成功 study 数や旧 run 推定にも影響しない', () => {
    const summary = aggregateUsage({
      logs: [log({ promptRef: '', responseRef: '' })],
      runs: [],
    });
    expect(summary.totals.calls).toBe(0);
    expect(summary.byPurpose).toEqual([]);
    expect(summary.byModel).toEqual([]);
    expect(summary.byMonth).toEqual([]);
    expect(summary.estimatedCalls).toBe(0);
    expect(summary.unassignedCalls).toBe(0);
  });

  test('キャッシュの分母が 0 または両方既知の call がなければ比率は null', () => {
    const summary = aggregateUsage({
      logs: [
        log({ tokensIn: 0, cachedTokensIn: 0 }),
        log({ tokensIn: null, cachedTokensIn: 10 }),
        log({ tokensIn: 10, cachedTokensIn: null }),
      ],
      runs: [],
    });
    expect(summary.totals.cacheHitRate).toBeNull();
  });

  test('思考内訳が空の旧 Gemini 出力だけを過小計上として数える（出力 0 も非空）', () => {
    const summary = aggregateUsage({
      logs: [
        log({ thoughtsTokensOut: null, tokensOut: 0, costEstimateUsd: 1 }),
        log({ thoughtsTokensOut: null, costEstimateUsd: null }),
        log({ thoughtsTokensOut: null, tokensOut: null }),
        log({ thoughtsTokensOut: 0 }),
        log({ provider: 'anthropic', thoughtsTokensOut: null }),
        log({ promptRef: '', responseRef: '', thoughtsTokensOut: null }),
      ],
      runs: [],
    });
    expect(summary.undercountedGeminiCalls).toBe(2);
    expect(summary.undercountedGeminiCostUsd).toBe(1);
  });

  test('明示 run ID を優先し、成功 study を重複排除して再実行費用を含む単価を出す', () => {
    const summary = aggregateUsage({
      runs: [
        run(),
        run({ runId: 'pilot', runType: 'pilot' }),
        run({ runId: 'retry', runType: 'single_study', status: 'partial_failure' }),
      ],
      logs: [
        log({ timestamp: '2027-01-01T00:00:00Z', costEstimateUsd: 2 }),
        log({ section: 'methods', costEstimateUsd: 3 }),
        log({ studyId: 's2', error: '失敗', costEstimateUsd: 4 }),
        log({ runId: 'pilot', studyId: 's1', costEstimateUsd: 5 }),
        log({ runId: 'retry', studyId: 's1', costEstimateUsd: 6 }),
        log({ runId: 'retry', studyId: 's3', costEstimateUsd: 7 }),
      ],
    });
    expect(
      summary.byRun.map((row) => [row.key, row.succeededStudies, row.costPerStudyUsd]),
    ).toEqual([
      ['r1', 1, 9],
      ['pilot', 1, 5],
      ['retry', 2, 6.5],
    ]);
    expect(summary.byRun.every((row) => !row.estimated && !row.successCountEstimated)).toBe(true);
    expect(
      summary.byRunType.map((row) => [row.key, row.succeededStudies, row.costPerStudyUsd]),
    ).toEqual([
      ['pilot', 1, 5],
      ['full', 1, 9],
      ['single_study', 2, 6.5],
    ]);
    expect(summary.succeededStudies).toBe(2);
    expect(summary.costPerStudyUsd).toBe(27 / 2);
    expect(summary.successCountEstimated).toBe(false);
  });

  test('同じ run_type 内の再実行でも成功 study は一度だけ分母に数える', () => {
    const summary = aggregateUsage({
      runs: [run(), run({ runId: 'r2' })],
      logs: [log(), log({ runId: 'r2', costEstimateUsd: 4 })],
    });
    expect(summary.byRunType.find((row) => row.key === 'full')).toMatchObject({
      costUsd: 6,
      succeededStudies: 1,
      costPerStudyUsd: 6,
    });
    expect(summary.costPerStudyUsd).toBe(6);
  });

  test('旧ログは両端を含む時間範囲で推定し、重なる場合は最新開始の run を選ぶ', () => {
    const summary = aggregateUsage({
      runs: [
        run(),
        run({
          runId: 'r2',
          startedAt: '2026-08-03T00:00:00Z',
          finishedAt: '2026-08-08T00:00:00Z',
          studyIds: ['old', 'old'],
        }),
        run({ runId: 'no-start', startedAt: null }),
        run({ runId: 'no-end', finishedAt: null }),
        run({ runId: 'earlier', startedAt: '2026-07-31T00:00:00Z' }),
      ],
      logs: [
        log({ runId: null, studyId: null, timestamp: '2026-08-01T00:00:00Z' }),
        log({ runId: null, studyId: null, timestamp: '2026-08-04T00:00:00Z' }),
        log({ runId: null, studyId: null, timestamp: '2026-08-10T00:00:00Z' }),
        log({ runId: null, timestamp: '2026-08-11T00:00:00Z', costEstimateUsd: 3 }),
        log({ runId: 'interrupted', costEstimateUsd: 4 }),
        log({ runId: null, timestamp: '2026-01-01T00:00:00Z', costEstimateUsd: null }),
        log({ runId: null, purpose: 'relocate_quote' }),
      ],
    });
    expect(summary).toMatchObject({
      estimatedCalls: 3,
      estimatedCostUsd: 6,
      unassignedCalls: 3,
      unassignedCostUsd: 7,
    });
    expect(summary.byRun.find((row) => row.key === 'r1')).toMatchObject({
      calls: 2,
      costUsd: 4,
      succeededStudies: 2,
      estimated: true,
      successCountEstimated: true,
    });
    expect(summary.byRun.find((row) => row.key === 'r2')).toMatchObject({
      calls: 1,
      costUsd: 2,
      succeededStudies: 1,
      estimated: true,
      successCountEstimated: true,
    });
  });

  test('run がなければ旧行も未割り当てで、価格不明の推定 call は費用 0 に加算する', () => {
    const unassigned = aggregateUsage({
      runs: [],
      logs: [log({ runId: null, costEstimateUsd: null })],
    });
    expect(unassigned.unassignedCalls).toBe(1);
    expect(unassigned.unassignedCostUsd).toBe(0);
    const estimated = aggregateUsage({
      runs: [run()],
      logs: [log({ runId: null, studyId: null, costEstimateUsd: null })],
    });
    expect(estimated.estimatedCalls).toBe(1);
    expect(estimated.estimatedCostUsd).toBe(0);
    expect(estimated.totals.unknownPriceCalls).toBe(1);
  });

  test('study 情報付きの失敗だけなら成功数 0 とし、run 対象一覧へ推定しない', () => {
    const summary = aggregateUsage({
      runs: [run()],
      logs: [log({ error: '失敗' })],
    });
    expect(summary.byRun[0]).toMatchObject({
      succeededStudies: 0,
      costPerStudyUsd: null,
      estimated: false,
      successCountEstimated: false,
    });
    expect(summary.costPerStudyUsd).toBeNull();
    expect(summary.byRunType.find((row) => row.key === 'full')?.costPerStudyUsd).toBeNull();
  });

  test('study 情報のある推定 call は成功の記録とはみなさない', () => {
    const summary = aggregateUsage({ runs: [run()], logs: [log({ runId: null })] });
    expect(summary.byRun[0]).toMatchObject({
      succeededStudies: 0,
      costPerStudyUsd: null,
      estimated: true,
      successCountEstimated: false,
    });
  });

  test('旧 run の対象 study が空なら推定成功数も 0、単価は null', () => {
    const summary = aggregateUsage({
      runs: [run({ studyIds: [] })],
      logs: [log({ studyId: null })],
    });
    expect(summary.byRun[0]).toMatchObject({
      succeededStudies: 0,
      successCountEstimated: true,
      costPerStudyUsd: null,
    });
  });
});

describe('buildUsageCsv', () => {
  test('total・run・month を同じ表で出し、数値は無装飾、null は空とする', () => {
    const summary = aggregateUsage({ logs: [log()], runs: [run()] });
    const csv = buildUsageCsv(summary);
    const rows = csv.trimEnd().split('\r\n');
    expect(rows).toHaveLength(4);
    expect(rows[0]).toBe(
      'level,key,run_type,status,model,started_at,succeeded_studies,cost_per_study_usd,estimated,' +
        'calls,error_calls,tokens_in,tokens_out,cached_tokens_in,cost_usd,unknown_price_calls,' +
        'wasted_cost_usd,cache_hit_rate',
    );
    expect(rows[1]).toBe('total,,,,,,1,2,false,1,0,100,20,80,2,0,0,0.8');
    expect(rows[2]).toBe(
      'run,r1,full,done,model-a,2026-08-01T00:00:00Z,1,2,false,1,0,100,20,80,2,0,0,0.8',
    );
    expect(rows[3]).toBe('month,2026-08,,,,,,,,1,0,100,20,80,2,0,0,0.8');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  test('カンマ・引用符・改行を含むキーも RFC 4180 で引用する', () => {
    const key = 'run,"quoted"';
    const summary = aggregateUsage({
      runs: [run({ runId: key, requestedModel: 'model\nline', startedAt: null })],
      logs: [
        log({
          runId: key,
          studyId: null,
          tokensIn: null,
          tokensOut: null,
          cachedTokensIn: null,
          costEstimateUsd: null,
        }),
      ],
    });
    const csv = buildUsageCsv(summary);
    expect(csv).toContain('run,"run,""quoted""",full,done,"model\nline",,2,0,true,1,0,,,,0,0,0,');
  });

  test('空集計でも total 行とヘッダを出し、不明単価は空セルにする', () => {
    const csv = buildUsageCsv(aggregateUsage({ logs: [], runs: [] }));
    expect(csv.split('\r\n')[1]).toBe('total,,,,,,0,,false,0,0,,,,0,0,0,');
  });
});

describe('budgetStatus', () => {
  test.each([
    { budgetUsd: null, spentUsd: 10, estimateUsd: 2, projectedUsd: 12, exceeds: false },
    { budgetUsd: 10, spentUsd: 8, estimateUsd: 2, projectedUsd: 10, exceeds: false },
    { budgetUsd: 10, spentUsd: 8, estimateUsd: 3, projectedUsd: 11, exceeds: true },
    { budgetUsd: 10, spentUsd: 11, estimateUsd: null, projectedUsd: 11, exceeds: true },
    { budgetUsd: 10, spentUsd: 9, estimateUsd: null, projectedUsd: 9, exceeds: false },
    { budgetUsd: 10, spentUsd: null, estimateUsd: 5, projectedUsd: null, exceeds: false },
  ])('予算・累積・次回見積もりから超過を判定する: %j', (item) => {
    expect(
      budgetStatus({
        budgetUsd: item.budgetUsd,
        spentUsd: item.spentUsd,
        estimateUsd: item.estimateUsd,
        unknownPriceCalls: 3,
      }),
    ).toEqual({
      exceeds: item.exceeds,
      projectedUsd: item.projectedUsd,
      usesSpentOnly: item.estimateUsd === null,
      unknownPriceCalls: 3,
    });
  });
});

describe('バッチ失敗と中断の費用集計', () => {
  function failure(patch: Partial<LlmApiLogEntry> = {}): LlmApiLogEntry {
    return log({
      promptRef: '',
      responseRef: '',
      promptSummary: '[batch_failed] run r1',
      error: 'バッチ失敗',
      tokensIn: null,
      tokensOut: null,
      cachedTokensIn: null,
      costEstimateUsd: null,
      section: 'results',
      ...patch,
    });
  }

  test('全要素破棄の警告で成功 study を除き、課金済み非エラー call を失敗費用に数える', () => {
    const summary = aggregateUsage({
      runs: [run({ status: 'partial_failure' })],
      logs: [
        log({ section: 'results' }),
        failure({ error: 'バッチ失敗（all_items_rejected）: 応答要素をすべて破棄しました（1 件）' }),
      ],
    });
    expect(summary.totals).toMatchObject({ calls: 1, errorCalls: 0, costUsd: 2, wastedCostUsd: 2 });
    expect(summary.byRun[0]).toMatchObject({
      status: 'partial_failure',
      succeededStudies: 0,
      costPerStudyUsd: null,
      wastedCostUsd: 2,
    });
    expect(summary.succeededStudies).toBe(0);
  });

  test('別 section の成功があっても失敗した study は成功数から除き、成果のない呼出費用を数える', () => {
    const summary = aggregateUsage({
      runs: [run()],
      logs: [
        log({ section: 'methods', costEstimateUsd: 1 }),
        log({ section: 'results', costEstimateUsd: 2 }),
        log({ studyId: 's2', section: 'results', costEstimateUsd: 3 }),
        log({ section: 'results', error: 'API 失敗', costEstimateUsd: 4 }),
        failure(),
        failure(),
      ],
    });
    expect(summary.totals).toMatchObject({
      calls: 4,
      errorCalls: 1,
      costUsd: 10,
      wastedCostUsd: 6,
    });
    expect(summary.byRun[0]).toMatchObject({ succeededStudies: 1, costPerStudyUsd: 10 });
    expect(summary.byPurpose[0]?.wastedCostUsd).toBe(6);
    expect(summary.byModel[0]?.wastedCostUsd).toBe(6);
    expect(summary.byMonth[0]?.wastedCostUsd).toBe(6);
    expect(summary.byRunType[1]?.wastedCostUsd).toBe(6);
  });

  test('失敗費用が不明でも警告を呼出件数へ数えず、成功は 0 とする', () => {
    const summary = aggregateUsage({
      runs: [run()],
      logs: [log({ section: 'results', costEstimateUsd: null }), failure()],
    });
    expect(summary.totals).toMatchObject({ calls: 1, wastedCostUsd: 0, unknownPriceCalls: 1 });
    expect(summary.succeededStudies).toBe(0);
    expect(summary.costPerStudyUsd).toBeNull();
  });

  test('警告の識別は参照が両方空かつ専用 prefix。無関係・文脈欠落を混同しない', () => {
    const summary = aggregateUsage({
      runs: [run()],
      logs: [
        log(),
        failure({ promptSummary: null }),
        failure({ promptSummary: '[arm_completeness]' }),
        failure({ runId: null }),
        failure({ studyId: null }),
        failure({ runId: 'missing' }),
        failure({ promptRef: 'prompt', costEstimateUsd: 5 }),
      ],
    });
    expect(summary.succeededStudies).toBe(1);
    expect(summary.totals).toMatchObject({ calls: 2, wastedCostUsd: 5 });
  });

  test('呼出なし・API 失敗だけの現在の run に旧版の成功数推定を適用しない', () => {
    for (const logs of [[], [failure()], [log({ studyId: null, error: 'API 失敗' })]]) {
      const summary = aggregateUsage({ runs: [run()], logs });
      expect(summary.byRun[0]).toMatchObject({ succeededStudies: 0, successCountEstimated: false });
      expect(summary.successCountEstimated).toBe(false);
    }
    const old = aggregateUsage({ runs: [run()], logs: [log({ studyId: null })] });
    expect(old.byRun[0]).toMatchObject({ succeededStudies: 2, successCountEstimated: true });
  });

  test('中断費用と未割当費用を全体単価へ含め、種別別には割当できる分だけを含める', () => {
    const summary = aggregateUsage({
      runs: [
        run(),
        run({ runId: 'interrupted', status: 'running', runType: 'pilot', finishedAt: null }),
      ],
      logs: [
        log({ costEstimateUsd: 2 }),
        log({ runId: 'interrupted', error: 'API 失敗', costEstimateUsd: 3 }),
        log({ runId: 'unknown', costEstimateUsd: 5 }),
      ],
    });
    expect(summary.byRun[1]).toMatchObject({
      status: 'running',
      calls: 1,
      costUsd: 3,
      succeededStudies: 0,
      costPerStudyUsd: null,
    });
    expect(summary.costPerStudyUsd).toBe(10);
    expect(summary.byRunType[1]?.costPerStudyUsd).toBe(2);
    expect(summary.byRunType[0]?.costUsd).toBe(3);
    expect(summary.unassignedCostUsd).toBe(5);
    expect(buildUsageCsv(summary)).toContain('run,interrupted,pilot,running,');
  });

  test.each(['s2', null])(
    '中断 run の非エラー call は study 情報の有無にかかわらず成功数 0: %s',
    (studyId) => {
      const summary = aggregateUsage({
        runs: [
          run(),
          run({ runId: 'interrupted', status: 'running', finishedAt: null }),
        ],
        logs: [log(), log({ runId: 'interrupted', studyId })],
      });
      expect(summary.byRun[1]).toMatchObject({
        status: 'running',
        calls: 1,
        costUsd: 2,
        succeededStudies: 0,
        costPerStudyUsd: null,
        estimated: false,
        successCountEstimated: false,
      });
      expect(summary).toMatchObject({
        succeededStudies: 1,
        costPerStudyUsd: 4,
        successCountEstimated: false,
        unassignedCalls: 0,
      });
      expect(summary.byRunType[1]).toMatchObject({
        costUsd: 4,
        succeededStudies: 1,
        costPerStudyUsd: 4,
      });
    },
  );

  test('中断 run は終了時刻があっても旧ログの時間推定に使わない', () => {
    const summary = aggregateUsage({
      runs: [run({ status: 'running' })],
      logs: [log({ runId: null })],
    });
    expect(summary.estimatedCalls).toBe(0);
    expect(summary.unassignedCalls).toBe(1);
    expect(summary.succeededStudies).toBe(0);
  });
});
