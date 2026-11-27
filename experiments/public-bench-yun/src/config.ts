import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSubset } from '../../cochrane-numeric-benchmark/src/config';
export { codexEffort, codexConcurrency, codexTimeoutMs } from '../../cochrane-numeric-benchmark/src/config';

export const MODELS = [
  { id: 'gemini-3.8-flash', keyEnv: 'GEMINI_API_KEY' },
  { id: 'claude-haiku-5-5', keyEnv: 'ANTHROPIC_API_KEY' },
  { id: 'gpt-6.2-sol', route: 'codex' },
] as const;
export type Condition = 'md' | 'pdf';
export const selectedModels = () => MODELS.filter((model) => process.env.BENCH_MODELS?.trim()
  ? readSubset('BENCH_MODELS', MODELS.map((m) => m.id)).includes(model.id) : 'keyEnv' in model);
export function condition(env = process.env): Condition {
  if (env.BENCH_CONDITION !== 'md' && env.BENCH_CONDITION !== 'pdf') throw new Error('BENCH_CONDITION は md / pdf の指定が必須です');
  return env.BENCH_CONDITION;
}
export function runLabel(env = process.env): string {
  const label = env.BENCH_RUN_LABEL ?? '';
  if (!/^[A-Za-z0-9_-]+$/.test(label)) throw new Error('BENCH_RUN_LABEL は英数字・_・- で指定してください');
  return label;
}
function absolute(name: string, env: NodeJS.ProcessEnv): string {
  const value = env[name];
  if (!value || !path.isAbsolute(value)) throw new Error(`${name} に絶対パスを指定してください`);
  return path.resolve(value);
}
export const yunRoot = (env = process.env) => absolute('YUN_ROOT', env);
export function outputRoot(env = process.env): string {
  const root = absolute('PUBLIC_BENCH_OUT', env);
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const relative = path.relative(repo, root);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new Error('PUBLIC_BENCH_OUT は git ツリーの外に指定してください');
  }
  return root;
}
export const runsDir = () => path.join(outputRoot(), `runs-${runLabel()}`);
export function selectedPmcids(allowed: number[], raw = process.env.BENCH_PMCIDS): number[] {
  if (raw === undefined) return allowed;
  const parts = raw.split(',').map((s) => s.trim());
  if (parts.some((s) => !/^\d+$/.test(s) || !Number.isSafeInteger(Number(s)))) throw new Error('BENCH_PMCIDS は整数のカンマ区切りで指定してください');
  const ids = parts.map(Number);
  if (ids.some((id) => !allowed.includes(id))) throw new Error('BENCH_PMCIDS に未知の PMCID があります');
  return ids;
}
