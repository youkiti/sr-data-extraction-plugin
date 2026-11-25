import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ModelPricing } from '../../../src/lib/llm/pricing';

// extraction-benchmark-real/src/config.ts のルート導出と readSubset を移植。
export const benchRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const repoRoot = path.resolve(benchRoot, '../..');
export const TIERS = ['cc-by', 'cc-by-nc'] as const;
export type Tier = typeof TIERS[number];
export const EVAL_DATA_TYPES = ['dichotomous', 'continuous'] as const;
export const MODELS = [
  { id: 'gemini-3.8-flash', keyEnv: 'GEMINI_API_KEY' },
  { id: 'claude-sonnet-5-5', keyEnv: 'ANTHROPIC_API_KEY' },
  { id: 'claude-haiku-5-5', keyEnv: 'ANTHROPIC_API_KEY' },
] as const;
export const GUARD_PRICING: Readonly<Record<string, ModelPricing>> = {
  'gemini-3.8-flash': { inputPerMillion: 1.5, outputPerMillion: 7.5 },
  'claude-sonnet-5-5': { inputPerMillion: 2, outputPerMillion: 10 },
  // 推定入力が実際より少なく境界を下回る可能性があるため、監視は常に高い段で数える。
  // Haiku の差額は小さいので、上限を過少に数えないことを優先する。
  'claude-haiku-5-5': { inputPerMillion: 0.5, outputPerMillion: 2.5 },
};
// 定価はキャッシュ割引を適用せず、各リクエストの入力トークン数で段を選ぶ。
export const LIST_PRICING: Readonly<Record<string, ModelPricing>> = {
  ...GUARD_PRICING,
  'claude-haiku-5-5': {
    inputPerMillion: 0.1, outputPerMillion: 0.5,
    longContext: { thresholdTokensIn: 100_000, inputPerMillion: 0.5, outputPerMillion: 2.5 },
  },
};
export const REPORT_FALLBACK_PRICING: Readonly<Record<string, ModelPricing>> = {
  'claude-sonnet-5-5': { inputPerMillion: 2, outputPerMillion: 10 },
  // 2026-11-25 公式の料金ページで確認。本番の単価表に無い場合だけ使う。
  'claude-haiku-5-5': {
    inputPerMillion: 0.1, outputPerMillion: 0.5, cachedInputPerMillion: 0.01,
    longContext: { thresholdTokensIn: 100_000, inputPerMillion: 0.5, outputPerMillion: 2.5, cachedInputPerMillion: 0.05 },
  },
};
export const EXPECTED_SHA256_PREFIX: Record<Tier, Record<string, string>> = {
  'cc-by': { 'task3_numeric.jsonl': 'e28acce8f901', 'final.jsonl': '8fa31935d224' },
  'cc-by-nc': { 'task3_numeric.jsonl': 'eb03d74d5d4b' },
};
export const BOOTSTRAP = { replicates: 2000, seed: 20261122 };
export const RUN_LABEL = process.env.BENCH_RUN_LABEL?.trim() || 'a-v1';
if (!/^[A-Za-z0-9_-]+$/.test(RUN_LABEL)) throw new Error('BENCH_RUN_LABEL は英数字・_・- で指定してください');
export const runsDir = () => path.join(benchRoot, 'outputs', `runs-${RUN_LABEL}`);
export const scoresDir = () => path.join(benchRoot, 'outputs', `scores-${RUN_LABEL}`);
export const textLayerDir = () => path.join(benchRoot, 'outputs', 'textlayer');
export const goldLockPath = () => path.join(benchRoot, 'outputs', 'gold-lock.json');

export function cochraneRoot(): string {
  const root = process.env.COCHRANE_BENCH_ROOT?.trim();
  if (!root || !path.isAbsolute(root)) throw new Error('COCHRANE_BENCH_ROOT に既存ディレクトリの絶対パスを指定してください');
  return root;
}
export function readSubset<T extends string>(envName: string, allowed: readonly T[]): readonly T[] {
  const raw = process.env[envName]?.trim();
  if (!raw) return allowed;
  const requested = raw.split(',').map((value) => value.trim()).filter(Boolean);
  const unknown = requested.filter((value) => !allowed.includes(value as T));
  if (unknown.length) throw new Error(`${envName} に未対応の値があります: ${unknown.join(', ')}`);
  return requested as T[];
}
export const selectedModels = () => MODELS.filter((model) => readSubset('BENCH_MODELS', MODELS.map((m) => m.id)).includes(model.id));
export const selectedTiers = () => readSubset('BENCH_TIERS', TIERS);
