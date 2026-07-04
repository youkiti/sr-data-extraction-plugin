// 突合・集計 → outputs/scores/（IMPLEMENTATION.md §9）。
// 採点定義は README.md §4.0〜§4.2 が正典。ここではその定義をそのまま実装する。
// 採用判断（README.md §5）はスクリプトで自動化しない — 集計は機械、採用判断は人 + REPORT.md
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AnchorStatus } from '../../../src/domain/anchor.js';
import { normalizeText } from '../../../src/features/anchoring/normalizeText.js';
import { benchRoot, MODELS, TARGETS } from './config.js';

// ── 入力 JSON の型 ──────────────────────────────────────────────

/** gold/{pdf_id}.json の 1 行（README.md §6.3 が正典） */
interface GoldRow {
  field_id: string;
  entity_key: string;
  not_reported: boolean;
  value_gold: string | null;
  acceptable_values: string[];
  source_page?: number | null;
  source_quote?: string | null;
  note?: string | null;
}

interface GoldFile {
  pdf_id: string;
  pmcid?: string;
  schema_version: number;
  created_by?: string;
  created_at?: string;
  rows: GoldRow[];
}

/** runner.ts が保存する run JSON の 1 項目（本番 ValidatedAiItem + anchor 結果） */
interface RunItem {
  fieldId: string;
  entityKey: string;
  value: string | null;
  notReported: boolean;
  quote: string | null;
  page: number | null;
  confidence: string | null;
  forcedLowReasons: string[];
  anchor: {
    status: AnchorStatus;
    page: number | null;
    matchCount: number;
    bestDistance: number | null;
    distanceRatio: number | null;
  } | null;
}

/** runner.ts が保存する run JSON 全体 */
interface RunRecord {
  runId: string;
  model: string;
  pdfId: string;
  repeat: number;
  promptVersion: number;
  executedAt: string;
  elapsedMs: number;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
  rejected: unknown[];
  items: RunItem[];
  rawResponse?: unknown;
  error?: string;
  formatError?: string;
}

// ── 突合・指標計算（README.md §4.0〜§4.2） ──────────────────────

/** (model, pdfId, repeat) 単位の 1 run から計算する指標一式 */
interface Metrics {
  /** (1) 項目レベル正確度 */
  itemAccuracy: number | null;
  /** (2a) not_reported 感度 */
  notReportedSensitivity: number | null;
  /** (2b) not_reported 特異度（README.md の定義どおり。分子は「AIが値を返した行数」） */
  notReportedSpecificity: number | null;
  /** (3) quote アンカリング成功率 */
  anchorSuccessRate: number | null;
  /** 補助: 重大エラー率 */
  majorErrorRate: number | null;
  /** 補助: verbatim 率 */
  verbatimRate: number | null;
  /**
   * arm レベルの gold 行のうち AI 応答に対応する entity_key が存在した割合。
   * README.md §4.0「arm 番号ずれ」の検知補助（自動で入れ替えはしない。閾値未満は
   * armMismatchFlags としてフラグを立て、REPORT.md での人手確認を促すだけ）
   */
  armCoverageRate: number | null;
}

const ARM_COVERAGE_FLAG_THRESHOLD = 0.5;

function itemKey(fieldId: string, entityKey: string): string {
  return `${fieldId}::${entityKey}`;
}

/** value_gold または acceptable_values のいずれかと正規化後完全一致すれば正解（README.md §4.0） */
function valuesMatch(aiValue: string | null, gold: GoldRow): boolean {
  if (aiValue === null) {
    return false;
  }
  const normAi = normalizeText(aiValue);
  const candidates = [gold.value_gold, ...gold.acceptable_values].filter(
    (v): v is string => v !== null && v !== undefined,
  );
  return candidates.some((v) => normalizeText(v) === normAi);
}

function computeMetrics(goldRows: readonly GoldRow[], items: readonly RunItem[]): Metrics {
  // 突合キー: field_id + entity_key（README.md §4.0）。応答内に重複キーがあれば
  // 最後の要素を採用する（validateAiOutput 通過後は本来重複しない想定だが、
  // モデルが同一 field_id×entity_key を複数回返すケースへの防御）
  const itemMap = new Map<string, RunItem>();
  for (const item of items) {
    itemMap.set(itemKey(item.fieldId, item.entityKey), item);
  }

  // (1) 項目レベル正確度: 「報告あり行で値一致」+「gold not_reported 行で AI も not_reported」
  let correct = 0;
  for (const gold of goldRows) {
    const ai = itemMap.get(itemKey(gold.field_id, gold.entity_key));
    if (gold.not_reported) {
      if (ai !== undefined && ai.notReported === true) correct++;
    } else if (ai !== undefined && ai.notReported === false && valuesMatch(ai.value, gold)) {
      correct++;
    }
  }
  const itemAccuracy = goldRows.length > 0 ? correct / goldRows.length : null;

  // (2a) not_reported 感度
  const notReportedGold = goldRows.filter((g) => g.not_reported);
  const notReportedHits = notReportedGold.filter((g) => {
    const ai = itemMap.get(itemKey(g.field_id, g.entity_key));
    return ai !== undefined && ai.notReported === true;
  }).length;
  const notReportedSensitivity = notReportedGold.length > 0 ? notReportedHits / notReportedGold.length : null;

  // (2b) not_reported 特異度: gold 報告ありのうち AI が値を返した（not_reported=false とした）割合
  // ※ 値そのものの正誤は問わない（値の正誤は (1) と重大エラー率が捉える）
  const reportedGold = goldRows.filter((g) => !g.not_reported);
  const reportedHits = reportedGold.filter((g) => {
    const ai = itemMap.get(itemKey(g.field_id, g.entity_key));
    return ai !== undefined && ai.notReported === false;
  }).length;
  const notReportedSpecificity = reportedGold.length > 0 ? reportedHits / reportedGold.length : null;

  // 補助: 重大エラー率 = gold 報告あり行で AI が値を返したが acceptable_values にも
  // 一致しない別の値だった行数 / gold 報告ありの行数（not_reported の見落としは含めない）
  const majorErrors = reportedGold.filter((g) => {
    const ai = itemMap.get(itemKey(g.field_id, g.entity_key));
    return ai !== undefined && ai.notReported === false && ai.value !== null && !valuesMatch(ai.value, g);
  }).length;
  const majorErrorRate = reportedGold.length > 0 ? majorErrors / reportedGold.length : null;

  // (3) quote アンカリング成功率 / 補助 verbatim 率: 分母は AI 行（quote 非 null）そのもの。
  // gold との突合とは独立（README.md §4.1 (3)）
  const quotedItems = items.filter((it) => it.quote !== null && it.quote.trim() !== '');
  const anchoredOk = quotedItems.filter(
    (it) => it.anchor !== null && (it.anchor.status === 'exact' || it.anchor.status === 'normalized' || it.anchor.status === 'fuzzy'),
  );
  const anchorSuccessRate = quotedItems.length > 0 ? anchoredOk.length / quotedItems.length : null;
  const verbatimOk = quotedItems.filter(
    (it) => it.anchor !== null && (it.anchor.status === 'exact' || it.anchor.status === 'normalized'),
  );
  const verbatimRate = quotedItems.length > 0 ? verbatimOk.length / quotedItems.length : null;

  // arm 番号ずれ検知の補助指標
  const armGold = goldRows.filter((g) => g.entity_key.startsWith('arm:'));
  const armCovered = armGold.filter((g) => itemMap.has(itemKey(g.field_id, g.entity_key))).length;
  const armCoverageRate = armGold.length > 0 ? armCovered / armGold.length : null;

  return {
    itemAccuracy,
    notReportedSensitivity,
    notReportedSpecificity,
    anchorSuccessRate,
    majorErrorRate,
    verbatimRate,
    armCoverageRate,
  };
}

// ── 集計（3 反復平均 + 反復間 SD。README.md §9.2 推奨集計） ──────

const METRIC_KEYS = [
  'itemAccuracy',
  'notReportedSensitivity',
  'notReportedSpecificity',
  'anchorSuccessRate',
  'majorErrorRate',
  'verbatimRate',
  'armCoverageRate',
] as const satisfies readonly (keyof Metrics)[];

function mean(values: readonly number[]): number | null {
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/** 標本標準偏差（n<2 は不定なので null） */
function sd(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const m = mean(values) as number;
  const variance = values.reduce((acc, v) => acc + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

interface Aggregate {
  mean: Record<(typeof METRIC_KEYS)[number], number | null>;
  sd: Record<(typeof METRIC_KEYS)[number], number | null>;
  n: number;
}

function aggregate(metricsList: readonly Metrics[]): Aggregate {
  const meanOut = {} as Aggregate['mean'];
  const sdOut = {} as Aggregate['sd'];
  for (const key of METRIC_KEYS) {
    const values = metricsList.map((m) => m[key]).filter((v): v is number => v !== null);
    meanOut[key] = mean(values);
    sdOut[key] = sd(values);
  }
  return { mean: meanOut, sd: sdOut, n: metricsList.length };
}

// ── I/O ──────────────────────────────────────────────────────

async function loadGold(pdfId: string): Promise<GoldFile | null> {
  try {
    const raw = await readFile(path.join(benchRoot, 'gold', `${pdfId}.json`), 'utf8');
    return JSON.parse(raw) as GoldFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function loadRuns(): Promise<RunRecord[]> {
  const dir = path.join(benchRoot, 'outputs', 'runs');
  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  } catch {
    files = [];
  }
  const records: RunRecord[] = [];
  for (const file of files) {
    const raw = await readFile(path.join(dir, file), 'utf8');
    records.push(JSON.parse(raw) as RunRecord);
  }
  return records;
}

interface RunScore {
  runId: string;
  pdfId: string;
  repeat: number;
  metrics: Metrics;
  costUsd: number | null;
  elapsedMs: number;
  flags: string[];
  runError: string | null;
  runFormatError: string | null;
}

interface PdfAggregate extends Aggregate {
  costUsdTotal: number;
  elapsedMsMean: number | null;
}

interface ModelScore {
  model: string;
  /** (model, pdfId, repeat) 単位の生スコア */
  byRun: RunScore[];
  /** pdfId 単位の 3 反復平均 + SD */
  byPdf: Record<string, PdfAggregate>;
  /** 3 反復 × 2 論文をプールした全体平均 + SD */
  overall: PdfAggregate;
  /** arm 番号ずれの疑いがある run（README.md §4.0。人手確認のためのフラグのみ） */
  armMismatchFlags: Array<{ pdfId: string; repeat: number; runId: string; flags: string[] }>;
}

async function main(): Promise<void> {
  const runs = await loadRuns();
  if (runs.length === 0) {
    console.error(
      'outputs/runs/ に run が見つかりません。先に npm run extract-text && npm run run を実行してください。',
    );
    process.exitCode = 1;
    return;
  }

  const goldByPdf = new Map<string, GoldFile>();
  for (const target of TARGETS) {
    const gold = await loadGold(target.pdfId);
    if (gold === null) {
      console.warn(
        `gold/${target.pdfId}.json が見つかりません。この論文は採点をスキップします（ランナーは実行済みでも可）。`,
      );
      continue;
    }
    goldByPdf.set(target.pdfId, gold);
  }
  if (goldByPdf.size === 0) {
    console.error(
      'ゴールドスタンダードが1件もありません。gold/{pdf_id}.json を用意してください（gold/README.md 参照）。',
    );
    process.exitCode = 1;
    return;
  }

  const outDir = path.join(benchRoot, 'outputs', 'scores');
  await mkdir(outDir, { recursive: true });

  const summaryModels: Array<{
    model: string;
    n: number;
    overall: { mean: Aggregate['mean']; sd: Aggregate['sd']; costUsdTotal: number; elapsedMsMean: number | null };
    armMismatchFlagCount: number;
    runErrorCount: number;
    runFormatErrorCount: number;
  }> = [];

  for (const model of MODELS) {
    const modelRuns = runs.filter((r) => r.model === model.id && goldByPdf.has(r.pdfId));
    if (modelRuns.length === 0) {
      console.warn(`model=${model.id} の run（ゴールドが揃っている論文分）が見つかりません。スキップします。`);
      continue;
    }

    const byRun: RunScore[] = modelRuns.map((run) => {
      const gold = goldByPdf.get(run.pdfId) as GoldFile;
      const metrics = computeMetrics(gold.rows, run.items);
      const flags: string[] = [];
      if (metrics.armCoverageRate !== null && metrics.armCoverageRate < ARM_COVERAGE_FLAG_THRESHOLD) {
        flags.push(
          `arm レベルの一致行が少ない（coverage=${(metrics.armCoverageRate * 100).toFixed(1)}%）。` +
            `arm 番号のずれの可能性あり。README.md §4.0 参照・REPORT.md に人手確認の結果を記録すること`,
        );
      }
      if (run.error) {
        flags.push(`LLM 呼び出しが全リトライ失敗（error="${run.error}"）。全 gold 行が不正解として計上されている`);
      }
      if (run.formatError) {
        flags.push(`AI応答のJSONパース失敗（formatError="${run.formatError}"）。全 gold 行が不正解として計上されている`);
      }
      return {
        runId: run.runId,
        pdfId: run.pdfId,
        repeat: run.repeat,
        metrics,
        costUsd: run.costUsd,
        elapsedMs: run.elapsedMs,
        flags,
        runError: run.error ?? null,
        runFormatError: run.formatError ?? null,
      };
    });

    const byPdf: Record<string, PdfAggregate> = {};
    for (const target of TARGETS) {
      const pdfRuns = byRun.filter((r) => r.pdfId === target.pdfId);
      if (pdfRuns.length === 0) continue;
      byPdf[target.pdfId] = {
        ...aggregate(pdfRuns.map((r) => r.metrics)),
        costUsdTotal: pdfRuns.reduce((sum, r) => sum + (r.costUsd ?? 0), 0),
        elapsedMsMean: mean(pdfRuns.map((r) => r.elapsedMs)),
      };
    }

    const overall: PdfAggregate = {
      ...aggregate(byRun.map((r) => r.metrics)),
      costUsdTotal: byRun.reduce((sum, r) => sum + (r.costUsd ?? 0), 0),
      elapsedMsMean: mean(byRun.map((r) => r.elapsedMs)),
    };

    const modelScore: ModelScore = {
      model: model.id,
      byRun,
      byPdf,
      overall,
      armMismatchFlags: byRun
        .filter((r) => r.flags.length > 0)
        .map((r) => ({ pdfId: r.pdfId, repeat: r.repeat, runId: r.runId, flags: r.flags })),
    };

    const outPath = path.join(outDir, `${model.id.replace(/\//g, '__')}.json`);
    await writeFile(outPath, JSON.stringify(modelScore, null, 2), 'utf8');
    console.log(`scores/${path.basename(outPath)} 書き出し完了（run数=${byRun.length}）`);

    summaryModels.push({
      model: model.id,
      n: overall.n,
      overall: {
        mean: overall.mean,
        sd: overall.sd,
        costUsdTotal: overall.costUsdTotal,
        elapsedMsMean: overall.elapsedMsMean,
      },
      armMismatchFlagCount: modelScore.armMismatchFlags.length,
      runErrorCount: byRun.filter((r) => r.runError !== null).length,
      runFormatErrorCount: byRun.filter((r) => r.runFormatError !== null).length,
    });
  }

  await writeFile(
    path.join(outDir, 'summary.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        note:
          '採用判断（README.md §5 の手順1〜4）は本ファイルの数値を人が読んで REPORT.md に記録する。' +
          'このスクリプトは足切り・順位付け・採用モデルの自動判定は行わない。',
        goldPdfIds: [...goldByPdf.keys()],
        models: summaryModels,
      },
      null,
      2,
    ),
    'utf8',
  );
  console.log('scores/summary.json 書き出し完了。採用判断は README.md §5 の手順に従い人手で REPORT.md に記録すること。');
}

await main();
