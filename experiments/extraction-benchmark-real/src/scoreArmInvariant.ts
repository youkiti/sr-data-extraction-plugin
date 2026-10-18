// 群（arm）の順番に依存しない感度分析の採点レポート生成。
//
// 採点（src/metrics.ts computePerRunMetrics・src/scoreModels.ts）は gold 行と AI 項目を
// `field_id + entity_key`（entity_key は `arm:1`, `arm:2`, … の位置ベースのラベル）で突き合わせる。
// AI が群を出す順番が gold の群番号の振り方と食い違うと、値が正しくても群ごと不一致になりうる
// 入力の群番号と読み取り順がずれている場合の影響を調べる。
// このスクリプトは「gold と AI の群対応を変えたら正確度がどこまで上がるか」を
// src/armInvariant.ts の純粋関数で計算する、事後的な感度分析。
//
// **主指標（凍結定義の accuracy 等。src/metrics.ts・src/aggregateModels.ts・src/scoreModels.ts）は
// 一切変更しない。** ここで出す「最良値」は gold を見て最良の対応を選ぶので上限寄りの参考値であり、
// 本番の採点結果を置き換えるものではない。
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { bestArmMapping, type ArmMapping } from './armInvariant';
import { benchRoot, RUN_LABEL, runsDir } from './config';
import type { PerRunMetrics, RunItem, ScorableRun } from './metrics';
import { validateAllGold } from './validateGold';
import type { GoldFile } from './validateGold';

/** run JSON の生の形（score モジュールと同型だが、ここは inputMode の除外判定にも使う） */
interface RawRunFile {
  runId: string;
  model: string;
  inputMode?: string;
  pdfId: string;
  repeat: number;
  elapsedMs: number;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
  error: string | null;
  formatError: string | null;
  items: RunItem[];
}

interface LoadedRun {
  model: string;
  pdfId: string;
  repeat: number;
  runId: string;
  scorableRun: ScorableRun;
  goldFile: GoldFile;
}

async function loadRuns(): Promise<{ byModel: Map<string, LoadedRun[]>; excludedCount: number }> {
  const gold = await validateAllGold();
  const dir = runsDir();
  const names = (await readdir(dir).catch(() => [] as string[])).filter(
    (name) => name.endsWith('.json') && !name.startsWith('_'),
  );
  if (names.length === 0) {
    throw new Error(`${dir} に run がありません。先に npm run run を実行してください。`);
  }

  const byModel = new Map<string, LoadedRun[]>();
  let excludedCount = 0;
  for (const name of names) {
    const raw = await readFile(path.join(dir, name), 'utf8');
    const run = JSON.parse(raw) as RawRunFile;
    // text_only 以外（issue #176 のページ画像併用モード）は除外する。inputMode が無い古い run は含める
    if (run.inputMode !== undefined && run.inputMode !== 'text_only') {
      excludedCount += 1;
      continue;
    }
    const goldFile = gold.get(run.pdfId);
    if (goldFile === undefined) {
      // gold が無い pdfId の run は黙って飛ばさず throw する
      throw new Error(`gold が見つからない pdfId の run があります: pdfId=${run.pdfId} (${name})`);
    }
    const scorableRun: ScorableRun = {
      runId: run.runId,
      model: run.model,
      inputMode: 'text_only',
      pdfId: run.pdfId,
      repeat: run.repeat,
      elapsedMs: run.elapsedMs,
      tokensIn: run.tokensIn,
      tokensOut: run.tokensOut,
      costUsd: run.costUsd,
      error: run.error,
      formatError: run.formatError,
      items: run.items,
    };
    const list = byModel.get(run.model) ?? [];
    list.push({ model: run.model, pdfId: run.pdfId, repeat: run.repeat, runId: run.runId, scorableRun, goldFile });
    byModel.set(run.model, list);
  }
  return { byModel, excludedCount };
}

/** 出力先。BENCH_SCORES_DIR（絶対パス）があればそちらを優先する（scoreModels.ts と同じ規則）。 */
function armInvariantScoresDir(): string {
  const override = process.env.BENCH_SCORES_DIR?.trim();
  if (override !== undefined && override !== '') return override;
  return path.join(benchRoot, 'outputs', `scores-${RUN_LABEL}-arm-invariant`);
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

function r4(value: number | null): number | null {
  return value === null ? null : Math.round(value * 1e4) / 1e4;
}

function meanIgnoreNull(values: Array<number | null>): number | null {
  const present = values.filter((v): v is number => v !== null);
  return present.length === 0 ? null : present.reduce((a, b) => a + b, 0) / present.length;
}

function pct(value: number | null): string {
  return value === null ? 'N/A' : `${(value * 100).toFixed(1)}%`;
}

interface RunResult {
  runId: string;
  pdfId: string;
  repeat: number;
  asIs: PerRunMetrics;
  best: PerRunMetrics;
  mapping: ArmMapping;
  changed: boolean;
}

interface ModelSummary {
  model: string;
  runCount: number;
  currentAccuracy: number | null;
  bestAccuracy: number | null;
  accuracyDelta: number | null;
  changedRunCount: number;
  currentMajorErrorRate: number | null;
  bestMajorErrorRate: number | null;
  currentNotReportedSensitivity: number | null;
  bestNotReportedSensitivity: number | null;
  currentNotReportedSpecificity: number | null;
  bestNotReportedSpecificity: number | null;
}

async function main(): Promise<void> {
  const { byModel, excludedCount } = await loadRuns();
  const dir = armInvariantScoresDir();
  await ensureWritableScoresDir(dir);

  const modelResults: Array<{ model: string; perRun: RunResult[]; summary: ModelSummary }> = [];
  for (const [model, runs] of byModel) {
    const perRun: RunResult[] = runs.map((r) => {
      const { asIs, best, mapping, changed } = bestArmMapping(r.scorableRun, r.goldFile);
      return { runId: r.runId, pdfId: r.pdfId, repeat: r.repeat, asIs, best, mapping, changed };
    });

    const currentAccuracy = r4(meanIgnoreNull(perRun.map((r) => r.asIs.overall.accuracy)));
    const bestAccuracy = r4(meanIgnoreNull(perRun.map((r) => r.best.overall.accuracy)));
    const accuracyDelta =
      currentAccuracy !== null && bestAccuracy !== null ? r4(bestAccuracy - currentAccuracy) : null;

    const summary: ModelSummary = {
      model,
      runCount: perRun.length,
      currentAccuracy,
      bestAccuracy,
      accuracyDelta,
      changedRunCount: perRun.filter((r) => r.changed).length,
      currentMajorErrorRate: r4(meanIgnoreNull(perRun.map((r) => r.asIs.overall.majorErrorRate))),
      bestMajorErrorRate: r4(meanIgnoreNull(perRun.map((r) => r.best.overall.majorErrorRate))),
      currentNotReportedSensitivity: r4(meanIgnoreNull(perRun.map((r) => r.asIs.overall.notReportedSensitivity))),
      bestNotReportedSensitivity: r4(meanIgnoreNull(perRun.map((r) => r.best.overall.notReportedSensitivity))),
      currentNotReportedSpecificity: r4(meanIgnoreNull(perRun.map((r) => r.asIs.overall.notReportedSpecificity))),
      bestNotReportedSpecificity: r4(meanIgnoreNull(perRun.map((r) => r.best.overall.notReportedSpecificity))),
    };
    modelResults.push({ model, perRun, summary });
  }
  modelResults.sort((a, b) => a.model.localeCompare(b.model));

  const summary = modelResults.map((r) => r.summary);
  await writeFile(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');

  const details = modelResults.flatMap((r) =>
    r.perRun.map((run) => ({
      model: r.model,
      runId: run.runId,
      pdfId: run.pdfId,
      repeat: run.repeat,
      currentAccuracy: run.asIs.overall.accuracy,
      bestAccuracy: run.best.overall.accuracy,
      changed: run.changed,
      mapping: run.mapping,
    })),
  );
  await writeFile(path.join(dir, 'details.json'), JSON.stringify(details, null, 2), 'utf8');

  const lines: string[] = [
    `# 群（arm）の順番に依存しない感度分析（実行ラベル: ${RUN_LABEL}）`,
    '',
    '> 事後的な感度分析。gold を見て最良の対応を選ぶので上限寄りの参考値。主指標は凍結定義のまま。',
    '',
    `生成日時: ${new Date().toISOString()}`,
    `除外した run（inputMode が text_only 以外）: ${excludedCount} 件`,
    '',
    '| モデル | 現状正確度 | 最良正確度 | 差 | 写像変更run数 | 重大エラー率(現状/最良) | not_reported感度(現状/最良) | not_reported特異度(現状/最良) | runCount |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...modelResults.map((r) => {
      const s = r.summary;
      return (
        `| ${s.model} | ${pct(s.currentAccuracy)} | ${pct(s.bestAccuracy)} | ${pct(s.accuracyDelta)} | ` +
        `${s.changedRunCount} | ${pct(s.currentMajorErrorRate)}/${pct(s.bestMajorErrorRate)} | ` +
        `${pct(s.currentNotReportedSensitivity)}/${pct(s.bestNotReportedSensitivity)} | ` +
        `${pct(s.currentNotReportedSpecificity)}/${pct(s.bestNotReportedSpecificity)} | ${s.runCount} |`
      );
    }),
    '',
    '## 写像が変わった run',
    '',
  ];
  for (const r of modelResults) {
    const changed = r.perRun.filter((run) => run.changed);
    lines.push(`### ${r.model}`, '');
    if (changed.length === 0) {
      lines.push('- なし', '');
      continue;
    }
    for (const run of changed) {
      lines.push(
        `- ${run.pdfId}（repeat ${run.repeat}）: 現状 ${pct(run.asIs.overall.accuracy)} → 最良 ${pct(run.best.overall.accuracy)}` +
          `（写像: ${JSON.stringify(run.mapping)}）`,
      );
    }
    lines.push('');
  }

  await writeFile(path.join(dir, 'REPORT.md'), lines.join('\n'), 'utf8');

  console.log(lines.join('\n'));
  console.log(`\n採点結果: ${dir}`);
}

await main();
