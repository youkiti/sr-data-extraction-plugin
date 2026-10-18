// モデル比較の採点レポート生成（プロンプト版数 9・2026-09-21 の回し直し用）。
// 出力先は runsDir()（BENCH_RUN_LABEL）→ scoresDir()（BENCH_SCORES_DIR で上書き可）。
// src/score.ts（issue #176 のモード比較）とは別建てで、既存の outputs/runs-issue176 /
// outputs/scores-issue176 には触らない。
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { REPEATS, RUN_LABEL, TARGETS, runsDir, scoresDir, selectedModels } from './config';
import { extractThoughtsTokens, recalculateRunCost, readLedger, readLedgerRuns, recalculateLedger, ledgerCostSummary } from './costGuard';
import { computePerRunMetrics, type PerRunMetrics, type RunItem, type ScorableRun } from './metrics';
import { validateAllGold } from './validateGold';
import {
  aggregateModel,
  aggregateModelByPdf,
  missingModels,
  type ModelAggregate,
  type PdfAggregate,
  type RunAggregateInput,
} from './aggregateModels';

/** run JSON の生の形。ScorableRun より広く持つ（promptVersion・thoughtsTokens 等は別途読む） */
interface RawRunFile {
  runId: string;
  model: string;
  inputMode?: string;
  pdfId: string;
  repeat: number;
  promptVersion?: number;
  elapsedMs: number;
  tokensIn: number | null;
  tokensOut: number | null;
  thoughtsTokens?: number | null;
  cachedTokensIn?: number | null;
  costUsd: number | null;
  error: string | null;
  formatError: string | null;
  items: RunItem[];
  rawResponse?: unknown;
}

interface ModelBundle {
  model: string;
  inputs: RunAggregateInput[];
}

async function loadRuns(): Promise<Map<string, ModelBundle>> {
  const gold = await validateAllGold();
  const dir = runsDir();
  const names = (await readdir(dir).catch(() => [] as string[])).filter(
    (name) => name.endsWith('.json') && !name.startsWith('_'),
  );
  if (names.length === 0) {
    throw new Error(`${dir} に run がありません。先に npm run run を実行してください。`);
  }

  const byModel = new Map<string, ModelBundle>();
  let recordedCostCount = 0;
  for (const name of names) {
    const raw = await readFile(path.join(dir, name), 'utf8');
    const run = JSON.parse(raw) as RawRunFile;
    const goldFile = gold.get(run.pdfId);
    if (goldFile === undefined) {
      // gold が無い pdfId の run は黙って飛ばさず throw する
      throw new Error(`gold が見つからない pdfId の run があります: pdfId=${run.pdfId} (${name})`);
    }
    const cost = recalculateRunCost(run);
    if (cost.usedRecordedCost) recordedCostCount += 1;
    const metrics = computePerRunMetrics({ ...run, costUsd: cost.costUsd } as ScorableRun, goldFile);
    const promptVersion = typeof run.promptVersion === 'number' ? run.promptVersion : null;
    const thoughtsTokens =
      typeof run.thoughtsTokens === 'number' ? run.thoughtsTokens : extractThoughtsTokens(run.rawResponse ?? null);
    const cachedTokensIn = typeof run.cachedTokensIn === 'number' ? run.cachedTokensIn : null;

    const bundle = byModel.get(run.model) ?? { model: run.model, inputs: [] };
    bundle.inputs.push({ metrics, promptVersion, thoughtsTokens, cachedTokensIn });
    byModel.set(run.model, bundle);
  }
  console.log(`費用再計算: usageMetadata が無いため記録値を使用 ${recordedCostCount} 件`);
  const ledger = await readLedger(path.join(dir, '_cost-ledger.jsonl'));
  console.log(ledgerCostSummary(recalculateLedger(ledger, await readLedgerRuns(dir, ledger))));
  return byModel;
}

async function ensureWritableScoresDir(dir: string): Promise<void> {
  let existingNames: string[] = [];
  try {
    existingNames = await readdir(dir);
  } catch {
    existingNames = [];
  }
  if (existingNames.length > 0 && process.env.BENCH_SCORES_OVERWRITE !== '1') {
    throw new Error(
      `採点結果の出力先に既存ファイルがあります（上書きしません）: ${dir}\n` +
        'BENCH_SCORES_OVERWRITE=1 を設定すると上書きします（過去の採点結果を誤って上書きしないための既定）。',
    );
  }
  await mkdir(dir, { recursive: true });
}

function pct(value: number | null): string {
  return value === null ? 'N/A' : `${(value * 100).toFixed(1)}%`;
}

/** SD 欄（ポイント表記）。反復が実質 1 回のモデルは JSON の値（0）をそのまま出さず「—（1 反復）」と示す */
function sdPoint(value: number | null, distinctRepeats: number): string {
  if (distinctRepeats <= 1) return '—（1 反復）';
  return value === null ? 'N/A' : `${(value * 100).toFixed(1)}pt`;
}

function usdPerPaper(value: number | null): string {
  return value === null ? 'N/A' : `$${value.toFixed(4)}`;
}

function seconds(value: number | null): string {
  return value === null ? 'N/A' : `${(value / 1000).toFixed(1)}s`;
}

async function main(): Promise<void> {
  const byModel = await loadRuns();
  const dir = scoresDir();
  await ensureWritableScoresDir(dir);

  const expectedPdfIds = TARGETS.map((t) => t.pdfId);
  const options = { expectedPdfIds, expectedRepeats: REPEATS };

  interface ModelResult {
    model: string;
    aggregate: ModelAggregate;
    byPdf: PdfAggregate[];
    perRun: PerRunMetrics[];
    distinctRepeats: number;
  }
  const results: ModelResult[] = [];
  for (const [model, bundle] of byModel) {
    const aggregate = aggregateModel(bundle.inputs, options);
    const byPdf = aggregateModelByPdf(bundle.inputs);
    const perRun = bundle.inputs.map((i) => i.metrics);
    const distinctRepeats = Object.keys(aggregate.accuracyByRepeat).length;
    results.push({ model, aggregate, byPdf, perRun, distinctRepeats });
  }
  results.sort((a, b) => a.model.localeCompare(b.model));

  const summary = results.map((r) => ({ model: r.model, ...r.aggregate }));
  await writeFile(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');

  for (const r of results) {
    await writeFile(
      path.join(dir, `${r.model.replace(/\//g, '__')}.json`),
      JSON.stringify({ model: r.model, perRun: r.perRun, byPdf: r.byPdf, aggregate: r.aggregate }, null, 2),
      'utf8',
    );
  }

  const warnings: string[] = [];
  for (const r of results) {
    if (!r.aggregate.complete) {
      warnings.push(
        `- [ ] ${r.model}: 未完了（runCount=${r.aggregate.runCount} / expectedRunCount=${r.aggregate.expectedRunCount}）`,
      );
    }
    if (r.aggregate.promptVersions.length > 1) {
      warnings.push(`- [ ] ${r.model}: promptVersion が混在しています（${r.aggregate.promptVersions.join(', ')}）`);
    }
    // 失敗 run を黙って混ぜない: 凍結定義どおり全項目不正解として主指標に含めているが、
    // 失敗 run があること自体は表にも警告にも必ず出す
    if (r.aggregate.failedRunCount > 0) {
      const failedRuns = r.perRun.filter((run) => run.failed);
      const failedPdfIds = failedRuns.map((run) => run.pdfId).join(', ');
      const firstReason = failedRuns.find((run) => run.failureReason !== null)?.failureReason ?? '(理由不明)';
      warnings.push(
        `- [ ] ${r.model}: 失敗 run が ${r.aggregate.failedRunCount} 件（${failedPdfIds}）。` +
          `主指標はこれらを全項目不正解として含む。失敗理由: ${firstReason.slice(0, 80)}`,
      );
    }
  }
  // run が 1 件も無い期待モデル（費用上限で中断した等）は結果集合に現れないため、
  // 黙って表・警告から落とさず、選択中モデル（config.selectedModels()。BENCH_MODELS 未指定なら
  // MODELS 全部）を期待値として突き合わせる
  const expectedModelIds = selectedModels().map((m) => m.id);
  const expectedRunCountPerModel = expectedPdfIds.length * REPEATS;
  for (const model of missingModels(expectedModelIds, results.map((r) => r.model))) {
    warnings.push(`- [ ] ${model}: run が 1 件もありません（期待 ${expectedRunCountPerModel} 件）`);
  }

  const lines = [
    `# モデル比較レポート（実行ラベル: ${RUN_LABEL}）`,
    '',
    `生成日時: ${new Date().toISOString()}`,
    '',
    '| モデル | 全体正確度 | 全体正確度（数値として一致） | 表由来正確度 | not_reported感度 | not_reported特異度 | quoteアンカー成功率 | 重大エラー率 | verbatim率 | 反復間SD | 失敗run | 平均コスト(USD/論文) | 平均応答時間 | runCount | promptVersion |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...results.map((r) => {
      const a = r.aggregate;
      return (
        `| ${r.model} | ${pct(a.accuracy)} | ${pct(a.accuracyNumeric)} | ${pct(a.tableLikelyAccuracy)} | ${pct(a.notReportedSensitivity)} | ` +
        `${pct(a.notReportedSpecificity)} | ${pct(a.anchorSuccessRate)} | ${pct(a.majorErrorRate)} | ` +
        `${pct(a.verbatimRate)} | ${sdPoint(a.accuracySdAcrossRepeats, r.distinctRepeats)} | ${a.failedRunCount} | ` +
        `${usdPerPaper(a.meanCostUsd)} | ${seconds(a.meanElapsedMs)} | ${a.runCount} | ${a.promptVersions.join(',') || 'N/A'} |`
      );
    }),
    '',
    '## 警告',
    '',
    ...(warnings.length > 0 ? warnings : ['- なし']),
  ];
  await writeFile(path.join(dir, 'REPORT.md'), lines.join('\n'), 'utf8');

  // 表に続けて「## 警告」の節もコンソールに出す（run が無いモデルの警告等を画面でも見えるように）
  console.log(lines.join('\n'));
  console.log(`\n採点結果: ${dir}`);
}

await main();
