import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { EXTRACT_DATA_PROMPT_VERSION } from '../../../src/features/extraction/skills/extractData';
import { repoRoot, runsDir } from './config';
import type { LedgerEntry } from './ledger';
import type { EvaluationSet } from './io';
import { readOptional, writeJson } from './io';

export type RunState = { kind: 'missing' } | { kind: 'corrupt' } |
  { kind: 'parsed'; promptVersion: number; outcome: 'ok' | 'format_error' | 'request_failed' };
// 欠落/履歴なし、確定済み（失敗含む）、破損、欠落/履歴あり、版数違いの全状態を扱う。
export function resumeDecision(state: RunState, ledger: readonly LedgerEntry[], version: number): 'execute' | 'backup_execute' | 'skip' {
  void ledger; // 欠落時の過去費用は台帳に残し、再開判断の試行上限には使わない。
  if (state.kind === 'missing') return 'execute';
  if (state.kind === 'corrupt') return 'backup_execute';
  if (state.promptVersion !== version) throw new Error('プロンプト版数が違います。新しい BENCH_RUN_LABEL を指定してください');
  return 'skip';
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
export async function inputManifest(set: EvaluationSet, dry: boolean): Promise<void> {
  const current: InputManifest = { hashes: set.hashes, promptVersion: EXTRACT_DATA_PROMPT_VERSION,
    harnessCommit: await harnessCommit(), excluded: set.excluded, emptyGold: set.emptyGold };
  const file = path.join(runsDir(), '_inputs.json');
  const previous = await readOptional<InputManifest>(file);
  if (previous) checkManifest(previous, current);
  else if (!dry) await writeJson(file, current);
}
