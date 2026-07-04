// ベンチマーク対象論文・モデル・パスの一元管理（IMPLEMENTATION.md §5）
// runner.ts / score.ts / extractText.ts が共有する定数だけを持つ純粋モジュール
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** experiments/extraction-benchmark/ 直下の絶対パス */
export const benchRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
/** リポジトリルートの絶対パス（src/ 配下の本番コードを import するため） */
export const repoRoot = path.resolve(benchRoot, '../..');

/** 対象論文（README.md §6.1）。file は tests/fixtures/pdf/ 配下の実ファイル名 */
export const TARGETS = [
  { pdfId: 'udca', file: 'PMC10715657_plosone_udca_rct.pdf' },
  { pdfId: 'thermocov', file: 'PMC10766786_frontmed_thermocov_rct.pdf' },
] as const;

/**
 * 比較対象モデル（README.md §3）。id はスナップショット ID 確認後に確定値へ差し替える
 * （IMPLEMENTATION.md §11 手順[1]）。keyEnv は createProvider に渡す API キーの
 * 環境変数名で、providerFactory.resolveProviderId（model の `/` 有無）とずれないよう
 * ここで明示的に対応づけておく
 */
export const MODELS = [
  { id: 'gemini-3.5-flash', keyEnv: 'GEMINI_API_KEY' },
  // TODO(実行前に対応。README §3 #2 / §9 承認チェックリスト #2):
  // gemini-3.1-flash-lite は 2026-07-04 時点で src/lib/llm/pricing.ts の MODEL_PRICING に
  // 未収載。正規の単価を確認して pricing.ts へ 1 行追記してから実行すること。
  // 追記を忘れても実行自体は失敗しない（estimateCostUsd が null を返すだけ）が、
  // このモデルの costUsd 集計・コスト上限 $5 監視が欠ける点に注意。
  { id: 'gemini-3.1-flash-lite', keyEnv: 'GEMINI_API_KEY' },
  { id: 'qwen/qwen3-235b-a22b-2507', keyEnv: 'OPENROUTER_API_KEY' },
] as const;

/** 反復回数（README.md §7。temperature 0 でも応答が揺れるため 3 反復をプールする） */
export const REPEATS = 3;
