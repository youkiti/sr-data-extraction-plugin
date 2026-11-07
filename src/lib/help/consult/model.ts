// 登録済みのクラウド接続から、相談用の安価な固定モデルを選ぶ。
import type { LlmProviderId } from '../../../domain/llmApiLog';
import { resolveProviderId, type ProviderResolutionDeps } from '../../llm/providerFactory';
import { FACTORY_DEFAULT_MODEL } from '../../storage/settingsStore';

export const CONSULT_MODELS = {
  gemini: 'gemini-3.1-flash-lite',
  anthropic: 'claude-haiku-4-5',
  openrouter: 'deepseek/deepseek-v4-flash',
} as const;
export type ConsultProviderId = keyof typeof CONSULT_MODELS;
const PROVIDERS = Object.keys(CONSULT_MODELS) as ConsultProviderId[];

export function chooseConsultProvider(configured: ReadonlySet<LlmProviderId>, current: LlmProviderId | null): ConsultProviderId | null {
  if (current !== null && PROVIDERS.includes(current as ConsultProviderId) && configured.has(current)) {
    return current as ConsultProviderId;
  }
  return PROVIDERS.find((provider) => configured.has(provider)) ?? null;
}

export interface ConsultProviderDeps extends ProviderResolutionDeps {
  loadDefaultModel: () => Promise<string | null>;
}

export async function resolveConsultProvider(deps: ConsultProviderDeps): Promise<{ providerId: ConsultProviderId; apiKey: string } | null> {
  const keys = await Promise.all(PROVIDERS.map((provider) => deps.loadApiKey(provider)));
  const settings = await deps.loadLlmConnectionSettings?.();
  const current = settings?.provider ?? resolveProviderId((await deps.loadDefaultModel()) ?? FACTORY_DEFAULT_MODEL);
  const configured = new Set(PROVIDERS.filter((_provider, index) => !!keys[index]));
  const providerId = chooseConsultProvider(configured, current);
  if (providerId === null) {
    return null;
  }
  return { providerId, apiKey: keys[PROVIDERS.indexOf(providerId)]! };
}
