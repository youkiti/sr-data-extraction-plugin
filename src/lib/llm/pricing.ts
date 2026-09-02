/**
 * LLM のモデル別単価表と概算コスト計算（sr-query-builder の lib/llm/pricing.ts を流用）。
 * 実行前は planRun のトークン概算 → ExtractionRuns.cost_estimate（S7 のコスト表示）、
 * 実行後は実測 tokens_in / tokens_out → LLMApiLog.cost_estimate_usd を埋める。
 */
import type { LlmProviderId } from '../../domain/llmApiLog';

/** 入力・出力それぞれの USD / 100 万トークン単価 */
export interface ModelPricing {
  /** 入力 1M トークンあたりの USD */
  inputPerMillion: number;
  /** 出力 1M トークンあたりの USD */
  outputPerMillion: number;
  /**
   * プロンプトキャッシュから読まれた入力 1M トークンあたりの USD（省略可）。
   *
   * **省略時は入力単価と同額で概算する**（= 割引を見込まない安全側）。単価が分かって
   * いないモデルで勝手に割り引くとコストを過小表示することになり、automation bias 対策の
   * 「利用者に楽観的な数字を見せない」方針と衝突するため、既定を割引なしに倒している。
   */
  cachedInputPerMillion?: number;
}

/**
 * モデル名 → 単価の対応表。
 * 価格改定時に要更新。未知のモデルは表に載せず、cost_estimate_usd は null のままにする。
 *
 * 確認日はモデル群ごとに異なる（行ごとのコメント参照）。2026-08-31 の一斉再確認では、
 * **Anthropic 3 モデルだけ公式料金ページに到達できた**。Gemini（ai.google.dev）と
 * OpenRouter（openrouter.ai）は組織の egress ポリシーで 403 拒否され、公式ページでの
 * 突き合わせができていない。Gemini 4 モデルは代わりに tiab-review-plugin の実験記録
 * （experiments 配下の gemini 各モデルの config.json・gemini-prompt-cache/report.md）と
 * 一致を確認した。未確認のまま残っている行は下記の該当コメントで明示する。
 */
export const MODEL_PRICING: Readonly<Record<string, ModelPricing>> = {
  // Gemini 2.5 Pro: 入力 $1.25 / 出力 $10.00（per 1M tokens）
  // cachedInputPerMillion は未設定（2026-08-31 の再確認で ai.google.dev へ到達できず、
  // このモデルのキャッシュ単価を確認できなかった。既定どおり割引なしで概算する）
  'gemini-2.5-pro': { inputPerMillion: 1.25, outputPerMillion: 10.0 },
  // 以下は 2026-06 時点の概算価格。実際の単価は各プロバイダの料金ページで確認すること。
  // gemini-2.0-flash は無料枠ではコスト 0 だが、従量課金枠での参考単価を記載する。
  // **未確認（2026-08-31）**: 単価に加え、モデル自体が提供終了になっている可能性がある
  // という調査結果が出ているが、公式の deprecation ページへ到達できず裏が取れていない。
  // remaining-work-plan.md の実 API 確認項目で決着させる。
  'gemini-2.0-flash': { inputPerMillion: 0.1, outputPerMillion: 0.4 },
  // 以下 3 モデルは抽出精度ベンチマーク（Q8）の比較対象。単価は各公式ページで 2026-07-05 に確認・更新。
  // gemini-3.1-flash-lite の入力はテキスト/画像/動画レート（音声は $0.50）。ベンチマークは text_only。
  // cachedInputPerMillion は入力単価の 0.10 倍（= 90% 割引）。tiab-review-plugin の
  // experiments/gemini-prompt-cache/report.md §3.4 が 2026-09-01 に料金ページで確認した表
  // （gemini-3.5-flash のキャッシュ入力 $0.15 等）が根拠で、3 モデルとも 0.10 倍だった。
  // 3.6-flash / 3.5-flash-lite は同倍率を当てはめた導出値（個別の確認は取れていない）。
  'gemini-3.5-flash': { inputPerMillion: 1.5, outputPerMillion: 9.0, cachedInputPerMillion: 0.15 },
  'gemini-3.1-flash-lite': { inputPerMillion: 0.25, outputPerMillion: 1.5, cachedInputPerMillion: 0.025 },
  // 2026-07-22 追加。Gemini 3.6 Flash / gemini-3.5-flash-lite（公式料金ページで確認・更新）。
  'gemini-3.6-flash': { inputPerMillion: 1.5, outputPerMillion: 7.5, cachedInputPerMillion: 0.15 },
  'gemini-3.5-flash-lite': { inputPerMillion: 0.3, outputPerMillion: 2.5, cachedInputPerMillion: 0.03 },
  // **要再確認（2026-08-31）**: OpenRouter 経由の 2 モデルは openrouter.ai へ到達できず
  // 突き合わせができていない。第三者が取得したエンドポイント別単価のダンプ（2026-08-02）では
  // qwen の出力が最安プロバイダでも 0.55 で、下記の 0.1 はどのエンドポイントとも一致しない
  // （= 過小表示の疑いが濃い）。ただし代わりに置ける確かな値が無いため**推測で書き換えず**
  // 現状値を残す。OpenRouter はマルチプロバイダで単価がレンジを持ち、既定ルーティングは
  // 最安固定ではないため、確認時は「どの値を採るか（最安 / 中央値）」も併せて決めること。
  // remaining-work-plan.md の実 API 確認項目に計上済み。
  'qwen/qwen3-235b-a22b-2507': { inputPerMillion: 0.09, outputPerMillion: 0.1 },
  'deepseek/deepseek-v4-flash': { inputPerMillion: 0.07, outputPerMillion: 0.14 },
  // Anthropic 3 モデル。issue #127 PR2 で Options 配線とあわせて追加。
  // **2026-08-31 に公式料金ページで再確認**（https://platform.claude.com/docs/en/about-claude/pricing）:
  // claude-sonnet-5 の $2/$10 は「2026-08-31 までの導入価格」ではなく**標準価格として恒久化**され、
  // 予定されていた $3/$15 への改定は行われないと明記された。旧コメントは「導入価格の期限切れで
  // 過小表示になるのを避けるため通常価格 $3/$15 を採る」という判断だったが、その前提が失効し、
  // 逆に 1.5 倍の過大表示になっていたため実価格へ修正した。
  // キャッシュ read は 3 モデルとも入力単価の 0.1 倍（同ページの Prompt caching 表）。
  // cache write（5 分 TTL で 1.25 倍）は現状この拡張が cache_control を送らないため発生しない。
  // claude-haiku-4-5 のみコンテキスト長 200K（他の 2 モデルは 1M）
  'claude-opus-5': { inputPerMillion: 5.0, outputPerMillion: 25.0, cachedInputPerMillion: 0.5 },
  'claude-sonnet-5': { inputPerMillion: 2.0, outputPerMillion: 10.0, cachedInputPerMillion: 0.2 },
  'claude-haiku-4-5': { inputPerMillion: 1.0, outputPerMillion: 5.0, cachedInputPerMillion: 0.1 },
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
 *
 * `cachedTokensIn`（`ChatResponse.cachedTokensIn`）を渡すと、その分を入力単価ではなく
 * キャッシュ単価で積む。`tokensIn` はキャッシュ分を**含む総入力**という契約なので
 * （`ChatResponse.tokensIn` の JSDoc 参照）、キャッシュ分を差し引いた残りが満額課金される:
 *
 *   (tokensIn - cachedTokensIn) × 入力単価 + cachedTokensIn × キャッシュ単価 + tokensOut × 出力単価
 *
 * 省略・null のときは従来どおり `tokensIn` 全量を入力単価で積む（＝この引数を渡さない
 * 既存の呼び出しは 1 セントも結果が変わらない）。キャッシュが効いている呼び出しで
 * 渡さないと、実費の数倍を表示することになる点に注意。
 */
export function estimateCostUsd(
  model: string,
  tokensIn: number | null,
  tokensOut: number | null,
  cachedTokensIn: number | null = null,
): number | null {
  const pricing = MODEL_PRICING[model];
  if (pricing === undefined) {
    return null;
  }
  if (tokensIn === null && tokensOut === null) {
    return null;
  }
  const totalIn = tokensIn ?? 0;
  // キャッシュ分が総入力を超えるのは契約違反（provider 側の異常値）だが、負のコストを
  // 表示するよりは割引を諦めるほうが安全なので総入力で頭打ちにする
  const cachedIn = Math.min(Math.max(cachedTokensIn ?? 0, 0), totalIn);
  // キャッシュ単価が分かっていないモデルは入力単価で積む（割引を見込まない安全側）
  const cachedRate = pricing.cachedInputPerMillion ?? pricing.inputPerMillion;
  const inputCost = ((totalIn - cachedIn) / 1_000_000) * pricing.inputPerMillion;
  const cachedCost = (cachedIn / 1_000_000) * cachedRate;
  const outputCost = ((tokensOut ?? 0) / 1_000_000) * pricing.outputPerMillion;
  return inputCost + cachedCost + outputCost;
}

/** モデル単位の画像入力対応可否（画像非対応モデルの実行ブロック）の 3 値 */
export type ImageInputSupport = 'supported' | 'unsupported' | 'unknown';

interface ModelImageCapability {
  /**
   * この能力を実測した provider。`resolveModelImageInputSupport` は provider が一致した
   * ときだけ support を返す（接続方式 override で同じモデル名を別 provider 経由に
   * 送った場合は実測が無いため `unknown` に倒す。実測が無いのに断定しないための設計）
   */
  provider: LlmProviderId;
  support: Exclude<ImageInputSupport, 'unknown'>;
}

/**
 * モデル単位の画像入力対応表。`MODEL_PRICING` の全モデルに明示エントリを持たせる
 * （`gemini-*` のような前方一致は広すぎるため使わない。カタログ外のモデルは
 * `resolveModelImageInputSupport` が `unknown` を返す。新モデル追加時の更新漏れは
 * pricing.test.ts のカタログ全件チェックで検出する）。
 * - Gemini 系はネイティブ画像入力に対応（`supported`）
 * - `qwen/qwen3-235b-a22b-2507` / `deepseek/deepseek-v4-flash` は OpenRouter 経由で
 *   `HTTP 404 No endpoints found that support image input` を実測済み（`unsupported`）
 */
export const MODEL_IMAGE_CAPABILITY: Readonly<Record<string, ModelImageCapability>> = {
  'gemini-2.5-pro': { provider: 'gemini', support: 'supported' },
  'gemini-2.0-flash': { provider: 'gemini', support: 'supported' },
  'gemini-3.5-flash': { provider: 'gemini', support: 'supported' },
  'gemini-3.1-flash-lite': { provider: 'gemini', support: 'supported' },
  'gemini-3.6-flash': { provider: 'gemini', support: 'supported' },
  'gemini-3.5-flash-lite': { provider: 'gemini', support: 'supported' },
  'qwen/qwen3-235b-a22b-2507': { provider: 'openrouter', support: 'unsupported' },
  'deepseek/deepseek-v4-flash': { provider: 'openrouter', support: 'unsupported' },
  // Anthropic 3 モデルはネイティブ base64 画像入力に対応（docs/requirements.md §10 Q11）
  'claude-opus-5': { provider: 'anthropic', support: 'supported' },
  'claude-sonnet-5': { provider: 'anthropic', support: 'supported' },
  'claude-haiku-4-5': { provider: 'anthropic', support: 'supported' },
};

/**
 * モデル単位の画像入力対応可否を解決する。
 * 入力に `provider` と `model` の両方を要求するのは、`providerFactory.resolveProviderConfig` が
 * 保存済みの接続方式でモデル名からの provider 推定を上書きできるため
 * （同じモデル名でも Gemini 直結 / OpenRouter / ローカル OpenAI 互換で実際の能力が異なりうる）。
 * カタログの実測 provider と一致しないとき（override で別 provider に送った場合を含む）は
 * 実測が無いため `unknown` を返す
 */
export function resolveModelImageInputSupport(
  provider: LlmProviderId,
  model: string,
): ImageInputSupport {
  const entry = MODEL_IMAGE_CAPABILITY[model];
  if (entry === undefined || entry.provider !== provider) {
    return 'unknown';
  }
  return entry.support;
}
