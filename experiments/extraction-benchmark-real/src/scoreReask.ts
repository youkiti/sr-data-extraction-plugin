// 保存済みの初回・再探索 run を採点し、集計 JSON と目視確認用 Markdown を出す。
// API は呼ばず、初回との対応と正解数の整合性を検査してから出力する。
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { benchRoot, runsDir, scoresDir, selectedModels, selectedTargets, RUN_LABEL, REPEATS } from './config';
import { billedCostUsd, recalculateRunCost, type RecordedCostRun } from './costGuard';
import { loadBenchmarkSchema } from './loadSchema';
import { cellKey, reaskFields, reaskFromName, targetCells, type ReaskRun, type TargetCell } from './reask';
import { AGREEMENTS, REASONS, STATES, outsideAgreement, summarizeReask } from './reaskMetrics';
import { validateAllGold } from './validateGold';

interface RawRun extends ReaskRun, RecordedCostRun {
  pdfId: string;
  repeat: number;
  inputMode: string;
  reaskFrom?: string;
  reaskFieldIds?: string[];
  reaskTargetCells?: TargetCell[];
  rejected?: unknown[];
}

async function readRuns(dir: string, model: string, pdfIds: Set<string>): Promise<Map<string, RawRun>> {
  let names: string[];
  try { names = await readdir(dir); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    names = [];
  }
  const result = new Map<string, RawRun>();
  for (const name of names.filter((name) => name.endsWith('.json') && !name.startsWith('_')).sort()) {
    const run = JSON.parse(await readFile(path.join(dir, name), 'utf8')) as RawRun;
    // ファイル名に依存せず、保存されたモデルと論文・反復で対応させる。
    if (run.model !== model || !pdfIds.has(run.pdfId)) continue;
    if (run.inputMode !== 'text_only' || run.repeat < 1 || run.repeat > REPEATS) {
      throw new Error(`想定外の入力モード・反復: ${name}`);
    }
    const key = JSON.stringify([run.pdfId, run.repeat]);
    if (result.has(key)) throw new Error(`同じ論文・反復の run が複数あります: ${name}`);
    result.set(key, run);
  }
  return result;
}

function ratio(n: number, d: number): number | null { return d ? n / d : null; }
function pct(n: number | null): string { return n === null ? 'N/A' : `${(100 * n).toFixed(2)}%`; }
function cell(value: unknown): string { return String(value ?? 'N/A').replace(/\|/g, '&#124;').replace(/[\r\n]/g, ' '); }
function table(headers: string[], rows: unknown[][]): string[] {
  return [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`), ''];
}

async function main(): Promise<void> {
  const from = reaskFromName();
  if (from === undefined) throw new Error('BENCH_REASK_FROM が必要です');
  const models = selectedModels();
  if (models.length !== 1) throw new Error('モデルは 1 つだけ指定してください');
  const model = models[0]!.id;
  const targets = selectedTargets();
  const pdfIds = new Set(targets.map((target) => target.pdfId));
  const gold = await validateAllGold();
  const fields = await loadBenchmarkSchema();
  const initialRuns = await readRuns(path.join(benchRoot, 'outputs', from), model, pdfIds);
  const reaskRuns = await readRuns(runsDir(), model, pdfIds);
  const errors: string[] = [];
  for (const { pdfId } of targets) {
    for (let repeat = 1; repeat <= REPEATS; repeat++) {
      const run = initialRuns.get(JSON.stringify([pdfId, repeat]));
      if (!run) errors.push(`${pdfId}: 初回 run がありません（反復 ${repeat}）`);
      else {
        try { targetCells(run); } catch (error) { errors.push(`${pdfId}: ${String(error)}`); }
      }
    }
  }
  if (errors.length) throw new Error(errors.join('\n'));
  const warnings: string[] = [];
  const papers = targets.flatMap(({ pdfId }) => Array.from({ length: REPEATS }, (_, index) => {
    const repeat = index + 1;
    const key = JSON.stringify([pdfId, repeat]);
    const initial = initialRuns.get(key)!;
    const run = reaskRuns.get(key);
    const cells = targetCells(initial);
    const fieldIds = reaskFields(cells, fields).map((field) => field.fieldId);
    if (!run && cells.length) warnings.push(`${pdfId}: 対象セルが ${cells.length} 件ありますが再探索 run がありません（no_reask_run）`);
    if (run) {
      if (run.reaskFrom !== from) throw new Error(`${pdfId}: reaskFrom が一致しません`);
      const expected = cells.map(cellKey).sort();
      const actual = run.reaskTargetCells?.map(cellKey).sort();
      if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error(`${pdfId}: reaskTargetCells が一致しません`);
      if (JSON.stringify(fieldIds) !== JSON.stringify(run.reaskFieldIds)) throw new Error(`${pdfId}: reaskFieldIds が一致しません`);
    }
    const file = gold.get(pdfId);
    if (!file) throw new Error(`${pdfId}: gold がありません`);
    const summary = summarizeReask(initial, run, cells, file.rows);
    const agreement = outsideAgreement(initial, run, run?.reaskFieldIds ?? fieldIds);
    // 対象なしで呼ばなかった論文は正常スキップとして別記する。
    if (!run && !cells.length) agreement.excludedPapers = 0;
    const quoted = run?.items.filter((item) => item.quote !== null) ?? [];
    return { pdfId, repeat, ...summary, agreement, skippedNoTargets: !run && !cells.length,
      secondary: {
        fieldCount: fieldIds.length, tokensIn: run?.tokensIn ?? null,
        billedTokensOut: run ? billedCostUsd({ ...run, rawResponse: run.rawResponse, cachedTokensIn: run.cachedTokensIn ?? null }).billedTokensOut : null,
        costUsd: run ? recalculateRunCost(run).costUsd : null,
        anchorSuccessRate: ratio(quoted.filter((item) => item.anchor !== null && item.anchor.status !== 'failed').length, quoted.length),
        rejectedCount: run ? run.rejected?.length ?? 0 : null,
      } };
  }));
  const overall = summarizeReask({ error: null, formatError: null, items: [] }, undefined, [], []);
  const agreement = outsideAgreement({ error: null, formatError: null, items: [] }, { error: null, formatError: null, items: [] }, []);
  for (const paper of papers) {
    overall.targetCount += paper.targetCount;
    overall.goldRows += paper.goldRows;
    overall.initialCorrect += paper.initialCorrect;
    overall.mergedCorrect += paper.mergedCorrect;
    for (const state of STATES) overall.states[state] += paper.states[state];
    for (const reason of REASONS) overall.reasons[reason] += paper.reasons[reason];
    for (const kind of AGREEMENTS) agreement.counts[kind] += paper.agreement.counts[kind];
    agreement.excludedPapers += paper.agreement.excludedPapers;
  }
  const s = overall.states;
  const primary = {
    rescueRate: ratio(s.rescued_correct, s.rescued_correct + s.rescued_mismatch + s.still_missed),
    fabricatedRate: ratio(s.fabricated, s.fabricated + s.kept_not_reported),
    goldRows: overall.goldRows, initialCorrect: overall.initialCorrect, initialAccuracy: ratio(overall.initialCorrect, overall.goldRows),
    mergedCorrect: overall.mergedCorrect, mergedAccuracy: ratio(overall.mergedCorrect, overall.goldRows),
    netRows: overall.mergedCorrect - overall.initialCorrect,
    netPoints: overall.goldRows ? 100 * (overall.mergedCorrect - overall.initialCorrect) / overall.goldRows : null,
  };
  const agreementRate = (a: typeof agreement) => ratio(a.counts.same, Object.values(a.counts).reduce((a, b) => a + b, 0));
  const summary = { runLabel: RUN_LABEL, reaskFrom: from, model, overall: { ...overall, agreement: { ...agreement, sameRate: agreementRate(agreement) } },
    primary, papers: papers.map((p) => ({ ...p, agreement: { ...p.agreement, sameRate: agreementRate(p.agreement) } })), warnings };
  const stateRows = [{ pdfId: '全体', ...overall }, ...papers];
  const lines = [`# 再探索の採点（${RUN_LABEL}）`, '', `モデル: ${model} / 初回: ${from}`, '',
    '## 対象セルの状態', '', ...table(['論文', '対象セル数', ...STATES], stateRows.map((p) => [p.pdfId, p.targetCount, ...STATES.map((state) => p.states[state])])),
    '## 置き換えなかった理由', '', ...table(['論文', ...REASONS], stateRows.map((p) => [p.pdfId, ...REASONS.map((reason) => p.reasons[reason])])),
    '## 主指標（全体）', '', ...table(['指標', '値'], [
      ['救済率', pct(primary.rescueRate)], ['壊した率', pct(primary.fabricatedRate)], ['gold 全行数', primary.goldRows],
      ['初回正解数', primary.initialCorrect], ['初回正確度', pct(primary.initialAccuracy)], ['置換後正解数', primary.mergedCorrect],
      ['置換後正確度', pct(primary.mergedAccuracy)], ['純増行数', primary.netRows], ['純増ポイント', primary.netPoints],
    ]),
    '## 対象外セルの一致', '', ...table(['論文', ...AGREEMENTS, 'same 割合', '欠落・失敗による除外論文数'],
      [{ pdfId: '全体', agreement }, ...papers].map((p) => [p.pdfId, ...AGREEMENTS.map((kind) => p.agreement.counts[kind]), pct(agreementRate(p.agreement)), p.agreement.excludedPapers])),
    `対象なしの正常スキップ: ${papers.filter((p) => p.skippedNoTargets).length} 論文`, '',
    '## 副指標', '', ...table(['論文', '渡した項目数', 'tokensIn', '課金出力トークン', '費用 USD', '照合成功率', '破棄数'], papers.map((p) => [
      p.pdfId, p.secondary.fieldCount, p.secondary.tokensIn, p.secondary.billedTokensOut, p.secondary.costUsd, pct(p.secondary.anchorSuccessRate), p.secondary.rejectedCount,
    ])),
    '## 救済・不一致と新しく作った誤り（全件）', '', ...table(['論文', '状態', 'field_id', 'entity_key', 'gold の値', '再探索の値', '引用先頭 80 文字'],
      papers.flatMap((p) => p.details.filter((d) => d.state === 'rescued_mismatch' || d.state === 'fabricated').map((d) => [p.pdfId, d.state, d.fieldId, d.entityKey, d.goldValue, d.reaskValue, d.quote]))),
    '## 警告', '', ...(warnings.length ? warnings.map((w) => `- ${w}`) : ['- なし']), '',
  ];
  const dir = scoresDir();
  let existing: string[];
  try { existing = await readdir(dir); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    existing = [];
  }
  if (existing.length && process.env.BENCH_SCORES_OVERWRITE !== '1') throw new Error(`採点結果の出力先に既存ファイルがあります（上書きしません）: ${dir}。BENCH_SCORES_OVERWRITE=1 が必要です`);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'reask-summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  await writeFile(path.join(dir, 'REASK-REPORT.md'), lines.join('\n'), 'utf8');
  console.log(lines.join('\n'));
}

await main();
