// createProvider / resolveProviderId の単体テスト
// （sr-query-builder から流用。本拡張の調整: model 必須）
import { GeminiProvider } from '../../../../src/lib/llm/GeminiProvider';
import { OpenRouterProvider } from '../../../../src/lib/llm/OpenRouterProvider';
import { createProvider, resolveProviderId } from '../../../../src/lib/llm/providerFactory';

describe('resolveProviderId', () => {
  test('org/model 形式（/ を含む）は openrouter と解決する', () => {
    expect(resolveProviderId('qwen/qwen3-235b-a22b-2507')).toBe('openrouter');
  });

  test('/ を含まないモデル ID は gemini と解決する', () => {
    expect(resolveProviderId('gemini-2.5-pro')).toBe('gemini');
  });
});

describe('createProvider', () => {
  test('provider: gemini を明示すると GeminiProvider が返る', () => {
    const provider = createProvider({ provider: 'gemini', apiKey: 'k', model: 'gemini-2.5-pro' });
    expect(provider).toBeInstanceOf(GeminiProvider);
    expect(provider.providerId).toBe('gemini');
    expect(provider.model).toBe('gemini-2.5-pro');
  });

  test('provider 省略時は model から gemini を自動解決する', () => {
    const provider = createProvider({ apiKey: 'k', model: 'gemini-3.5-flash' });
    expect(provider).toBeInstanceOf(GeminiProvider);
    expect(provider.model).toBe('gemini-3.5-flash');
  });

  test('openrouter（明示・自動解決とも）は OpenRouterProvider が返る', () => {
    const explicit = createProvider({
      provider: 'openrouter',
      apiKey: 'k',
      model: 'qwen/qwen3-235b-a22b-2507',
    });
    expect(explicit).toBeInstanceOf(OpenRouterProvider);
    expect(explicit.providerId).toBe('openrouter');
    expect(explicit.model).toBe('qwen/qwen3-235b-a22b-2507');

    const resolved = createProvider({ apiKey: 'k', model: 'deepseek/deepseek-v4-flash' });
    expect(resolved).toBeInstanceOf(OpenRouterProvider);
    expect(resolved.model).toBe('deepseek/deepseek-v4-flash');
  });

  test('fetch オプションを渡しても生成できる（GeminiProvider へ pass-through）', () => {
    const fetchMock = jest.fn() as unknown as typeof fetch;
    const provider = createProvider({ apiKey: 'k', model: 'gemini-2.5-pro', fetch: fetchMock });
    expect(provider.model).toBe('gemini-2.5-pro');
  });
});
