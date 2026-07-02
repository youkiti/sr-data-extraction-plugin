// createProvider / resolveProviderId の単体テスト
// （sr-query-builder から流用。本拡張の調整: model 必須 + OpenRouter は P1 未対応エラー）
import { GeminiProvider } from '../../../../src/lib/llm/GeminiProvider';
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

  test('openrouter（明示・自動解決とも）は P1 未対応として投げる', () => {
    expect(() =>
      createProvider({ provider: 'openrouter', apiKey: 'k', model: 'qwen/qwen3-235b-a22b-2507' }),
    ).toThrow('OpenRouter プロバイダは P1 で対応予定');
    expect(() => createProvider({ apiKey: 'k', model: 'qwen/qwen3-235b-a22b-2507' })).toThrow(
      'OpenRouter プロバイダは P1 で対応予定',
    );
  });

  test('fetch オプションを渡しても生成できる（GeminiProvider へ pass-through）', () => {
    const fetchMock = jest.fn() as unknown as typeof fetch;
    const provider = createProvider({ apiKey: 'k', model: 'gemini-2.5-pro', fetch: fetchMock });
    expect(provider.model).toBe('gemini-2.5-pro');
  });
});
