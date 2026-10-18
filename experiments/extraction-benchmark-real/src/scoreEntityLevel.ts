// issue #377 段階 1: 保存済みの run を、項目の区分（src/entityGroups.ts）ごとに gold と突き合わせて集計する。
// LLM は呼ばない。主指標（src/metrics.ts の accuracy）と同じ一致規則で、区分ごとの正確度と誤りの内訳を出す。
// 出力: scoresDir() 配下の entity-level.json / entity-level.md（件数と割合だけ。gold の値・引用は出さない）。
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { TARGETS, runsDir, scoresDir } from './config';
import { matchesValue, computePerRunMetrics, type RunItem, type ScorableRun } from './metrics';
import { bestArmMapping } from './armInvariant';
import { validateAllGold, type GoldFile } from './validateGold';
import {
  ENTITY_GROUPS,
  ENTITY_GROUP_LABELS,
  classifyRow,
  groupOf,
  type EntityGroup,
  type RowOutcome,
} from './entityGroups';

const OUTCOMES: RowOutcome[] = ['correct', 'missing_row', 'missed_value', 'extra_value', 'wrong_value', 'empty_value'];
const DEFAULT_MODEL = 'gemini-3.8-flash';
/** 段階 2 へ進む基準（2026-10-18 に集計前の issue コメントで確定）: アウトカムが他より 5 ポイント以上低い */
const DECISION_THRESHOLD_POINTS = 5;

type Counts = Record<RowOutcome, number>;
const zero = (): Counts => ({ correct: 0, missing_row: 0, missed_value: 0, extra_value: 0, wrong_value: 0, empty_value: 0 });

interface RawRunFile extends ScorableRun {
  rawResponse?: { candidates?: Array<{ finishReason?: string }> } | null;
}

interface ModelTally {
  model: string;
  runCount: number;
  byGroup: Record<EntityGroup, Counts>;
  /** 群の対応を取り直すと正確度が上がる run（= AI の群の並びが gold と違う）に属する、arm 区分の誤り */
  armOrderErrors: Record<EntityGroup, number>;
  armOrderRuns: string[];
  armCountMismatchRuns: string[];
  truncatedRuns: string[];
  failedRuns: string[];
  /** 検算用: 主指標の overall の正解数の合計（区分別の正解数の合計と一致するはず） */
  overallCorrectCheck: number;
}

function total(counts: Counts): number {
  return OUTCOMES.reduce((sum, key) => sum + counts[key], 0);
}

function sumCounts(list: Counts[]): Counts {
  const out = zero();
  for (const c of list) for (const key of OUTCOMES) out[key] += c[key];
  return out;
}

function pct(n: number, d: number): string {
  return d === 0 ? 'N/A' : `${((n / d) * 100).toFixed(1)}%`;
}

function armCount(keys: Iterable<string>): number {
  return new Set([...keys].filter((k) => k.startsWith('arm:'))).size;
}

async function loadRuns(): Promise<RawRunFile[]> {
  const dir = runsDir();
  const names = (await readdir(dir)).filter((n) => n.endsWith('.json') && !n.startsWith('_'));
  if (names.length === 0) throw new Error(`${dir} に run がありません`);
  const runs: RawRunFile[] = [];
  let excluded = 0;
  for (const name of names) {
    const run = JSON.parse(await readFile(path.join(dir, name), 'utf8')) as RawRunFile;
    // scoreArmInvariant と同じく、ページ画像併用モード（#176）の run は除外する
    if (run.inputMode !== undefined && run.inputMode !== 'text_only') {
      excluded += 1;
      continue;
    }
    runs.push(run);
  }
  console.log(`inputMode が text_only 以外の run を除外: ${excluded} 件`);
  return runs;
}

function tallyRun(tally: ModelTally, run: RawRunFile, gold: GoldFile): void {
  tally.runCount += 1;
  if (run.error !== null || run.formatError !== null) tally.failedRuns.push(run.pdfId);
  const finish = run.rawResponse?.candidates?.map((c) => c.finishReason) ?? [];
  if (finish.some((f) => f === 'MAX_TOKENS') || /MAX_TOKENS|output limit/i.test(run.formatError ?? run.error ?? '')) {
    tally.truncatedRuns.push(run.pdfId);
  }

  const itemsByKey = new Map<string, RunItem>(run.items.map((item) => [`${item.fieldId} ${item.entityKey}`, item]));
  const goldArms = armCount(gold.rows.map((r) => r.entity_key));
  const aiArms = armCount(run.items.map((i) => i.entityKey));
  if (goldArms !== aiArms) tally.armCountMismatchRuns.push(`${run.pdfId}（gold ${goldArms} / AI ${aiArms}）`);
  const order = bestArmMapping(run, gold);
  if (order.changed) tally.armOrderRuns.push(run.pdfId);
  const armShifted = order.changed || goldArms !== aiArms;

  for (const row of gold.rows) {
    const group = groupOf(row.field_id);
    const outcome = classifyRow(row, itemsByKey.get(`${row.field_id} ${row.entity_key}`), matchesValue);
    tally.byGroup[group][outcome] += 1;
    if (outcome !== 'correct' && armShifted && row.entity_key.startsWith('arm:')) tally.armOrderErrors[group] += 1;
  }
  const metrics = computePerRunMetrics(run, gold);
  tally.overallCorrectCheck += Math.round((metrics.overall.accuracy ?? 0) * metrics.overall.rowCount);
}

function renderMarkdown(tallies: ModelTally[]): { md: string; decision: string } {
  const lines: string[] = [];
  const headerCols = ['区分', 'gold 行', '正解', '正確度', '行の欠落', '未報告の見落とし', '余分な値', '値の誤り', '値が空', '群の並びのずれに属する誤り'];
  for (const t of tallies) {
    lines.push(`### ${t.model}${t.model === DEFAULT_MODEL ? '（既定モデル）' : ''}`, '');
    lines.push(`| ${headerCols.join(' | ')} |`, `| --- |${' ---: |'.repeat(headerCols.length - 1)}`);
    const rows: Array<[string, Counts, number]> = ENTITY_GROUPS.map((g) => [ENTITY_GROUP_LABELS[g], t.byGroup[g], t.armOrderErrors[g]]);
    rows.push(['合計', sumCounts(ENTITY_GROUPS.map((g) => t.byGroup[g])), ENTITY_GROUPS.reduce((s, g) => s + t.armOrderErrors[g], 0)]);
    for (const [label, c, armErr] of rows) {
      const n = total(c);
      const errors = n - c.correct;
      const share = (k: RowOutcome) => `${c[k]}（${pct(c[k], errors)}）`;
      lines.push(`| ${label} | ${n} | ${c.correct} | ${pct(c.correct, n)} | ${share('missing_row')} | ${share('missed_value')} | ${share('extra_value')} | ${share('wrong_value')} | ${share('empty_value')} | ${armErr} |`);
    }
    lines.push('');
    lines.push(`- run: ${t.runCount} 本。失敗 ${t.failedRuns.length} 本、出力上限での打ち切り ${t.truncatedRuns.length} 本${t.truncatedRuns.length ? `（${t.truncatedRuns.join(', ')}）` : ''}`);
    lines.push(`- 群の数が gold と違う run: ${t.armCountMismatchRuns.length} 本${t.armCountMismatchRuns.length ? `（${t.armCountMismatchRuns.join(', ')}）` : ''}`);
    lines.push(`- 群の対応を取り直すと正確度が上がる run: ${t.armOrderRuns.length} 本${t.armOrderRuns.length ? `（${t.armOrderRuns.join(', ')}）` : ''}`, '');
  }

  const def = tallies.find((t) => t.model === DEFAULT_MODEL);
  if (def === undefined) throw new Error(`既定モデル ${DEFAULT_MODEL} の run がありません`);
  const outcome = def.byGroup.outcome;
  const others = sumCounts(ENTITY_GROUPS.filter((g) => g !== 'outcome').map((g) => def.byGroup[g]));
  const outcomeAcc = (outcome.correct / total(outcome)) * 100;
  const othersAcc = (others.correct / total(others)) * 100;
  const gap = othersAcc - outcomeAcc;
  const go = gap >= DECISION_THRESHOLD_POINTS;
  const decision =
    `既定モデル ${DEFAULT_MODEL}: アウトカムの数値 ${outcomeAcc.toFixed(1)}%（${outcome.correct}/${total(outcome)}）、` +
    `ほかの 3 区分の合算 ${othersAcc.toFixed(1)}%（${others.correct}/${total(others)}）、差 ${gap.toFixed(1)} ポイント。` +
    `基準（${DECISION_THRESHOLD_POINTS} ポイント以上低ければ段階 2 へ）に照らして **${go ? '段階 2 へ進む' : '段階 2 へ進まない'}**。`;
  return { md: lines.join('\n'), decision };
}

/** 採用されなかった試行も含めて、出力上限で打ち切られた呼び出しを数える（_failed-*.bak とレジャ） */
async function countTruncatedAttempts(): Promise<{ total: number; detail: string[] }> {
  const dir = runsDir();
  const detail: string[] = [];
  for (const name of (await readdir(dir)).filter((n) => n.startsWith('_failed-'))) {
    const run = JSON.parse(await readFile(path.join(dir, name), 'utf8')) as RawRunFile;
    const finish = run.rawResponse?.candidates?.map((c) => c.finishReason) ?? [];
    if (finish.includes('MAX_TOKENS') || /MAX_TOKENS|output limit/i.test(`${run.formatError ?? ''} ${run.error ?? ''}`)) {
      detail.push(`${run.model} ${run.pdfId}（退避された失敗試行）`);
    }
  }
  const ledgerPath = path.join(dir, '_cost-ledger.jsonl');
  const ledger = (await readFile(ledgerPath, 'utf8').catch(() => '')).split('\n').filter((l) => l.trim() !== '');
  const outcomes = new Map<string, number>();
  for (const line of ledger) {
    const entry = JSON.parse(line) as { outcome?: string };
    const key = entry.outcome ?? '(なし)';
    outcomes.set(key, (outcomes.get(key) ?? 0) + 1);
  }
  console.log(`レジャの試行の結果: ${[...outcomes].map(([k, v]) => `${k} ${v}`).join(' / ')}`);
  const ledgerTruncated = [...outcomes].filter(([k]) => /max_tokens|output_limit|truncat/i.test(k)).reduce((s, [, v]) => s + v, 0);
  if (ledgerTruncated > 0) detail.push(`レジャで出力上限の試行 ${ledgerTruncated} 件`);
  return { total: Math.max(detail.length, ledgerTruncated), detail };
}

async function main(): Promise<void> {
  const gold = await validateAllGold();
  const missingGold = TARGETS.filter((t) => !gold.has(t.pdfId)).map((t) => t.pdfId);
  if (missingGold.length > 0) throw new Error(`gold が無い論文があります: ${missingGold.join(', ')}`);

  const runs = await loadRuns();
  const byModel = new Map<string, ModelTally>();
  for (const run of runs) {
    const goldFile = gold.get(run.pdfId);
    if (goldFile === undefined) throw new Error(`gold が見つからない pdfId の run: ${run.runId}`);
    const tally = byModel.get(run.model) ?? {
      model: run.model,
      runCount: 0,
      byGroup: Object.fromEntries(ENTITY_GROUPS.map((g) => [g, zero()])) as Record<EntityGroup, Counts>,
      armOrderErrors: Object.fromEntries(ENTITY_GROUPS.map((g) => [g, 0])) as Record<EntityGroup, number>,
      armOrderRuns: [],
      armCountMismatchRuns: [],
      truncatedRuns: [],
      failedRuns: [],
      overallCorrectCheck: 0,
    };
    tallyRun(tally, run, goldFile);
    byModel.set(run.model, tally);
  }
  const tallies = [...byModel.values()].sort((a, b) =>
    a.model === DEFAULT_MODEL ? -1 : b.model === DEFAULT_MODEL ? 1 : a.model.localeCompare(b.model),
  );

  // 完全性と検算: 各モデル 10 本、区分別の正解数の合計 = 主指標の正解数の合計、gold 行数の合計 = gold の全行
  const goldRowTotal = TARGETS.reduce((s, t) => s + gold.get(t.pdfId)!.rows.length, 0);
  for (const t of tallies) {
    const all = sumCounts(ENTITY_GROUPS.map((g) => t.byGroup[g]));
    console.log(`${t.model}: run ${t.runCount} 本 / gold 行 ${total(all)}（期待 ${goldRowTotal}）/ 正解 ${all.correct}（主指標の検算 ${t.overallCorrectCheck}）`);
    if (t.runCount !== TARGETS.length) throw new Error(`${t.model} の run が ${t.runCount} 本（期待 ${TARGETS.length}）`);
    if (total(all) !== goldRowTotal) throw new Error(`${t.model} の gold 行の合計が合いません`);
    if (all.correct !== t.overallCorrectCheck) throw new Error(`${t.model} の正解数が主指標と合いません`);
  }

  const truncated = await countTruncatedAttempts();
  const { md, decision } = renderMarkdown(tallies);
  const dir = process.env.BENCH_SCORES_DIR?.trim() || `${scoresDir()}-entity-level`;
  const existing = await readdir(dir).catch(() => [] as string[]);
  if (existing.length > 0 && process.env.BENCH_SCORES_OVERWRITE !== '1') {
    throw new Error(`出力先に既存ファイルがあります（上書きしません）: ${dir}。BENCH_SCORES_OVERWRITE=1 で上書きします`);
  }
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'entity-level.json'), JSON.stringify(tallies, null, 2), 'utf8');
  await writeFile(path.join(dir, 'entity-level.md'), `${md}\n\n## 打ち切り（採用されなかった試行を含む）\n\n${truncated.total} 件${truncated.detail.length ? `: ${truncated.detail.join(', ')}` : ''}\n\n## 判定\n\n${decision}\n`, 'utf8');
  console.log(decision);
  console.log(`出力: ${dir}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
