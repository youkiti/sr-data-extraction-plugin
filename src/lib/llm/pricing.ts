/**
 * LLM のモデル別単価表と概算コスト計算（sr-query-builder の lib/llm/pricing.ts を流用）。
 * 実行前は planRun のトークン概算 → ExtractionRuns.cost_estimate（S7 のコスト表示）、
 * 実行後は実測 tokens_in / tokens_out → LLMApiLog.cost_estimate_usd を埋める。
 */

/** 入力・出力それぞれの USD / 100 万トークン単価 */
export interface ModelPricing {
  /** 入力 1M トークンあたりの USD */
  inputPerMillion: number;
  /** 出力 1M トークンあたりの USD */
  outputPerMillion: number;
}

/**
 * モデル名 → 単価の対応表。
 * 2026-06 時点の概算。価格改定時に要更新。
 * 未知のモデルは表に載せず、cost_estimate_usd は null のままにする。
 */
export const MODEL_PRICING: Readonly<Record<string, ModelPricing>> = {
  // Gemini 2.5 Pro: 入力 $1.25 / 出力 $10.00（per 1M tokens）
  'gemini-2.5-pro': { inputPerMillion: 1.25, outputPerMillion: 10.0 },
  // 以下は 2026-06 時点の概算価格。実際の単価は各プロバイダの料金ページで確認すること。
  // gemini-2.0-flash は無料枠ではコスト 0 だが、従量課金枠での参考単価を記載する。
  'gemini-2.0-flash': { inputPerMillion: 0.1, outputPerMillion: 0.4 },
  // 以下 3 モデルは抽出精度ベンチマーク（Q8）の比較対象。単価は各公式ページで 2026-07-05 に確認・更新。
  // gemini-3.1-flash-lite の入力はテキスト/画像/動画レート（音声は $0.50）。ベンチマークは text_only。
  'gemini-3.5-flash': { inputPerMillion: 1.5, outputPerMillion: 9.0 },
  'gemini-3.1-flash-lite': { inputPerMillion: 0.25, outputPerMillion: 1.5 },
  'qwen/qwen3-235b-a22b-2507': { inputPerMillion: 0.09, outputPerMillion: 0.1 },
  'deepseek/deepseek-v4-flash': { inputPerMillion: 0.07, outputPerMillion: 0.14 },
};

/**
 * ページ画像 1 枚あたりの入力トークン概算（pdf_native / no_text_layer 文書のページ画像添付。
 * handoff-scanned-pdf-native-highlight.md §7.4 PR2）。
 * スパイク実測（experiments/multimodal-bbox-spike/REPORT.md）で 1,000〜1,100 tokens/ページだった
 * うち保守的に高めの側を採用する。
 */
export const APPROX_IMAGE_TOKENS_PER_PAGE = 1_100;

/**
 * tokens_in / tokens_out からモデル単価で概算コスト（USD）を計算する。
 * - 単価表に無いモデル、またはトークン数が両方とも null の場合は null を返す。
 * - 片方のトークン数だけ取れている場合は、取れている側のみで概算する。
 */
export function estimateCostUsd(
  model: string,
  tokensIn: number | null,
  tokensOut: number | null,
): number | null {
  const pricing = MODEL_PRICING[model];
  if (pricing === undefined) {
    return null;
  }
  if (tokensIn === null && tokensOut === null) {
    return null;
  }
  const inputCost = ((tokensIn ?? 0) / 1_000_000) * pricing.inputPerMillion;
  const outputCost = ((tokensOut ?? 0) / 1_000_000) * pricing.outputPerMillion;
  return inputCost + outputCost;
}
