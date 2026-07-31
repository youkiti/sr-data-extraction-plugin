// Config に応じて LLMProvider のインスタンスを返すファクトリ
// （sr-query-builder の lib/llm/providerFactory.ts を流用。本拡張向けの調整）:
// - 既定モデルは抽出精度ベンチマークで確定するまで固定しない（requirements.md Q8）ため
//   model は必須（移植元の DEFAULT_MODEL フォールバックを持たない）
import type { LlmProviderId } from '../../domain/llmApiLog';
import {
  isLoopbackEndpoint,
  requiresFullUrlEndpoint,
  resolveStoredEndpoint,
  type LlmConnectionSettings,
} from '../storage/settingsStore';
import { AnthropicProvider } from './AnthropicProvider';
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
 * `/` を含む（OpenRouter の `org/model` 形式。OpenRouter 経由の `anthropic/claude-...` も
 * この形なので `/` 判定を最優先する）なら openrouter、次に `claude-` 始まり（Anthropic
 * ネイティブのモデル ID）なら anthropic、それ以外は gemini
 */
export function resolveProviderId(modelId: string): LlmProviderId {
  if (modelId.includes('/')) {
    return 'openrouter';
  }
  if (modelId.startsWith('claude-')) {
    return 'anthropic';
  }
  return 'gemini';
}

/**
 * 選択中の対象に画像入力が必要な文書（`textStatus === 'no_text_layer'`）が含まれ、かつ選択中
 * モデルが画像入力に非対応と判明している（`unsupported`）ときだけ実行をブロックする
 * （画像非対応モデルの実行ブロック）。'unknown'（カタログに実測が無い）はブロックしない
 * （過検出で正当な run まで止めないため。実測済みの qwen3-235b / deepseek-v4-flash 等だけが対象）。
 * `providerOverride`（保存済み接続方式。null 可）を渡すとモデル名推定（`resolveProviderId`）より
 * 優先する。UI 描画時（起動時に 1 回読み込んだ `state.llmProviderOverride` を渡す）・
 * サービス層の実行直前（`resolveProviderConfig` の解決結果を渡す。defense in depth）の
 * どちらもこの引数で同じ判定を共有する。省略時（null）は従来どおりモデル名推定にフォールバックする
 */
export function isRunBlockedByImageUnsupportedModel(
  model: string,
  hasImageInputDocuments: boolean,
  providerOverride: LlmProviderId | null = null,
): boolean {
  if (!hasImageInputDocuments || model === '') {
    return false;
  }
  return (
    resolveModelImageInputSupport(providerOverride ?? resolveProviderId(model), model) ===
    'unsupported'
  );
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
  if (provider === 'anthropic') {
    return new AnthropicProvider({
      apiKey: config.apiKey,
      model: config.model,
      fetch: config.fetch,
    });
  }
  if (provider === 'azure_openai') {
    if (config.endpoint === undefined) {
      throw new Error('Azure OpenAI のエンドポイントが未設定です');
    }
    // OpenAICompatibleProvider を認証方式（api-key ヘッダー）だけ切り替えて流用する
    // （新規 provider クラスは作らない。requirements.md §10 Q11・issue #127 PR3）
    return new OpenAICompatibleProvider({
      apiKey: config.apiKey,
      model: config.model,
      endpoint: config.endpoint,
      fetch: config.fetch,
      authMode: 'azure_api_key',
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
    : { provider: null, openAiCompatibleEndpoint: null, azureOpenAiEndpoint: null };
  const provider = settings.provider ?? resolveProviderId(model);
  const apiKey = await deps.loadApiKey(provider);
  const endpoint = requiresFullUrlEndpoint(provider) ? resolveStoredEndpoint(settings, provider) : null;
  // loopback HTTP のキー任意許可は OpenAI 互換 API 限定（requirements.md §2.1 の loopback 実験用途）。
  // Azure OpenAI は常にキー必須のため、loopback URL を入力しても空キーを許可しない
  // （issue #127 PR3。ui-states.md §2「Azure OpenAI 選択時」）
  const allowsEmptyApiKey =
    provider === 'openai_compatible' && endpoint !== null && isLoopbackEndpoint(endpoint);
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
