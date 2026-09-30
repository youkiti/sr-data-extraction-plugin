// 使用量ログと run を入力にする純粋集計。Sheets・UI への依存を持たない。
import { isWarningOnlyLogEntry, type LlmApiLogEntry } from '../../domain/llmApiLog';
import type { RunType } from '../../domain/extractionRun';
import type { UsageRun } from '../extraction/runRepository';
import { buildCsv } from '../export/csvEncode';

/**
 * call は警告専用行を除く全行。errorCalls は空でない error を持つ call。
 * costUsd は既知の費用の合計。wastedCostUsd はエラー call と、バッチ失敗で成果が
 * 残らなかった非エラー call の費用。同じ call の費用を二重には数えない。
 * unknownPriceCalls は費用不明かつ入出力のいずれかの使用量が既知の call 数。
 * トークンは既知分だけを合計し、全件不明なら null。
 * cacheHitRate は入力・キャッシュが両方既知の call に限った合計同士の比率（分母 0 は null）。
 */
export interface UsageMetrics {
  calls: number;
  errorCalls: number;
  tokensIn: number | null;
  tokensOut: number | null;
  cachedTokensIn: number | null;
  costUsd: number;
  unknownPriceCalls: number;
  wastedCostUsd: number;
  cacheHitRate: number | null;
}

export interface UsageAxisRow extends UsageMetrics {
  key: string;
}

export interface RunUsage extends UsageAxisRow {
  runId: string;
  runType: RunType;
  model: string;
  status: UsageRun['status'];
  startedAt: string | null;
  succeededStudies: number;
  costPerStudyUsd: number | null;
  /** run 割り当てまたは成功 study 数に推定が含まれる */
  estimated: boolean;
  successCountEstimated: boolean;
}

export interface RunTypeUsage extends UsageAxisRow {
  runType: RunType;
  succeededStudies: number;
  costPerStudyUsd: number | null;
  estimated: boolean;
}

export interface UsageSummary {
  totals: UsageMetrics;
  byRun: RunUsage[];
  byPurpose: UsageAxisRow[];
  byModel: UsageAxisRow[];
  /** timestamp は UTC の ISO 文字列として扱い、その先頭 7 文字を月キーにする */
  byMonth: UsageAxisRow[];
  byRunType: RunTypeUsage[];
  succeededStudies: number;
  /** 全 extract_study の費用（未割当・中断も含む）/ 成功 study 数（分母 0 は null） */
  costPerStudyUsd: number | null;
  successCountEstimated: boolean;
  estimatedCalls: number;
  estimatedCostUsd: number;
  unassignedCalls: number;
  unassignedCostUsd: number;
  undercountedGeminiCalls: number;
  undercountedGeminiCostUsd: number;
}

interface Accumulator {
  metrics: UsageMetrics;
  cacheInput: number;
  cacheRead: number;
}

function accumulator(): Accumulator {
  return {
    metrics: {
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
    cacheInput: 0,
    cacheRead: 0,
  };
}

function addNullable(total: number | null, value: number | null): number | null {
  return value === null ? total : (total ?? 0) + value;
}

function isErrorCall(log: LlmApiLogEntry): boolean {
  return log.error !== null && log.error !== '';
}

function addCall(target: Accumulator, log: LlmApiLogEntry, wasted: boolean): void {
  const metrics = target.metrics;
  metrics.calls += 1;
  const error = isErrorCall(log);
  if (error) {
    metrics.errorCalls += 1;
  }
  if (wasted) {
    metrics.wastedCostUsd += log.costEstimateUsd ?? 0;
  }
  metrics.costUsd += log.costEstimateUsd ?? 0;
  if (log.costEstimateUsd === null && (log.tokensIn !== null || log.tokensOut !== null)) {
    metrics.unknownPriceCalls += 1;
  }
  metrics.tokensIn = addNullable(metrics.tokensIn, log.tokensIn);
  metrics.tokensOut = addNullable(metrics.tokensOut, log.tokensOut);
  metrics.cachedTokensIn = addNullable(metrics.cachedTokensIn, log.cachedTokensIn);
  if (log.tokensIn !== null && log.cachedTokensIn !== null) {
    target.cacheInput += log.tokensIn;
    target.cacheRead += log.cachedTokensIn;
  }
  metrics.cacheHitRate = target.cacheInput === 0 ? null : target.cacheRead / target.cacheInput;
}

function addAxis(
  map: Map<string, Accumulator>,
  key: string,
  log: LlmApiLogEntry,
  wasted: boolean,
): void {
  let target = map.get(key);
  if (target === undefined) {
    target = accumulator();
    map.set(key, target);
  }
  addCall(target, log, wasted);
}

function axisRows(map: Map<string, Accumulator>): UsageAxisRow[] {
  return [...map].map(([key, target]) => ({ key, ...target.metrics }));
}

interface RunAccumulator {
  run: UsageRun;
  usage: Accumulator;
  hasStudyContext: boolean;
  hasSuccessfulCall: boolean;
  succeeded: Set<string>;
  estimated: boolean;
}

type Assignment =
  { kind: 'recorded' | 'estimated'; target: RunAccumulator } | { kind: 'unassigned' };

/**
 * 明示 run_id は完了・中断 run との一致で割り当てる。一致しなければ時刻推定に回さない。
 * run_id がない旧行だけ、時刻を含む完了 run（両端含む）のうち開始が最も遅いものへ推定する。
 */
function assignRun(log: LlmApiLogEntry, runs: Map<string, RunAccumulator>): Assignment {
  if (log.runId !== null) {
    const target = runs.get(log.runId);
    return target === undefined ? { kind: 'unassigned' } : { kind: 'recorded', target };
  }
  let latest: RunAccumulator | undefined;
  for (const target of runs.values()) {
    const { startedAt, finishedAt } = target.run;
    if (
      target.run.status !== 'running' &&
      startedAt !== null &&
      finishedAt !== null &&
      startedAt <= log.timestamp &&
      log.timestamp <= finishedAt &&
      (latest === undefined || startedAt > (latest.run.startedAt as string))
    ) {
      latest = target;
    }
  }
  return latest === undefined ? { kind: 'unassigned' } : { kind: 'estimated', target: latest };
}

function costPerStudy(cost: number, succeededStudies: number): number | null {
  return succeededStudies === 0 ? null : cost / succeededStudies;
}

/**
 * 警告専用行は呼び出し・費用・トークンへ算入しない。[batch_failed] の行だけは
 * run・study・section の失敗を識別するために読む。
 * 総費用（予算の累積費用）は全 purpose の既知費用を合算し、不明価格 call を別に数える。
 * 過小計上 Gemini は thoughtsTokensOut が null かつ tokensOut が非 null の非警告行。
 * 成功 study は同じ run_id を記録した非エラー call があり、同じ run・study に
 * batch_failed の記録がない study。失敗した section の call 費用は失敗費用にも数える。
 * study 情報がなく、割当済み非エラー call がある完了済みの旧 run だけ成功数を推定する。
 * 中断 run の成功数は 0。readRunStudyCoverage が中断 study を未抽出とする扱いに分母を合わせる。
 * 全体の study 当たり費用は未割当・中断を含む全 extract_study の費用を、グループ内の
 * 重複しない成功 study 数で割る。run_type 別はその種別に割当できる費用だけを使う。
 */
export function aggregateUsage(input: {
  logs: readonly LlmApiLogEntry[];
  runs: readonly UsageRun[];
}): UsageSummary {
  const totals = accumulator();
  const purposes = new Map<string, Accumulator>();
  const models = new Map<string, Accumulator>();
  const months = new Map<string, Accumulator>();
  const runs = new Map<string, RunAccumulator>(
    input.runs.map((run) => [
      run.runId,
      {
        run,
        usage: accumulator(),
        hasStudyContext: false,
        hasSuccessfulCall: false,
        succeeded: new Set<string>(),
        estimated: false,
      },
    ]),
  );
  const failedStudies = new Set<string>();
  const failedBatches = new Set<string>();
  const studyKey = (log: LlmApiLogEntry): string => JSON.stringify([log.runId, log.studyId]);
  const batchKey = (log: LlmApiLogEntry): string =>
    JSON.stringify([log.runId, log.studyId, log.section]);
  for (const log of input.logs) {
    if (!isWarningOnlyLogEntry(log) || !log.promptSummary?.startsWith('[batch_failed]')) {
      continue;
    }
    if (log.runId === null || log.studyId === null) {
      continue;
    }
    failedStudies.add(studyKey(log));
    failedBatches.add(batchKey(log));
    const target = runs.get(log.runId);
    if (target !== undefined) {
      target.hasStudyContext = true;
    }
  }
  const runTypes: RunType[] = ['pilot', 'full', 'single_study'];
  const groups = new Map(
    runTypes.map((runType) => [
      runType,
      {
        usage: accumulator(),
        succeeded: new Set<string>(),
        estimated: false,
      },
    ]),
  );
  let estimatedCalls = 0;
  let estimatedCostUsd = 0;
  let unassignedCalls = 0;
  let unassignedCostUsd = 0;
  let extractionCost = 0;
  let undercountedGeminiCalls = 0;
  let undercountedGeminiCostUsd = 0;
  for (const log of input.logs) {
    if (isWarningOnlyLogEntry(log)) {
      continue;
    }
    const wasted = isErrorCall(log) || failedBatches.has(batchKey(log));
    addCall(totals, log, wasted);
    addAxis(purposes, log.purpose, log, wasted);
    addAxis(models, log.model, log, wasted);
    addAxis(months, log.timestamp.slice(0, 7), log, wasted);
    if (log.provider === 'gemini' && log.thoughtsTokensOut === null && log.tokensOut !== null) {
      undercountedGeminiCalls += 1;
      undercountedGeminiCostUsd += log.costEstimateUsd ?? 0;
    }
    if (log.purpose !== 'extract_study') {
      continue;
    }
    extractionCost += log.costEstimateUsd ?? 0;
    const assignment = assignRun(log, runs);
    if (assignment.kind === 'unassigned') {
      unassignedCalls += 1;
      unassignedCostUsd += log.costEstimateUsd ?? 0;
      continue;
    }
    const target = assignment.target;
    addCall(target.usage, log, wasted);
    addCall(groups.get(target.run.runType)!.usage, log, wasted);
    if (!isErrorCall(log)) {
      target.hasSuccessfulCall = true;
    }
    if (assignment.kind === 'estimated') {
      estimatedCalls += 1;
      estimatedCostUsd += log.costEstimateUsd ?? 0;
      target.estimated = true;
    }
    if (log.studyId !== null) {
      target.hasStudyContext = true;
      if (
        assignment.kind === 'recorded' &&
        !isErrorCall(log) &&
        !failedStudies.has(studyKey(log))
      ) {
        target.succeeded.add(log.studyId);
      }
    }
  }
  const succeeded = new Set<string>();
  let successCountEstimated = false;
  const byRun = [...runs.values()].map((target): RunUsage => {
    const countEstimated =
      target.run.status !== 'running' && !target.hasStudyContext && target.hasSuccessfulCall;
    if (target.run.status === 'running') {
      target.succeeded.clear();
    } else if (countEstimated) {
      target.succeeded = new Set(target.run.studyIds);
      successCountEstimated = true;
    }
    const group = groups.get(target.run.runType)!;
    for (const studyId of target.succeeded) {
      succeeded.add(studyId);
      group.succeeded.add(studyId);
    }
    const estimated = target.estimated || countEstimated;
    group.estimated ||= estimated;
    return {
      key: target.run.runId,
      runId: target.run.runId,
      runType: target.run.runType,
      model: target.run.requestedModel,
      status: target.run.status,
      startedAt: target.run.startedAt,
      ...target.usage.metrics,
      succeededStudies: target.succeeded.size,
      costPerStudyUsd: costPerStudy(target.usage.metrics.costUsd, target.succeeded.size),
      estimated,
      successCountEstimated: countEstimated,
    };
  });
  return {
    totals: totals.metrics,
    byRun,
    byPurpose: axisRows(purposes),
    byModel: axisRows(models),
    byMonth: axisRows(months),
    byRunType: [...groups].map(([runType, group]) => ({
      key: runType,
      runType,
      ...group.usage.metrics,
      succeededStudies: group.succeeded.size,
      costPerStudyUsd: costPerStudy(group.usage.metrics.costUsd, group.succeeded.size),
      estimated: group.estimated,
    })),
    succeededStudies: succeeded.size,
    costPerStudyUsd: costPerStudy(extractionCost, succeeded.size),
    successCountEstimated,
    estimatedCalls,
    estimatedCostUsd,
    unassignedCalls,
    unassignedCostUsd,
    undercountedGeminiCalls,
    undercountedGeminiCostUsd,
  };
}

/** usage.csv は total / run / month の一表。数値は無装飾、null は空、引用は RFC 4180。 */
export function buildUsageCsv(summary: UsageSummary): string {
  const header = [
    'level',
    'key',
    'run_type',
    'status',
    'model',
    'started_at',
    'succeeded_studies',
    'cost_per_study_usd',
    'estimated',
    'calls',
    'error_calls',
    'tokens_in',
    'tokens_out',
    'cached_tokens_in',
    'cost_usd',
    'unknown_price_calls',
    'wasted_cost_usd',
    'cache_hit_rate',
  ];
  const text = (value: string | number | boolean | null): string =>
    value === null ? '' : String(value);
  const metrics = (row: UsageMetrics): string[] =>
    [
      row.calls,
      row.errorCalls,
      row.tokensIn,
      row.tokensOut,
      row.cachedTokensIn,
      row.costUsd,
      row.unknownPriceCalls,
      row.wastedCostUsd,
      row.cacheHitRate,
    ].map(text);
  return buildCsv(header, [
    [
      'total',
      '',
      '',
      '',
      '',
      '',
      text(summary.succeededStudies),
      text(summary.costPerStudyUsd),
      text(summary.successCountEstimated),
      ...metrics(summary.totals),
    ],
    ...summary.byRun.map((run) => [
      'run',
      run.key,
      run.runType,
      run.status,
      run.model,
      text(run.startedAt),
      text(run.succeededStudies),
      text(run.costPerStudyUsd),
      text(run.estimated),
      ...metrics(run),
    ]),
    ...summary.byMonth.map((month) => [
      'month',
      month.key,
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      ...metrics(month),
    ]),
  ]);
}

/**
 * 予算判定は既知の累積費用 + 次回見積もり。見積もりなしは累積費用だけと明示する。
 * 累積費用が不明なら projectedUsd は null、予算なし・予算と同額は超過扱いにしない。
 * 除外された価格不明 call 数は警告表示のためそのまま返す。
 */
export function budgetStatus(input: {
  budgetUsd: number | null;
  spentUsd: number | null;
  estimateUsd: number | null;
  unknownPriceCalls: number;
}): {
  exceeds: boolean;
  projectedUsd: number | null;
  usesSpentOnly: boolean;
  unknownPriceCalls: number;
} {
  const projectedUsd = input.spentUsd === null ? null : input.spentUsd + (input.estimateUsd ?? 0);
  return {
    exceeds: input.budgetUsd !== null && projectedUsd !== null && projectedUsd > input.budgetUsd,
    projectedUsd,
    usesSpentOnly: input.estimateUsd === null,
    unknownPriceCalls: input.unknownPriceCalls,
  };
}
