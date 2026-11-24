import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { EXTRACT_DATA_PROMPT_VERSION } from '../../../src/features/extraction/skills/extractData';
import { goldLockPath, runsDir, scoresDir, selectedModels, selectedTiers } from './config';
import { evaluationCounts, inputRoot, loadEvaluation, printCounts, readOptional, writeJson } from './io';
import { assertLabels, verifyGoldLock, type GoldLock } from './goldLock';
import { readLedger, assertRunFilesLedger } from './ledger';
import { loadRecheck } from './recheck';
import { harnessCommit, inputManifest, runIdFor } from './resume';
import { scoreValues, metrics, type ScoredValue } from './score';
import { bootstrap } from './bootstrap';
import { safeError } from './cost';
import type { RunRecord } from './runner';

try {
  const commit = await harnessCommit();
  console.log(`harness commit: ${commit}, prompt version: ${EXTRACT_DATA_PROMPT_VERSION}`);
  const root = await inputRoot();
  const lock = await readOptional<GoldLock>(goldLockPath());
  if (!lock) throw new Error('gold-lock.json がありません。lock-gold を先に実行してください');
  const set = await loadEvaluation(root);
  printCounts(set);
  assertLabels(set.values);
  set.values = (await loadRecheck(set.values)).values;
  await verifyGoldLock(root, lock, set.values);
  await inputManifest(set, true, root, true);
  const models = selectedModels();
  const ledger = await readLedger(path.join(runsDir(), '_ledger.jsonl'), true);
  await assertRunFilesLedger(runsDir(), ledger);
  const allRuns = new Map<string, RunRecord[]>();
  let missing = 0;
  for (const model of models) {
    const runs: RunRecord[] = [];
    for (const study of set.studies) {
      const run = await readOptional<RunRecord>(path.join(runsDir(), `${runIdFor(model.id, study.studyKey)}.json`));
      if (!run) { missing++; continue; }
      if (run.promptVersion !== EXTRACT_DATA_PROMPT_VERSION) throw new Error('run のプロンプト版数が違います');
      if (!['ok', 'format_error', 'request_failed'].includes(run.outcome) || !Array.isArray(run.items)) throw new Error('run の形式が不正です');
      runs.push(run);
    }
    allRuns.set(model.id, runs);
  }
  if (missing) throw new Error(`未実行の run が ${missing} 件あります。全 run が揃うまで採点できません`);
  const rowsByModel = new Map<string, ScoredValue[]>();
  const summaries: Record<string, unknown> = {};
  const output = [];
  for (const model of models) {
    const runs = allRuns.get(model.id)!;
    const rows = scoreValues(set.values, new Map(runs.map((run) => [run.studyKey, run])));
    rowsByModel.set(model.id, rows);
    summaries[model.id] = metrics(rows, runs, ledger);
    output.push(...rows.map((row) => ({ model: model.id, studyKey: row.studyKey, rowId: row.rowId, field: row.field,
      label: row.label, upstreamLabel: row.upstreamLabel, needsRecheck: row.needsRecheck, relabelled: row.relabelled,
      state: row.answer.state, errorCategory: row.errorCategory })));
  }
  await mkdir(scoresDir(), { recursive: true });
  const excluded = Object.fromEntries(['no_pdf', 'no_text_layer', 'no_gold'].map((reason) =>
    [reason, set.excluded.filter((study) => study.reason === reason).length]));
  await writeJson(path.join(scoresDir(), 'summary.json'), { inputs: {
    scoredAt: new Date().toISOString(), harnessCommit: commit, promptVersion: EXTRACT_DATA_PROMPT_VERSION,
    runLabel: path.basename(runsDir()).slice('runs-'.length), models: models.map((model) => model.id),
    tiers: selectedTiers(), goldLock: lock, counts: evaluationCounts(set), excluded, emptyGold: set.emptyGold,
  }, models: summaries,
    bootstrap: bootstrap(models.map((model) => model.id), rowsByModel),
    excluded });
  await writeFile(path.join(scoresDir(), 'values.jsonl'), output.map((row) => JSON.stringify(row) + '\n').join(''), 'utf8');
  console.log('採点結果を保存しました');
} catch (error) { console.error(safeError(error)); process.exitCode = 1; }
