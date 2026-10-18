import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runsDir, scoresDir, selectedTargets, RUN_LABEL } from './config';
import { billedCostUsd, recalculateRunCost, type RecordedCostRun } from './costGuard';
import { schemaFileName } from './loadSchema';
import { validateAllGold, type GoldRow } from './validateGold';
import { discoverValue, outcomeState, outcomeVocabulary, STATES, type OutcomeRun, type OutcomeState } from './outcomeMetrics';

interface RawRun extends OutcomeRun, RecordedCostRun {
  pdfId: string;
  promptVersion?: number;
  schemaFile?: string;
  rejected?: unknown[];
}

function summarize(rows: readonly GoldRow[], run: OutcomeRun | undefined) {
  const counts = Object.fromEntries(STATES.map((state) => [state, 0])) as Record<OutcomeState, number>;
  let foundSameArm = 0, foundAnyArm = 0;
  for (const row of rows) {
    counts[outcomeState(row, run)]++;
    const found = discoverValue(row, run);
    if (found.foundSameArm) foundSameArm++;
    if (found.foundAnyArm) foundAnyArm++;
  }
  return { rowCount: rows.length, counts, foundSameArm, foundAnyArm };
}

type Summary = ReturnType<typeof summarize>;
function total(parts: Summary[]): Summary {
  const result = summarize([], undefined);
  for (const part of parts) {
    result.rowCount += part.rowCount;
    result.foundSameArm += part.foundSameArm;
    result.foundAnyArm += part.foundAnyArm;
    for (const state of STATES) result.counts[state] += part.counts[state];
  }
  return result;
}
function rates(s: Summary) {
  const ratio = (n: number) => s.rowCount ? n / s.rowCount : null;
  return { omitted: ratio(s.counts.omitted), correct: ratio(s.counts.correct),
    foundSameArm: ratio(s.foundSameArm), foundAnyArm: ratio(s.foundAnyArm) };
}
function pct(n: number | null): string { return n === null ? 'N/A' : `${(n * 100).toFixed(1)}%`; }
function cell(value: unknown): string { return String(value ?? 'N/A').replace(/\|/g, '&#124;').replace(/[\r\n]/g, ' '); }

async function main(): Promise<void> {
  const gold = await validateAllGold();
  let names: string[];
  try { names = await readdir(runsDir()); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    names = [];
  }
  const runs = new Map<string, RawRun>();
  const models = new Set<string>();
  for (const name of names.filter((name) => name.endsWith('.json') && !name.startsWith('_')).sort()) {
    const run = JSON.parse(await readFile(path.join(runsDir(), name), 'utf8')) as RawRun;
    if (!gold.has(run.pdfId)) throw new Error(`gold が無い論文の run: ${run.pdfId} (${name})`);
    if (runs.has(run.pdfId)) throw new Error(`同じ論文の run が複数あります: ${run.pdfId}`);
    runs.set(run.pdfId, run); models.add(run.model);
  }
  if (models.size > 1) throw new Error('複数モデルの run が混在しています');
  const warnings: string[] = [];
  const papers = selectedTargets().map(({ pdfId }) => {
    const file = gold.get(pdfId);
    if (!file) throw new Error(`gold がありません: ${pdfId}`);
    const run = runs.get(pdfId);
    if (!run) warnings.push(`run がありません: ${pdfId}`);
    const reported = summarize(file.rows.filter((row) => !row.not_reported), run);
    const notReported = summarize(file.rows.filter((row) => row.not_reported), run);
    const count = [...Object.values(reported.counts), ...Object.values(notReported.counts)].reduce((a, b) => a + b, 0);
    if (count !== file.rows.length) throw new Error(`状態件数と gold 行数が一致しません: ${pdfId}`);
    const quoted = run?.items.filter((item) => item.quote !== null) ?? [];
    const anchored = quoted.filter((item) => item.anchor !== null && item.anchor.status !== 'failed');
    return {
      pdfId, reported: { ...reported, rates: rates(reported) }, notReported,
      vocabulary: outcomeVocabulary(run?.items ?? []),
      secondary: {
        anchorSuccessRate: quoted.length ? anchored.length / quoted.length : null,
        tokensIn: run?.tokensIn ?? null,
        billedTokensOut: run ? billedCostUsd({ ...run, rawResponse: run.rawResponse, cachedTokensIn: run.cachedTokensIn ?? null }).billedTokensOut : null,
        costUsd: run ? recalculateRunCost(run).costUsd : null,
        rejectedCount: run ? (run.rejected?.length ?? 0) : null,
        promptVersion: run?.promptVersion ?? null,
        schemaFile: run ? (run.schemaFile ?? 'benchmark-schema.json') : null,
      },
    };
  });
  const reported = total(papers.map((p) => p.reported));
  const summary = { runLabel: RUN_LABEL, model: [...models][0] ?? null, schemaFile: schemaFileName(),
    reported: { ...reported, rates: rates(reported) }, notReported: total(papers.map((p) => p.notReported)), papers, warnings };
  const tableRow = (name: string, s: Summary) => {
    const r = rates(s);
    return `| ${cell(name)} | ${s.rowCount} | ${STATES.map((state) => s.counts[state]).join(' | ')} | ${[r.omitted, r.correct, r.foundSameArm, r.foundAnyArm].map(pct).join(' | ')} |`;
  };
  const lines = [
    `# outcome 採点（${RUN_LABEL}）`, '',
    `モデル: ${cell(summary.model)} / スキーマ: ${cell(summary.schemaFile)}`, '',
    '## gold 報告済み行', '',
    `| 論文 | 報告済み行数 | ${STATES.join(' | ')} | omitted 割合 | correct 割合 | foundSameArm 割合 | foundAnyArm 割合 |`,
    `|${Array(15).fill('---').join('|')}|`,
    tableRow('全体', reported), ...papers.map((p) => tableRow(p.pdfId, p.reported)), '',
    '## gold 未報告行（全体）', '',
    '| 状態 | 件数 |', '|---|---:|',
    ...STATES.map((state) => `| ${state} | ${summary.notReported.counts[state]} |`), '',
    '## 使用語', '',
    '| 論文 | slug | time | arm | 組の数 | 要素数 |', '|---|---|---|---|---:|---:|',
    ...papers.map(({ pdfId, vocabulary: v }) => `| ${cell(pdfId)} | ${cell(v.slugs.join(', '))} | ${cell(v.times.join(', '))} | ${cell(v.arms.join(', '))} | ${v.groupCount} | ${v.elementCount} |`), '',
    '## 副指標', '',
    '| 論文 | 照合成功率 | tokensIn | 課金出力トークン | 費用 USD | 破棄数 | プロンプト版数 | スキーマ |', '|---|---:|---:|---:|---:|---:|---|---|',
    ...papers.map(({ pdfId, secondary: s }) => `| ${cell(pdfId)} | ${pct(s.anchorSuccessRate)} | ${cell(s.tokensIn)} | ${cell(s.billedTokensOut)} | ${cell(s.costUsd)} | ${cell(s.rejectedCount)} | ${cell(s.promptVersion)} | ${cell(s.schemaFile)} |`), '',
    '## 警告', '', ...(warnings.length ? warnings.map((w) => `- ${w}`) : ['- なし']),
  ];
  const dir = scoresDir();
  let existing: string[];
  try { existing = await readdir(dir); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    existing = [];
  }
  if (existing.length && process.env.BENCH_SCORES_OVERWRITE !== '1') {
    throw new Error(`採点結果の出力先に既存ファイルがあります（上書きしません）: ${dir}。BENCH_SCORES_OVERWRITE=1 が必要です`);
  }
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'outcome-summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  await writeFile(path.join(dir, 'OUTCOME-REPORT.md'), lines.join('\n'), 'utf8');
  console.log(lines.join('\n'));
}

await main();
