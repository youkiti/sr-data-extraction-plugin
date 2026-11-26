import { readFile, readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { EXTRACT_DATA_PROMPT_VERSION } from '../../../src/features/extraction/skills/extractData';
import { repoRoot, runsDir, TIERS, EXPECTED_SHA256_PREFIX, selectedModels, codexEffort, type Tier } from './config';
import type { LedgerEntry } from './ledger';
import type { EvaluationSet } from './io';
import { readOptional, writeJson, fileHash, goldFile, refDir, sha256 } from './io';
import { buildStudyRequest } from './prompt';
import { RETRY_MAX_ATTEMPTS } from './retry';

export type RunState = { kind: 'missing' } | { kind: 'corrupt' } |
  { kind: 'parsed'; promptVersion: number; outcome: 'ok' | 'format_error' | 'request_failed' };
// 欠落/履歴なし、確定済み（失敗含む）、破損、欠落/履歴あり、版数違いの全状態を扱う。
export type ResumeAction = { kind: 'execute' | 'backup_execute'; attempt: number } | { kind: 'finalise'; last: LedgerEntry } | { kind: 'skip' };
export function resumeDecision(state: RunState, ledger: readonly LedgerEntry[], version: number): ResumeAction {
  if (state.kind === 'missing' || state.kind === 'corrupt') {
    if (ledger.length >= RETRY_MAX_ATTEMPTS) return { kind: 'finalise', last: ledger[ledger.length - 1]! };
    return { kind: state.kind === 'corrupt' ? 'backup_execute' : 'execute', attempt: ledger.length + 1 };
  }
  if (state.promptVersion !== version) throw new Error('プロンプト版数が違います。新しい BENCH_RUN_LABEL を指定してください');
  return { kind: 'skip' };
}
export function parseRunState(raw: string | null): RunState {
  if (raw === null) return { kind: 'missing' };
  try {
    const value = JSON.parse(raw) as { promptVersion?: number; outcome?: string };
    if (!value || typeof value.promptVersion !== 'number' || !['ok', 'format_error', 'request_failed'].includes(value.outcome ?? '')) return { kind: 'corrupt' };
    return { kind: 'parsed', promptVersion: value.promptVersion, outcome: value.outcome as 'ok' | 'format_error' | 'request_failed' };
  } catch { return { kind: 'corrupt' }; }
}
export async function readRunState(file: string): Promise<RunState> {
  try { return parseRunState(await readFile(file, 'utf8')); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' };
    throw error;
  }
}
export const runIdFor = (model: string, studyKey: string) => `${model}__${studyKey}`.replace(/\//g, '__');
export interface InputManifest { hashes: Record<string, string>; promptVersion: number; harnessCommit: string | null;
  excluded: EvaluationSet['excluded']; emptyGold: EvaluationSet['emptyGold'] }
export function checkManifest(previous: InputManifest, current: InputManifest): void {
  if (previous.promptVersion !== current.promptVersion) throw new Error('プロンプト版数が違います。新しい BENCH_RUN_LABEL を指定してください');
  const keys = [...new Set([...Object.keys(previous.hashes), ...Object.keys(current.hashes)])];
  if (keys.some((key) => previous.hashes[key] !== current.hashes[key])) throw new Error('入力のハッシュが違います。新しい BENCH_RUN_LABEL を指定してください');
  if (JSON.stringify(previous.excluded) !== JSON.stringify(current.excluded)) throw new Error('除外研究が変わりました。新しい BENCH_RUN_LABEL を指定してください');
}
export async function harnessCommit(): Promise<string | null> {
  try { return (await promisify(execFile)('git', ['rev-parse', 'HEAD'], { cwd: repoRoot })).stdout.trim(); }
  catch { return null; /* git の無い配布物も実行可能 */ }
}
export function assertInputHash(tier: Tier, name: string, hash: string): void {
  const prefix = EXPECTED_SHA256_PREFIX[tier][name];
  if (prefix && !hash.startsWith(prefix)) throw new Error(`gold の既定ハッシュ接頭辞と一致しません: ${tier}/${name}`);
}
export async function plannedHashes(set: EvaluationSet, root: string): Promise<Record<string, string>> {
  const hashes = { ...set.hashes, ...requestHashes(set) };
  for (const tier of TIERS) for (const name of Object.keys(EXPECTED_SHA256_PREFIX[tier])) {
    const file = name === 'task3_numeric.jsonl' ? goldFile(root, tier) : path.join(refDir(root, tier), name);
    const hash = await fileHash(file);
    assertInputHash(tier, name, hash);
    hashes[`upstream/${path.relative(root, file).replace(/\\/g, '/')}`] = hash;
  }
  return hashes;
}
export function requestHashes(set: EvaluationSet): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const model of selectedModels()) for (const study of set.studies) {
    const { messages, chatOptions } = buildStudyRequest(study, set.documents.get(study.studyKey)!);
    hashes[`request/${runIdFor(model.id, study.studyKey)}`] = 'keyEnv' in model
      ? sha256(JSON.stringify({ messages, chatOptions }))
      : sha256(JSON.stringify({ messages, chatOptions, codex: { reasoningEffort: codexEffort() } }));
  }
  return hashes;
}
export async function assertManifestPresent(file: string, required: boolean): Promise<InputManifest | null> {
  const previous = await readOptional<InputManifest>(file);
  let existing = false;
  try { existing = (await readdir(path.dirname(file))).some((name) => name === '_ledger.jsonl' || (name.endsWith('.json') && !name.startsWith('_'))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (!previous && (required || existing)) throw new Error('_inputs.json がありません。新しい BENCH_RUN_LABEL を指定してください');
  return previous;
}
export async function inputManifest(set: EvaluationSet, dry: boolean, root: string, required = false): Promise<void> {
  const current: InputManifest = { hashes: await plannedHashes(set, root), promptVersion: EXTRACT_DATA_PROMPT_VERSION,
    harnessCommit: await harnessCommit(), excluded: set.excluded, emptyGold: set.emptyGold };
  const file = path.join(runsDir(), '_inputs.json');
  const previous = await assertManifestPresent(file, required);
  if (previous) checkManifest(previous, current);
  else if (!dry) await writeJson(file, current);
}
