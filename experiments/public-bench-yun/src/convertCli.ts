import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { safeError } from '../../cochrane-numeric-benchmark/src/cost';
import { readJson, writeJson } from '../../cochrane-numeric-benchmark/src/io';
import { assertRunFilesLedger, readLedger } from '../../cochrane-numeric-benchmark/src/ledger';
import { assertManifestPresent, runIdFor } from '../../cochrane-numeric-benchmark/src/resume';
import { codexEffort, condition, outputRoot, runLabel, runsDir, selectedModels, yunRoot } from './config';
import { assertYunCheckout, loadEvaluation } from './dataset';
import { inputManifest, type Manifest } from './manifest';
import { buildStudyRequest } from './prompt';
import { convertStudies, loadRuns, secondaryMetrics } from './convert';

export async function main(): Promise<void> {
  await assertYunCheckout(yunRoot());
  const dir = runsDir();
  await assertManifestPresent(path.join(dir, '_inputs.json'), true);
  const models = selectedModels(), inputCondition = condition();
  const set = await loadEvaluation(yunRoot(), outputRoot(), inputCondition);
  const plans = models.flatMap((model) => set.studies.map((study) => ({ model, runId: runIdFor(model.id, study.studyKey),
    request: buildStudyRequest(study, set.documents.get(study.studyKey)!) })));
  await inputManifest(set, plans, inputCondition, dir, true, models.some((m) => !('keyEnv' in m)) ? codexEffort() : null);
  const manifest = await readJson<Manifest>(path.join(dir, '_inputs.json'));
  const ledger = await readLedger(path.join(dir, '_ledger.jsonl'), true);
  await assertRunFilesLedger(dir, ledger);
  // 全モデルが揃っていることを、最初の出力より前に確かめる。
  const allRuns = new Map<string, Awaited<ReturnType<typeof loadRuns>>>();
  for (const model of models) allRuns.set(model.id, await loadRuns(dir, model.id, set.studies, ledger, manifest.promptVersion));
  const convertedAt = new Date().toISOString();
  for (const model of models) {
    const runs = allRuns.get(model.id)!;
    const icos = convertStudies(set.studies, new Map(runs.map((run) => [run.studyKey, run])));
    // dataset が付けた o<k> は保持し、保存順だけ元の TEST 行順へ戻す。
    const gold = await readJson<{ id: number; split: string }[]>(path.join(yunRoot(), 'evaluation/data/annotated_rct_dataset.json'));
    const order = new Map(gold.map((row, index) => [row.id, index]));
    icos.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    const destination = path.join(outputRoot(), `records-${runLabel()}`, model.id);
    await writeJson(`${destination}.json`, { label: runLabel(), condition: inputCondition, model: model.id,
      promptVersion: manifest.promptVersion, promptVariant: manifest.promptVariant ?? 'default', harnessCommit: manifest.harnessCommit, convertedAt, icos });
    await writeJson(`${destination}.stats.json`, secondaryMetrics(model.id, set.studies, runs, ledger));
    console.log(`${model.id}: run=${runs.length}, RCT=${set.studies.length}, ICO=${icos.length}`);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await main(); } catch (error) { console.error(safeError(error)); process.exitCode = 1; }
}
