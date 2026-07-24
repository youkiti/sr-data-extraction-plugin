// Config に応じて LLMProvider のインスタンスを返すファクトリ
// （sr-query-builder の lib/llm/providerFactory.ts を流用。本拡張向けの調整）:
// - 既定モデルは抽出精度ベンチマークで確定するまで固定しない（requirements.md Q8）ため
//   model は必須（移植元の DEFAULT_MODEL フォールバックを持たない）
import type { LlmProviderId } from '../../domain/llmApiLog';
import {
  isLoopbackEndpoint,
  type LlmConnectionSettings,
} from '../storage/settingsStore';
import { GeminiProvider } from './GeminiProvider';
import type { LLMProvider } from './LLMProvider';
import { OpenAICompatibleProvider } from './OpenAICompatibleProvider';
import { OpenRouterProvider } from './OpenRouterProvider';
import { resolveModelImageInputSupport } from './pricing';

export interface ProviderConfig {
  /** 省略時は model から自動解決 */
  provider?: LlmProviderId;
  apiKey: string;
  model: string;
  /** provider = openai_compatible の完全な Chat Completions URL */
  endpoint?: string;
  fetch?: typeof fetch;
}

export interface ProviderResolutionDeps {
  loadApiKey: (provider: LlmProviderId) => Promise<string | null>;
  /** 未注入は既存環境としてモデル ID による従来判定を使う */
  loadLlmConnectionSettings?: () => Promise<LlmConnectionSettings>;
}

export interface ProviderResolution {
  provider: LlmProviderId;
  /** null は選択した接続方式で必須の API キーが未設定。loopback HTTP は空キーを許可する */
  config: ProviderConfig | null;
}

/**
 * モデル ID からプロバイダを解決する。
 * `/` を含む（OpenRouter の `org/model` 形式）なら openrouter、それ以外は gemini
 */
export function resolveProviderId(modelId: string): LlmProviderId {
  return modelId.includes('/') ? 'openrouter' : 'gemini';
}

/**
 * プロバイダ単位の画像入力対応可否（issue #176: 高精度読み取りモードの UI ガード用）。
 * 各 `LLMProvider` 実装の `supportsImageInput` は provider ごとの静的なフラグ（モデルには依らない）
 * のため、実際にインスタンス化しなくても引ける静的写像として持つ（apiKey 未確定な UI 描画時にも
 * 呼べるようにするため）。現状 3 プロバイダとも true（OpenRouter / OpenAI 互換は image_url を
 * パススルーするだけ）。**モデル単位の対応可否**は `resolveModelImageInputSupport`
 * （lib/llm/pricing.ts の `MODEL_IMAGE_CAPABILITY`）が既知のモデルぶんだけ判定する
 * （実測 404 の qwen3-235b / deepseek-v4-flash 等。それ以外はカタログ外 = `unknown` のままで、
 * 非対応モデルを選んだ場合は実行時に LlmProviderError（4xx）として executeRun の
 * `api_error` ハンドリングに落ちる）
 */
const PROVIDER_IMAGE_INPUT_SUPPORT: Readonly<Record<LlmProviderId, boolean>> = {
  gemini: true,
  openrouter: true,
  openai_compatible: true,
};

export function providerSupportsImageInput(providerId: LlmProviderId): boolean {
  return PROVIDER_IMAGE_INPUT_SUPPORT[providerId];
}

/**
 * 高精度読み取りモード（issue #176）の「実際に効かせてよいか」を 1 か所で判定する。
 * requested（チェックボックスの状態）が true でも、選択中モデルのプロバイダが画像入力に
 * 対応しない（`providerSupportsImageInput` が false）ならモードは効かせない。
 * さらにモデル単位で既知の非対応（`resolveModelImageInputSupport` が `unsupported` を返す。
 * 画像非対応モデルの実行ブロック）と判明している場合も効かせない。'unknown'（カタログ外）は
 * 実測が無いため requested をそのまま尊重する（過検出を避ける）。
 * UI（disabled 表示）・コスト概算（planRun への注入値）・実行（runExtraction への注入値）の
 * 3 箇所すべてがこの関数で判定を揃えることで、「見た目は有効なのに実行時だけ無効化される」
 * 食い違いを防ぐ（model が空文字のときは provider を確定できないため requested をそのまま通す —
 * この場合はどのみち後続のモデル未選択チェックで実行がブロックされる）
 */
export function resolveEffectiveHighAccuracyImages(model: string, requested: boolean): boolean {
  if (!requested || model === '') {
    return requested;
  }
  const provider = resolveProviderId(model);
  // モデル単位で既知の非対応（画像非対応モデルの実行ブロック）を先に見る。
  // 現行 3 プロバイダは providerSupportsImageInput が常に true を返すため、この if を
  // 経由しない残りの経路（下の return）はプロバイダ単位の判定を素通しするだけの
  // 従来どおりの分岐なし expression に保つ（非対応プロバイダを模擬しないと踏めない分岐を
  // 増やさないため）
  if (resolveModelImageInputSupport(provider, model) === 'unsupported') {
    return false;
  }
  return providerSupportsImageInput(provider);
}

/**
 * 選択中の対象に画像入力が必要な文書（`textStatus === 'no_text_layer'`）が含まれ、かつ選択中
 * モデルが画像入力に非対応と判明している（`unsupported`）ときだけ実行をブロックする
 * （画像非対応モデルの実行ブロック）。'unknown'（カタログに実測が無い）はブロックしない
 * （過検出で正当な run まで止めないため。実測済みの qwen3-235b / deepseek-v4-flash 等だけが対象）。
 * ここは UI 描画時に同期で判定する必要があるため、実際の接続方式 override
 * （`resolveProviderConfig`）ではなく既定のモデル名からの provider 推定（`resolveProviderId`）を
 * 使う。override を反映した厳密な判定は実行直前（extractService.ts が resolveProviderConfig の
 * 解決結果で行う。defense in depth）
 */
export function isRunBlockedByImageUnsupportedModel(
  model: string,
  hasImageInputDocuments: boolean,
): boolean {
  if (!hasImageInputDocuments || model === '') {
    return false;
  }
  return resolveModelImageInputSupport(resolveProviderId(model), model) === 'unsupported';
}

export function createProvider(config: ProviderConfig): LLMProvider {
  const provider = config.provider ?? resolveProviderId(config.model);
  if (provider === 'openai_compatible') {
    if (config.endpoint === undefined) {
      throw new Error('OpenAI 互換 API のエンドポイントが未設定です');
    }
    return new OpenAICompatibleProvider({
      apiKey: config.apiKey,
      model: config.model,
      endpoint: config.endpoint,
      fetch: config.fetch,
    });
  }
  if (provider === 'openrouter') {
    return new OpenRouterProvider({
      apiKey: config.apiKey,
      model: config.model,
      fetch: config.fetch,
    });
  }
  return new GeminiProvider({
    apiKey: config.apiKey,
    model: config.model,
    fetch: config.fetch,
  });
}

/** 保存済み接続方式をモデル ID より優先し、実行 1 回ぶんの provider 設定を解決する */
export async function resolveProviderConfig(
  model: string,
  deps: ProviderResolutionDeps,
): Promise<ProviderResolution> {
  const settings = deps.loadLlmConnectionSettings
    ? await deps.loadLlmConnectionSettings()
    : { provider: null, openAiCompatibleEndpoint: null };
  const provider = settings.provider ?? resolveProviderId(model);
  const apiKey = await deps.loadApiKey(provider);
  const endpoint =
    provider === 'openai_compatible' ? settings.openAiCompatibleEndpoint : null;
  const allowsEmptyApiKey = endpoint !== null && isLoopbackEndpoint(endpoint);
  return {
    provider,
    config:
      apiKey === null && !allowsEmptyApiKey
        ? null
        : {
            provider,
            apiKey: apiKey ?? '',
            model,
            ...(endpoint !== null ? { endpoint } : {}),
          },
  };
}
