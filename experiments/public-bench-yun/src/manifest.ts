import path from 'node:path';
import { EXTRACT_DATA_PROMPT_VERSION } from '../../../src/features/extraction/skills/extractData';
import { assertManifestPresent, checkManifest, harnessCommit, type InputManifest } from '../../cochrane-numeric-benchmark/src/resume';
import { sha256, writeJson } from '../../cochrane-numeric-benchmark/src/io';
import { YUN_COMMIT, type EvaluationSet } from './dataset';
import { selectedModels, type Condition } from './config';
import type { buildStudyRequest } from './prompt';

export interface Manifest extends Omit<InputManifest, 'excluded' | 'emptyGold'> {
  excluded: EvaluationSet['excluded']; emptyGold: null; condition: Condition; yunCommit: string;
  goldSha256: string; models: string[]; codexEffort: string | null;
}
export interface RequestPlan { model: ReturnType<typeof selectedModels>[number]; runId: string; request: ReturnType<typeof buildStudyRequest> }
export function requestHashes(plans: RequestPlan[], effort: string | null): Record<string, string> {
  return Object.fromEntries(plans.map(({ model, runId, request: { messages, chatOptions } }) => [
    `request/${runId}`, sha256(JSON.stringify('keyEnv' in model ? { messages, chatOptions } :
      { messages, chatOptions, codex: { reasoningEffort: effort } })),
  ]));
}
// 共通検証の対象外である追加メタデータも固定する。
export function checkInputs(previous: Manifest, current: Manifest): void {
  const compatible = (value: Manifest): InputManifest => ({ ...value, excluded: [], emptyGold: {} });
  checkManifest(compatible(previous), compatible(current));
  // harnessCommit は記録だけにする（依頼の中身は request のハッシュで固定済み。評価 A の checkManifest と同じ）。
  const metadata = ({ hashes: _hashes, harnessCommit: _commit, ...rest }: Manifest) => rest;
  if (JSON.stringify(metadata(previous)) !== JSON.stringify(metadata(current))) throw new Error('入力マニフェストが違います。新しい BENCH_RUN_LABEL を指定してください');
}
export async function inputManifest(set: EvaluationSet, plans: RequestPlan[], condition: Condition,
  dir: string, dry: boolean, effort: string | null): Promise<void> {
  const current: Manifest = { hashes: { ...set.hashes, ...requestHashes(plans, effort) }, promptVersion: EXTRACT_DATA_PROMPT_VERSION,
    harnessCommit: await harnessCommit(), excluded: set.excluded, emptyGold: null, condition, yunCommit: YUN_COMMIT,
    goldSha256: set.hashes.gold!, models: selectedModels().map((m) => m.id), codexEffort: effort };
  const file = path.join(dir, '_inputs.json');
  const previous = await assertManifestPresent(file, false) as unknown as Manifest | null;
  if (previous) checkInputs(previous, current);
  else if (!dry) await writeJson(file, current);
}
