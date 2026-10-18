// 保存済み run の失敗引用を分割照合し、モデル別の救済率と例を出力する。API は呼ばない。
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { benchRoot, runsDir, scoresDir, RUN_LABEL } from './config';
import { normalizeText } from '../../../src/features/anchoring/normalizeText';
import { anchorQuote } from '../../../src/features/anchoring/anchorQuote';
import type { AnchorStatus, NormalizedPage } from '../../../src/domain/anchor';
import { classifySegments, SEGMENT_CLASSES, type SegmentClass } from './anchorSegments';

interface Run {
  model: string;
  pdfId: string;
  error: string | null;
  formatError: string | null;
  items: Array<{ fieldId: string; quote: string | null; page: number | null;
    anchor: { status: AnchorStatus } | null }>;
}
interface Example { pdfId: string; fieldId: string; quote: string }
interface Summary {
  model: string;
  excludedRuns: number;
  quotedCount: number;
  statuses: Record<AnchorStatus, number>;
  classifications: Record<SegmentClass, number>;
  statusMismatchCount: number;
  currentSuccessRate: number | null;
  samePageSuccessRate: number | null;
  anyPageSuccessRate: number | null;
  examples: Record<SegmentClass, Example[]>;
}

function emptySummary(model: string): Summary {
  return {
    model, excludedRuns: 0, quotedCount: 0,
    statuses: { exact: 0, normalized: 0, fuzzy: 0, failed: 0 },
    classifications: { single: 0, has_short_segment: 0, all_same_page: 0, all_diff_pages: 0, partial: 0, none: 0 },
    statusMismatchCount: 0, currentSuccessRate: null, samePageSuccessRate: null, anyPageSuccessRate: null,
    examples: { single: [], has_short_segment: [], all_same_page: [], all_diff_pages: [], partial: [], none: [] },
  };
}

function pct(value: number | null): string {
  return value === null ? 'N/A' : (value * 100).toFixed(1) + '%';
}

async function main(): Promise<void> {
  const dir = scoresDir();
  let existing: string[];
  try { existing = await readdir(dir); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    existing = [];
  }
  if (existing.length > 0 && process.env.BENCH_SCORES_OVERWRITE !== '1') {
    throw new Error('採点結果の出力先に既存ファイルがあります（上書きしません）: ' + dir);
  }
  const runDir = runsDir();
  const names = (await readdir(runDir)).filter((name) => name.endsWith('.json') && !name.startsWith('_')).sort();
  if (names.length === 0) throw new Error('run がありません: ' + runDir);
  const pagesByPdf = new Map<string, NormalizedPage[]>();
  const models = new Map<string, Summary>();
  for (const name of names) {
    const run = JSON.parse(await readFile(path.join(runDir, name), 'utf8')) as Run;
    const summary = models.get(run.model) ?? emptySummary(run.model);
    models.set(run.model, summary);
    if (run.error !== null || run.formatError !== null) {
      summary.excludedRuns += 1;
      continue;
    }
    let pages = pagesByPdf.get(run.pdfId);
    if (pages === undefined) {
      const textLayer = JSON.parse(await readFile(path.join(benchRoot, 'outputs', 'textlayer', run.pdfId + '.json'), 'utf8')) as { pages: Array<{ page: number; text: string }> };
      pages = textLayer.pages.map((p) => ({ page: p.page, text: normalizeText(p.text) }));
      pagesByPdf.set(run.pdfId, pages);
    }
    for (const item of run.items) {
      if (item.quote === null || item.quote.trim() === '') continue;
      summary.quotedCount += 1;
      // 基準は記録時の状態。再照合との差は別途数え、分類と failed の母数を一致させる。
      const status = item.anchor?.status;
      if (status === undefined || !Object.hasOwn(summary.statuses, status)) {
        throw new Error('引用の照合状態が不正です: ' + name + ' / ' + item.fieldId);
      }
      summary.statuses[status] += 1;
      if (anchorQuote(normalizeText(item.quote), pages, item.page).status !== status) summary.statusMismatchCount += 1;
      if (status !== 'failed') continue;
      const classification = classifySegments(item.quote, pages, item.page);
      summary.classifications[classification] += 1;
      const examples = summary.examples[classification];
      if (examples.length < 3) examples.push({
        pdfId: run.pdfId, fieldId: item.fieldId, quote: item.quote.slice(0, 100).replace(/\r\n|\r|\n/g, '⏎'),
      });
    }
    console.error('照合済み: ' + name);
  }
  const summaries = [...models.values()].sort((a, b) => a.model.localeCompare(b.model));
  for (const summary of summaries) {
    if (Object.values(summary.classifications).reduce((a, b) => a + b, 0) !== summary.statuses.failed ||
        Object.values(summary.statuses).reduce((a, b) => a + b, 0) !== summary.quotedCount) {
      throw new Error('集計件数が一致しません: ' + summary.model);
    }
    const successes = summary.quotedCount - summary.statuses.failed;
    const rate = (count: number) => summary.quotedCount === 0 ? null : count / summary.quotedCount;
    summary.currentSuccessRate = rate(successes);
    summary.samePageSuccessRate = rate(successes + summary.classifications.all_same_page);
    summary.anyPageSuccessRate = rate(successes + summary.classifications.all_same_page + summary.classifications.all_diff_pages);
  }
  const lines = [
    '# 引用の分割照合レポート（実行ラベル: ' + RUN_LABEL + '）', '',
    '状態別件数は run の記録値。分割照合と状態差分は現在の本番コードで計算。', '',
    '| モデル | 除外run | 引用数 | exact | normalized | fuzzy | failed | 状態差分 | 現在成功率 | 同一ページ救済 | 別ページも救済 |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...summaries.map((s) => `| ${s.model} | ${s.excludedRuns} | ${s.quotedCount} | ${s.statuses.exact} | ${s.statuses.normalized} | ${s.statuses.fuzzy} | ${s.statuses.failed} | ${s.statusMismatchCount} | ${pct(s.currentSuccessRate)} | ${pct(s.samePageSuccessRate)} | ${pct(s.anyPageSuccessRate)} |`),
    '',
    '| モデル | single | has_short_segment | all_same_page | all_diff_pages | partial | none |',
    '|---|---:|---:|---:|---:|---:|---:|',
    ...summaries.map((s) => `| ${s.model} | ${SEGMENT_CLASSES.map((c) => s.classifications[c]).join(' | ')} |`),
    '', '## 分類例（各分類の先頭3件、引用は先頭100文字）', '',
  ];
  for (const summary of summaries) {
    lines.push('### ' + summary.model, '');
    for (const classification of SEGMENT_CLASSES) {
      lines.push('#### ' + classification, '');
      const examples = summary.examples[classification];
      lines.push(...(examples.length === 0 ? ['- なし'] : examples.map((e) =>
        `- ${e.pdfId} / ${e.fieldId}: ${e.quote}`)), '');
    }
  }
  const markdown = lines.join('\n');
  await mkdir(dir, { recursive: true });
  const flag = process.env.BENCH_SCORES_OVERWRITE === '1' ? 'w' : 'wx';
  await writeFile(path.join(dir, 'anchor-segments-summary.json'), JSON.stringify(summaries, null, 2), { encoding: 'utf8', flag });
  await writeFile(path.join(dir, 'ANCHOR-SEGMENTS-REPORT.md'), markdown, { encoding: 'utf8', flag });
  console.log(markdown);
}

await main();
