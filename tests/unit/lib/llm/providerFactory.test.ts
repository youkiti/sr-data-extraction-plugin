// createProvider / resolveProviderId の単体テスト
// （sr-query-builder から流用。本拡張の調整: model 必須）
import { GeminiProvider } from '../../../../src/lib/llm/GeminiProvider';
import { OpenAICompatibleProvider } from '../../../../src/lib/llm/OpenAICompatibleProvider';
import { OpenRouterProvider } from '../../../../src/lib/llm/OpenRouterProvider';
import {
  createProvider,
  resolveProviderConfig,
  resolveProviderId,
} from '../../../../src/lib/llm/providerFactory';

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

  test('OpenAI 互換 API は明示 provider と endpoint で生成する', () => {
    const provider = createProvider({
      provider: 'openai_compatible',
      apiKey: 'k',
      model: 'org/model',
      endpoint: 'https://llm.example/v1/chat/completions',
    });
    expect(provider).toBeInstanceOf(OpenAICompatibleProvider);
    expect(provider.providerId).toBe('openai_compatible');
    expect(provider.model).toBe('org/model');
  });

  test('OpenAI 互換 API の endpoint 欠落は拒否する', () => {
    expect(() =>
      createProvider({ provider: 'openai_compatible', apiKey: 'k', model: 'm' }),
    ).toThrow('エンドポイントが未設定');
  });
});

describe('resolveProviderConfig', () => {
  test('接続設定未注入はモデル ID による従来判定を使う', async () => {
    const loadApiKey = jest.fn().mockResolvedValue('key');
    await expect(resolveProviderConfig('org/model', { loadApiKey })).resolves.toEqual({
      provider: 'openrouter',
      config: { provider: 'openrouter', apiKey: 'key', model: 'org/model' },
    });
    expect(loadApiKey).toHaveBeenCalledWith('openrouter');
  });

  test('保存済み接続方式はスラッシュを含むモデル名より優先する', async () => {
    await expect(
      resolveProviderConfig('org/model', {
        loadApiKey: async () => 'custom-key',
        loadLlmConnectionSettings: async () => ({
          provider: 'openai_compatible',
          openAiCompatibleEndpoint: 'https://llm.example/v1/chat/completions',
        }),
      }),
    ).resolves.toEqual({
      provider: 'openai_compatible',
      config: {
        provider: 'openai_compatible',
        apiKey: 'custom-key',
        model: 'org/model',
        endpoint: 'https://llm.example/v1/chat/completions',
      },
    });
  });

  test('選択した接続方式の API キーが無ければ config は null', async () => {
    await expect(
      resolveProviderConfig('gemini-model', {
        loadApiKey: async () => null,
        loadLlmConnectionSettings: async () => ({
          provider: 'gemini',
          openAiCompatibleEndpoint: null,
        }),
      }),
    ).resolves.toEqual({ provider: 'gemini', config: null });
  });

  test('loopback の OpenAI 互換 API はキーなしで config を解決する', async () => {
    await expect(
      resolveProviderConfig('local-model', {
        loadApiKey: async () => null,
        loadLlmConnectionSettings: async () => ({
          provider: 'openai_compatible',
          openAiCompatibleEndpoint: 'http://localhost:11434/v1/chat/completions',
        }),
      }),
    ).resolves.toEqual({
      provider: 'openai_compatible',
      config: {
        provider: 'openai_compatible',
        apiKey: '',
        model: 'local-model',
        endpoint: 'http://localhost:11434/v1/chat/completions',
      },
    });
  });

  test('OpenAI 互換 endpoint が null なら endpoint を config に足さない', async () => {
    await expect(
      resolveProviderConfig('m', {
        loadApiKey: async () => 'k',
        loadLlmConnectionSettings: async () => ({
          provider: 'openai_compatible',
          openAiCompatibleEndpoint: null,
        }),
      }),
    ).resolves.toEqual({
      provider: 'openai_compatible',
      config: { provider: 'openai_compatible', apiKey: 'k', model: 'm' },
    });
  });
});
