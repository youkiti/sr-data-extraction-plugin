// Config に応じて LLMProvider のインスタンスを返すファクトリ
// （sr-query-builder の lib/llm/providerFactory.ts を流用。本拡張向けの調整 2 点）:
// - 既定モデルは抽出精度ベンチマークで確定するまで固定しない（requirements.md Q8）ため
//   model は必須（移植元の DEFAULT_MODEL フォールバックを持たない）
// - OpenRouter は P1（requirements.md §7）。プロバイダ解決だけ先行し、生成は未対応エラー
import type { LlmProviderId } from '../../domain/llmApiLog';
import { GeminiProvider } from './GeminiProvider';
import type { LLMProvider } from './LLMProvider';

export interface ProviderConfig {
  /** 省略時は model から自動解決 */
  provider?: LlmProviderId;
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
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
  if (provider === 'openrouter') {
    throw new Error('OpenRouter プロバイダは P1 で対応予定です（MVP は Gemini のみ）');
  }
  return new GeminiProvider({
    apiKey: config.apiKey,
    model: config.model,
    fetch: config.fetch,
  });
}
