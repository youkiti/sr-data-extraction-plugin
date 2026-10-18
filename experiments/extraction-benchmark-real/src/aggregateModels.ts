// モデル別集計（純粋関数）。凍結された指標定義は兄弟ベンチ
// experiments/extraction-benchmark/src/score.ts の aggregateBasic / accuracySdAcrossRepeats を
// そのまま踏襲する（言い換えずに合わせる。このディレクトリの src/score.ts・src/metrics.ts は変更しない）。
// PerRunMetrics（src/metrics.ts）は入れ子構造（overall.accuracy 等）だが、定義自体は同じ値を指す。
import type { PerRunMetrics } from './metrics';

/** run 単位の指標に加え、PerRunMetrics には無い（metrics.ts の型を広げない）追加情報。 */
export interface RunAggregateInput {
  metrics: PerRunMetrics;
  /** run JSON から別途読む。古い run 記録（v4〜v6）には無いことがある */
  promptVersion: number | null;
  thoughtsTokens: number | null;
  cachedTokensIn: number | null;
}

export interface BasicAggregate {
  accuracy: number | null;
  accuracyNumeric: number | null;
  notReportedSensitivity: number | null;
  notReportedSpecificity: number | null;
  anchorSuccessRate: number | null;
  majorErrorRate: number | null;
  verbatimRate: number | null;
  meanCostUsd: number | null;
  meanElapsedMs: number | null;
  runCount: number;
}

export interface ModelAggregate extends BasicAggregate {
  /** 反復間ばらつき: pdf ごとに反復の正確度の SD を求め、pdf 間で平均した値（母集団 SD・反復 1 回の pdf は 0） */
  accuracySdAcrossRepeats: number | null;
  tableLikelyAccuracy: number | null;
  /** 反復ごとの対象論文平均正確度 */
  accuracyByRepeat: Record<number, number | null>;
  /** 反復平均（accuracyByRepeat の値）の標本 SD（n-1）。反復が 2 未満なら null */
  accuracySdOfRepeatMeans: number | null;
  /**
   * 参考値: 失敗していない run だけの正確度平均（JSON のみ。REPORT.md の表には出さない）。
   * 主指標 `accuracy` は凍結定義どおり失敗 run を全項目不正解として含めたまま変えない
   */
  accuracyExcludingFailed: number | null;
  failedRunCount: number;
  /** 対象論文数 × REPEATS */
  expectedRunCount: number;
  /** runCount が expectedRunCount と一致し、かつ全論文 × 全反復が揃っているか */
  complete: boolean;
  /** run に現れた promptVersion の集合（1 つでなければ呼び出し側で警告する） */
  promptVersions: number[];
  meanTokensIn: number | null;
  meanTokensOut: number | null;
  meanThoughtsTokens: number | null;
  meanCachedTokensIn: number | null;
  totalCostUsd: number | null;
}

export interface PdfAggregate {
  pdfId: string;
  /** 反復平均の正確度 */
  accuracy: number | null;
  runCount: number;
}

/** 母集団標準偏差（n で割る）。空配列は 0 */
function stddev(nums: number[]): number {
  if (nums.length === 0) return 0;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length;
  return Math.sqrt(variance);
}

/** 標本標準偏差（n-1 で割る）。2 件未満は null */
function sampleStddev(nums: number[]): number | null {
  if (nums.length < 2) return null;
  const m = nums.reduce((a, b) => a + b, 0) / nums.length;
  const variance = nums.reduce((a, b) => a + (b - m) ** 2, 0) / (nums.length - 1);
  return Math.sqrt(variance);
}

function r4(value: number | null): number | null {
  return value === null ? null : Math.round(value * 1e4) / 1e4;
}

function meanIgnoreNull(values: Array<number | null>): number | null {
  const present = values.filter((v): v is number => v !== null);
  return present.length === 0 ? null : present.reduce((a, b) => a + b, 0) / present.length;
}

function aggregateBasic(runs: PerRunMetrics[]): BasicAggregate {
  return {
    accuracy: r4(meanIgnoreNull(runs.map((r) => r.overall.accuracy))),
    accuracyNumeric: r4(meanIgnoreNull(runs.map((r) => r.overall.accuracyNumeric))),
    notReportedSensitivity: r4(meanIgnoreNull(runs.map((r) => r.overall.notReportedSensitivity))),
    notReportedSpecificity: r4(meanIgnoreNull(runs.map((r) => r.overall.notReportedSpecificity))),
    anchorSuccessRate: r4(meanIgnoreNull(runs.map((r) => r.anchorSuccessRate))),
    majorErrorRate: r4(meanIgnoreNull(runs.map((r) => r.overall.majorErrorRate))),
    verbatimRate: r4(meanIgnoreNull(runs.map((r) => r.verbatimRate))),
    meanCostUsd: r4(meanIgnoreNull(runs.map((r) => r.costUsd))),
    meanElapsedMs: r4(meanIgnoreNull(runs.map((r) => r.elapsedMs))),
    runCount: runs.length,
  };
}

export interface AggregateModelOptions {
  /** 対象論文の pdfId 一覧（config.TARGETS 由来）。complete / expectedRunCount の判定に使う */
  expectedPdfIds: readonly string[];
  /** 反復回数（config.REPEATS 由来） */
  expectedRepeats: number;
}

export function aggregateModel(inputs: readonly RunAggregateInput[], options: AggregateModelOptions): ModelAggregate {
  const runs = inputs.map((i) => i.metrics);
  const basic = aggregateBasic(runs);

  // 反復間ばらつき: pdf ごとに反復の正確度の SD を求め、pdf 間で平均した値
  // 反復が 2 未満の pdf は SD を 0 として扱う
  const accuraciesByPdf = new Map<string, number[]>();
  for (const r of runs) {
    if (r.overall.accuracy === null) continue;
    const list = accuraciesByPdf.get(r.pdfId) ?? [];
    list.push(r.overall.accuracy);
    accuraciesByPdf.set(r.pdfId, list);
  }
  const perPdfSd = [...accuraciesByPdf.values()].map((accs) => (accs.length >= 2 ? stddev(accs) : 0));
  const accuracySdAcrossRepeats =
    perPdfSd.length > 0 ? r4(perPdfSd.reduce((a, b) => a + b, 0) / perPdfSd.length) : null;

  const tableLikelyAccuracy = r4(meanIgnoreNull(runs.map((r) => r.tableLikely.accuracy)));

  // 反復ごとの対象論文平均正確度
  const accuracyByRepeat: Record<number, number | null> = {};
  const repeats = [...new Set(runs.map((r) => r.repeat))].sort((a, b) => a - b);
  for (const repeat of repeats) {
    const accs = runs.filter((r) => r.repeat === repeat).map((r) => r.overall.accuracy);
    accuracyByRepeat[repeat] = r4(meanIgnoreNull(accs));
  }
  const repeatMeans = Object.values(accuracyByRepeat).filter((v): v is number => v !== null);
  const accuracySdOfRepeatMeans = r4(sampleStddev(repeatMeans));

  const failedRunCount = runs.filter((r) => r.failed).length;
  const accuracyExcludingFailed = r4(meanIgnoreNull(runs.filter((r) => !r.failed).map((r) => r.overall.accuracy)));

  const expectedRunCount = options.expectedPdfIds.length * options.expectedRepeats;
  const presentKeys = new Set(runs.map((r) => `${r.pdfId}__r${r.repeat}`));
  const expectedKeys = new Set<string>();
  for (const pdfId of options.expectedPdfIds) {
    for (let repeat = 1; repeat <= options.expectedRepeats; repeat++) {
      expectedKeys.add(`${pdfId}__r${repeat}`);
    }
  }
  const complete =
    runs.length === expectedRunCount && [...expectedKeys].every((key) => presentKeys.has(key));

  const promptVersions = [...new Set(inputs.map((i) => i.promptVersion).filter((v): v is number => v !== null))].sort(
    (a, b) => a - b,
  );

  const costs = runs.map((r) => r.costUsd).filter((v): v is number => v !== null);

  return {
    ...basic,
    accuracySdAcrossRepeats,
    tableLikelyAccuracy,
    accuracyByRepeat,
    accuracySdOfRepeatMeans,
    accuracyExcludingFailed,
    failedRunCount,
    expectedRunCount,
    complete,
    promptVersions,
    meanTokensIn: r4(meanIgnoreNull(runs.map((r) => r.tokensIn))),
    meanTokensOut: r4(meanIgnoreNull(runs.map((r) => r.tokensOut))),
    meanThoughtsTokens: r4(meanIgnoreNull(inputs.map((i) => i.thoughtsTokens))),
    meanCachedTokensIn: r4(meanIgnoreNull(inputs.map((i) => i.cachedTokensIn))),
    totalCostUsd: costs.length === 0 ? null : r4(costs.reduce((a, b) => a + b, 0)),
  };
}

/**
 * 期待モデル（例: config.selectedModels() の id 一覧）のうち、run が 1 件も無い（結果集合に
 * 現れない）モデルの id を返す。費用上限で中断して最後のモデルが 0 件だった場合など、
 * 「run が無いから何も出ない」を黙って落とさず、呼び出し側が警告できるようにする
 */
export function missingModels(expectedIds: readonly string[], presentIds: readonly string[]): string[] {
  const present = new Set(presentIds);
  return expectedIds.filter((id) => !present.has(id));
}

/** 論文別: 反復平均の正確度と runCount */
export function aggregateModelByPdf(inputs: readonly RunAggregateInput[]): PdfAggregate[] {
  const runs = inputs.map((i) => i.metrics);
  const pdfIds = [...new Set(runs.map((r) => r.pdfId))];
  return pdfIds.map((pdfId) => {
    const rowsForPdf = runs.filter((r) => r.pdfId === pdfId);
    return {
      pdfId,
      accuracy: r4(meanIgnoreNull(rowsForPdf.map((r) => r.overall.accuracy))),
      runCount: rowsForPdf.length,
    };
  });
}
