// 定数の一元管理（既存 extraction-benchmark/config.ts に対応。不眠 dataset1 単体）。
import path from 'node:path';
import { loadLocalConfig } from './localConfig';
import { fileURLToPath } from 'node:url';
import type { ModelPricing } from '../../../src/lib/llm/pricing';

/** extraction-benchmark-real/ の絶対パス（src/config.ts の 2 つ上） */
export const benchRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
/** リポジトリルート（本番 src/ の相対 import 解決に使う。既存ベンチと同一深さ） */
export const repoRoot = path.resolve(benchRoot, '../..');

/** 対象論文の順序とファイル名は非公開のローカル設定で管理する。 */
export const TARGETS: ReadonlyArray<{ pdfId: string; file: string }> = loadLocalConfig().targets;

/** 比較対象モデル（実行は API 課金・要承認)。モデル ID は固定文字列（-latest 等のエイリアスは使わない）。 */
export const MODELS = [
  { id: 'gemini-3.5-flash', keyEnv: 'GEMINI_API_KEY' },
  { id: 'gemini-3.1-flash-lite', keyEnv: 'GEMINI_API_KEY' },
  { id: 'gemini-3.8-flash', keyEnv: 'GEMINI_API_KEY' },
  { id: 'gemini-3.5-flash-lite', keyEnv: 'GEMINI_API_KEY' },
  // qwen は初回ベンチ（2026-07-06 REPORT.md）で「低精度 + 1 コール 2〜33 分 + truncation 2/10 = 非実用」と
  // 結論済みのため既定から除外（必要ならコメント解除）
  // { id: 'qwen/qwen3-235b-a22b-2507', keyEnv: 'OPENROUTER_API_KEY' },
] as const;

/**
 * ベンチ側の補助単価表。本番 src/lib/llm/pricing.ts の MODEL_PRICING に無いモデルだけ使う
 * （costGuard.billedCostUsd が「本番の単価表にキーがあるか」で判定し、無ければこちらを見る）。
 * gemini-3.8-flash: 2026-09-21 に ai.google.dev/gemini-api/docs/pricing で確認。2026-12-31 までは
 * 入力 $0.75 / 出力 $3.75、2027-01-01 から $1.50 / $7.50。上限の見張りを過小にしないため高いほうで数える。
 * 本番の単価表に入ったらこの行は使われなくなる。
 */
export const FALLBACK_PRICING: Readonly<Record<string, ModelPricing>> = {
  'gemini-3.8-flash': { inputPerMillion: 1.5, outputPerMillion: 7.5 },
};

/** issue #176 の比較軸として導入。過去の run 記録（v4〜v6）と metrics.test.ts が両方の値を使うため型は残す。 */
export const INPUT_MODES = ['text_only', 'text_with_page_images'] as const;
export type BenchmarkInputMode = (typeof INPUT_MODES)[number];

function readSubset<T extends string>(
  envName: string,
  allowed: readonly T[],
): readonly T[] {
  const raw = process.env[envName]?.trim();
  if (raw === undefined || raw === '') return allowed;
  const requested = raw.split(',').map((value) => value.trim()).filter(Boolean);
  const unknown = requested.filter((value) => !allowed.includes(value as T));
  if (unknown.length > 0) {
    throw new Error(`${envName} に未対応の値があります: ${unknown.join(', ')}`);
  }
  return requested as T[];
}

/** BENCH_TARGETS にローカル設定の pdfId をカンマ区切りで指定して対象を限定する。 */
export function selectedTargets(): typeof TARGETS {
  const ids = readSubset('BENCH_TARGETS', TARGETS.map((target) => target.pdfId));
  return TARGETS.filter((target) => ids.includes(target.pdfId));
}

/** BENCH_MODELS=gemini-3.5-flash,gemini-3.1-flash-lite で比較対象モデルを限定する。 */
export function selectedModels(): typeof MODELS[number][] {
  const ids = readSubset('BENCH_MODELS', MODELS.map((model) => model.id));
  return MODELS.filter((model) => ids.includes(model.id));
}

/**
 * 反復回数。2026-09-21 ユーザー判断で各モデル 1 反復。反復間ばらつきを見るなら 3 に上げる。
 * 費用は usageMetadata の candidates + thoughts で数え、上限は BENCH_COST_LIMIT_USD。
 * 本番 tokensOut は途中から思考込みになったため計算に使わず、古い記録は採点時に数え直す。
 */
export const REPEATS = 1;

/** 実行ラベル。run/score の出力先ディレクトリ名に使う（過去の run と混ざらないよう版数を刻む）。 */
export const RUN_LABEL = process.env.BENCH_RUN_LABEL?.trim() || 'v9-20260921';

/** run JSON の出力先（{runId}.json とコストレジャ _cost-ledger.jsonl を置く）。 */
export function runsDir(): string {
  return path.join(benchRoot, 'outputs', `runs-${RUN_LABEL}`);
}

/** 採点結果の出力先。BENCH_SCORES_DIR（絶対パス）があればそちらを優先する。 */
export function scoresDir(): string {
  const override = process.env.BENCH_SCORES_DIR?.trim();
  if (override !== undefined && override !== '') return override;
  return path.join(benchRoot, 'outputs', `scores-${RUN_LABEL}`);
}
