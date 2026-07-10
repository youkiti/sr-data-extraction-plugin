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
