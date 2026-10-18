// issue #176 のモード別採点・比較レポート生成。
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { benchRoot } from './config';
import { recalculateRunCost, type RecordedCostRun } from './costGuard';
import { validateAllGold } from './validateGold';
import { computePerRunMetrics, mean, type PerRunMetrics, type ScorableRun } from './metrics';

interface Aggregate {
  runCount: number;
  failedRunCount: number;
  failureRate: number | null;
  accuracy: number | null;
  tableLikelyAccuracy: number | null;
  notReportedSensitivity: number | null;
  notReportedSpecificity: number | null;
  anchorSuccessRate: number | null;
  majorErrorRate: number | null;
  meanTokensIn: number | null;
  meanTokensOut: number | null;
  meanCostUsd: number | null;
  totalCostUsd: number | null;
  meanElapsedMs: number | null;
}

function r4(value: number | null): number | null {
  return value === null ? null : Math.round(value * 1e4) / 1e4;
}

function aggregate(runs: PerRunMetrics[]): Aggregate {
  const costs = runs.map((run) => run.costUsd).filter((value): value is number => value !== null);
  return {
    runCount: runs.length,
    failedRunCount: runs.filter((run) => run.failed).length,
    failureRate: runs.length === 0 ? null : r4(runs.filter((run) => run.failed).length / runs.length),
    accuracy: mean(runs.map((run) => run.overall.accuracy)),
    tableLikelyAccuracy: mean(runs.map((run) => run.tableLikely.accuracy)),
    notReportedSensitivity: mean(runs.map((run) => run.overall.notReportedSensitivity)),
    notReportedSpecificity: mean(runs.map((run) => run.overall.notReportedSpecificity)),
    anchorSuccessRate: mean(runs.map((run) => run.anchorSuccessRate)),
    majorErrorRate: mean(runs.map((run) => run.overall.majorErrorRate)),
    meanTokensIn: mean(runs.map((run) => run.tokensIn)),
    meanTokensOut: mean(runs.map((run) => run.tokensOut)),
    meanCostUsd: mean(runs.map((run) => run.costUsd)),
    totalCostUsd: costs.length === 0 ? null : r4(costs.reduce((sum, value) => sum + value, 0)),
    meanElapsedMs: mean(runs.map((run) => run.elapsedMs)),
  };
}

function pct(value: number | null): string {
  return value === null ? 'N/A' : `${(value * 100).toFixed(1)}%`;
}

function delta(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : r4(b - a);
}

async function main(): Promise<void> {
  const gold = await validateAllGold();
  const runsDir = path.join(benchRoot, 'outputs', 'runs-issue176');
  const names = (await readdir(runsDir).catch(() => [] as string[])).filter((name) => name.endsWith('.json'));
  if (names.length === 0) {
    console.log('outputs/runs-issue176/ に run がありません。先に npm run run を実行してください。');
    return;
  }
  const perRun: PerRunMetrics[] = [];
  let recordedCostCount = 0;
  for (const name of names) {
    const run = JSON.parse(await readFile(path.join(runsDir, name), 'utf8')) as ScorableRun & RecordedCostRun;
    const cost = recalculateRunCost(run);
    if (cost.usedRecordedCost) recordedCostCount += 1;
    const goldFile = gold.get(run.pdfId);
    if (goldFile !== undefined) perRun.push(computePerRunMetrics({ ...run, costUsd: cost.costUsd }, goldFile));
  }
  console.log(`費用再計算: usageMetadata が無いため記録値を使用 ${recordedCostCount} 件`);
  const textRuns = perRun.filter((run) => run.inputMode === 'text_only');
  const imageRuns = perRun.filter((run) => run.inputMode === 'text_with_page_images');
  const textOnly = aggregate(textRuns);
  const pageImages = aggregate(imageRuns);
  const byStudy = [...new Set(perRun.map((run) => run.pdfId))].map((pdfId) => {
    const text = aggregate(textRuns.filter((run) => run.pdfId === pdfId));
    const images = aggregate(imageRuns.filter((run) => run.pdfId === pdfId));
    return {
      pdfId,
      textOnly: text,
      pageImages: images,
      accuracyDelta: delta(text.accuracy, images.accuracy),
      tableLikelyAccuracyDelta: delta(text.tableLikelyAccuracy, images.tableLikelyAccuracy),
    };
  });
  const comparison = {
    generatedAt: new Date().toISOString(),
    textOnly,
    pageImages,
    deltas: {
      accuracy: delta(textOnly.accuracy, pageImages.accuracy),
      tableLikelyAccuracy: delta(textOnly.tableLikelyAccuracy, pageImages.tableLikelyAccuracy),
      notReportedSpecificity: delta(textOnly.notReportedSpecificity, pageImages.notReportedSpecificity),
      anchorSuccessRate: delta(textOnly.anchorSuccessRate, pageImages.anchorSuccessRate),
      failureRate: delta(textOnly.failureRate, pageImages.failureRate),
      meanCostUsd: delta(textOnly.meanCostUsd, pageImages.meanCostUsd),
      meanElapsedMs: delta(textOnly.meanElapsedMs, pageImages.meanElapsedMs),
    },
    criteria: {
      tableAccuracyImproved5pp: (delta(textOnly.tableLikelyAccuracy, pageImages.tableLikelyAccuracy) ?? -Infinity) >= 0.05,
      overallAccuracyNonInferior5pp: (delta(textOnly.accuracy, pageImages.accuracy) ?? -Infinity) >= -0.05,
      anchorAtLeast90Percent: (pageImages.anchorSuccessRate ?? -Infinity) >= 0.9,
      anchorNonInferior5pp: (delta(textOnly.anchorSuccessRate, pageImages.anchorSuccessRate) ?? -Infinity) >= -0.05,
      notReportedSpecificityNotWorse: (delta(textOnly.notReportedSpecificity, pageImages.notReportedSpecificity) ?? -Infinity) >= 0,
      majorFailureAcceptable: (pageImages.failureRate ?? Infinity) <= 0.03 || (delta(textOnly.failureRate, pageImages.failureRate) ?? Infinity) <= 0,
      improvementNotSingleStudy: byStudy.filter((row) => (row.tableLikelyAccuracyDelta ?? 0) > 0).length >= 2,
    },
    byStudy,
    perRun,
  };
  const scoresDir = path.join(benchRoot, 'outputs', 'scores-issue176');
  await mkdir(scoresDir, { recursive: true });
  await writeFile(path.join(scoresDir, 'comparison.json'), JSON.stringify(comparison, null, 2), 'utf8');

  const lines = [
    '# issue #176 高精度読み取りモード比較', '',
    `生成日時: ${comparison.generatedAt}`, '',
    '| 指標 | text_only | text_with_page_images | 差 |',
    '|---|---:|---:|---:|',
    `| 表由来項目正確度 | ${pct(textOnly.tableLikelyAccuracy)} | ${pct(pageImages.tableLikelyAccuracy)} | ${pct(comparison.deltas.tableLikelyAccuracy)} |`,
    `| 全体正確度 | ${pct(textOnly.accuracy)} | ${pct(pageImages.accuracy)} | ${pct(comparison.deltas.accuracy)} |`,
    `| not_reported 感度 | ${pct(textOnly.notReportedSensitivity)} | ${pct(pageImages.notReportedSensitivity)} | - |`,
    `| not_reported 特異度 | ${pct(textOnly.notReportedSpecificity)} | ${pct(pageImages.notReportedSpecificity)} | ${pct(comparison.deltas.notReportedSpecificity)} |`,
    `| quote アンカー成功率 | ${pct(textOnly.anchorSuccessRate)} | ${pct(pageImages.anchorSuccessRate)} | ${pct(comparison.deltas.anchorSuccessRate)} |`,
    `| 重大エラー率 | ${pct(textOnly.majorErrorRate)} | ${pct(pageImages.majorErrorRate)} | - |`,
    `| transport / format error率 | ${pct(textOnly.failureRate)} | ${pct(pageImages.failureRate)} | ${pct(comparison.deltas.failureRate)} |`,
    `| 平均入力 tokens | ${textOnly.meanTokensIn ?? 'N/A'} | ${pageImages.meanTokensIn ?? 'N/A'} | - |`,
    `| 平均出力 tokens | ${textOnly.meanTokensOut ?? 'N/A'} | ${pageImages.meanTokensOut ?? 'N/A'} | - |`,
    `| 平均コスト (USD) | ${textOnly.meanCostUsd ?? 'N/A'} | ${pageImages.meanCostUsd ?? 'N/A'} | ${comparison.deltas.meanCostUsd ?? 'N/A'} |`,
    `| 累計コスト (USD) | ${textOnly.totalCostUsd ?? 'N/A'} | ${pageImages.totalCostUsd ?? 'N/A'} | - |`,
    `| 平均応答時間 (ms) | ${textOnly.meanElapsedMs ?? 'N/A'} | ${pageImages.meanElapsedMs ?? 'N/A'} | ${comparison.deltas.meanElapsedMs ?? 'N/A'} |`,
    '', '## Study 別の対応差', '',
    '| study | 全体正確度差 | 表由来正確度差 |', '|---|---:|---:|',
    ...byStudy.map((row) => `| ${row.pdfId} | ${pct(row.accuracyDelta)} | ${pct(row.tableLikelyAccuracyDelta)} |`),
    '', '## 採用基準の機械判定', '',
    ...Object.entries(comparison.criteria).map(([name, passed]) => `- [${passed ? 'x' : ' '}] ${name}`),
    '', '> 追加コスト・応答時間の許容可否と最終採否は、この定量結果に基づき人が判断する。',
  ];
  await writeFile(path.join(scoresDir, 'REPORT.md'), lines.join('\n'), 'utf8');
  console.log(lines.slice(0, 18).join('\n'));
  console.log(`\n比較結果: ${scoresDir}`);
}

await main();
