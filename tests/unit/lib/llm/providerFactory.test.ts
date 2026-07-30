// createProvider / resolveProviderId の単体テスト
// （sr-query-builder から流用。本拡張の調整: model 必須）
import { AnthropicProvider } from '../../../../src/lib/llm/AnthropicProvider';
import { GeminiProvider } from '../../../../src/lib/llm/GeminiProvider';
import { OpenAICompatibleProvider } from '../../../../src/lib/llm/OpenAICompatibleProvider';
import { OpenRouterProvider } from '../../../../src/lib/llm/OpenRouterProvider';
import {
  createProvider,
  isRunBlockedByImageUnsupportedModel,
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

  // issue #127 PR2: claude- 始まりのモデル ID を Gemini 誤送信させない回帰テスト
  // （resolveProviderConfig が settings.provider ?? resolveProviderId(model) を使うため、
  // 接続方式を保存していないユーザーが claude-opus-5 を選ぶとここが直に効く）
  test('claude- 始まりのモデル ID は anthropic と解決する', () => {
    expect(resolveProviderId('claude-opus-5')).toBe('anthropic');
    expect(resolveProviderId('claude-sonnet-5')).toBe('anthropic');
  });

  // OpenRouter 経由でホストされる anthropic/claude-... は org/model 形式（/ を含む）が
  // 優先されるべきで、claude- 判定に食われて anthropic 誤判定にならないことを固定する
  test('OpenRouter の org/model 形式（anthropic/claude-...）は / 判定が勝ち openrouter のまま', () => {
    expect(resolveProviderId('anthropic/claude-opus-5')).toBe('openrouter');
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

  // issue #127 PR2: createProvider は以前 provider === 'anthropic' を分岐せず、
  // 末尾の無条件 `return new GeminiProvider(...)` にフォールスルーして Gemini へ誤送信していた
  test('provider: anthropic（明示・自動解決とも）は AnthropicProvider が返る（Gemini への誤フォールバック回帰）', () => {
    const explicit = createProvider({ provider: 'anthropic', apiKey: 'k', model: 'claude-opus-5' });
    expect(explicit).toBeInstanceOf(AnthropicProvider);
    expect(explicit).not.toBeInstanceOf(GeminiProvider);
    expect(explicit.providerId).toBe('anthropic');
    expect(explicit.model).toBe('claude-opus-5');

    const resolved = createProvider({ apiKey: 'k', model: 'claude-sonnet-5' });
    expect(resolved).toBeInstanceOf(AnthropicProvider);
    expect(resolved.model).toBe('claude-sonnet-5');
  });

  // issue #127 PR3: Azure OpenAI は新規 provider クラスを作らず、OpenAICompatibleProvider を
  // 認証方式（api-key ヘッダー）だけ切り替えて流用する
  test('provider: azure_openai は OpenAICompatibleProvider を azure_api_key 認証で生成する', () => {
    const provider = createProvider({
      provider: 'azure_openai',
      apiKey: 'k',
      model: 'gpt-4o-deployment',
      endpoint:
        'https://res.openai.azure.com/openai/deployments/gpt-4o-deployment/chat/completions?api-version=2026-01-01',
    });
    expect(provider).toBeInstanceOf(OpenAICompatibleProvider);
    expect(provider.providerId).toBe('azure_openai');
    expect(provider.model).toBe('gpt-4o-deployment');
  });

  test('Azure OpenAI の endpoint 欠落は拒否する', () => {
    expect(() =>
      createProvider({ provider: 'azure_openai', apiKey: 'k', model: 'm' }),
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

  test('保存済み接続方式が anthropic なら claude- 以外のモデル名でも Anthropic キーを解決する', async () => {
    const loadApiKey = jest.fn().mockResolvedValue('anthropic-key');
    await expect(
      resolveProviderConfig('claude-opus-5', {
        loadApiKey,
        loadLlmConnectionSettings: async () => ({
          provider: 'anthropic',
          openAiCompatibleEndpoint: null,
        }),
      }),
    ).resolves.toEqual({
      provider: 'anthropic',
      config: { provider: 'anthropic', apiKey: 'anthropic-key', model: 'claude-opus-5' },
    });
    expect(loadApiKey).toHaveBeenCalledWith('anthropic');
  });

  test('接続方式未保存でも claude- モデル名から anthropic を自動解決する', async () => {
    const loadApiKey = jest.fn().mockResolvedValue('anthropic-key');
    await expect(resolveProviderConfig('claude-haiku-4-5', { loadApiKey })).resolves.toEqual({
      provider: 'anthropic',
      config: { provider: 'anthropic', apiKey: 'anthropic-key', model: 'claude-haiku-4-5' },
    });
    expect(loadApiKey).toHaveBeenCalledWith('anthropic');
  });

  // issue #127 PR3: 保存済み接続方式が azure_openai なら openAiCompatibleEndpoint を解決する
  // （openai_compatible と保存キーを共有する。settingsStore.usesOpenAiCompatibleEndpoint）
  test('保存済み接続方式が azure_openai なら endpoint を解決する', async () => {
    const loadApiKey = jest.fn().mockResolvedValue('azure-key');
    await expect(
      resolveProviderConfig('gpt-4o-deployment', {
        loadApiKey,
        loadLlmConnectionSettings: async () => ({
          provider: 'azure_openai',
          openAiCompatibleEndpoint:
            'https://res.openai.azure.com/openai/deployments/gpt-4o-deployment/chat/completions?api-version=2026-01-01',
        }),
      }),
    ).resolves.toEqual({
      provider: 'azure_openai',
      config: {
        provider: 'azure_openai',
        apiKey: 'azure-key',
        model: 'gpt-4o-deployment',
        endpoint:
          'https://res.openai.azure.com/openai/deployments/gpt-4o-deployment/chat/completions?api-version=2026-01-01',
      },
    });
    expect(loadApiKey).toHaveBeenCalledWith('azure_openai');
  });

  // issue #127 PR3: Azure は loopback URL でもキー任意許可の対象にしない
  // （OpenAI 互換 API 限定の loopback 実験用途を Azure まで広げない）
  test('azure_openai は loopback endpoint でも空キーを許可しない（config は null）', async () => {
    await expect(
      resolveProviderConfig('local-deployment', {
        loadApiKey: async () => null,
        loadLlmConnectionSettings: async () => ({
          provider: 'azure_openai',
          openAiCompatibleEndpoint: 'http://localhost:11434/openai/deployments/x?api-version=2026-01-01',
        }),
      }),
    ).resolves.toEqual({ provider: 'azure_openai', config: null });
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

describe('isRunBlockedByImageUnsupportedModel（画像非対応モデルの実行ブロック）', () => {
  test('画像入力が必要な文書が無ければブロックしない', () => {
    expect(isRunBlockedByImageUnsupportedModel('qwen/qwen3-235b-a22b-2507', false)).toBe(false);
  });

  test('モデル未選択（空文字）はブロックしない（モデル未選択チェックに委ねる）', () => {
    expect(isRunBlockedByImageUnsupportedModel('', true)).toBe(false);
  });

  test('画像入力が必要な文書があり、モデルが既知の unsupported ならブロックする', () => {
    expect(isRunBlockedByImageUnsupportedModel('qwen/qwen3-235b-a22b-2507', true)).toBe(true);
    expect(isRunBlockedByImageUnsupportedModel('deepseek/deepseek-v4-flash', true)).toBe(true);
  });

  test('画像入力が必要な文書があっても supported モデルならブロックしない', () => {
    expect(isRunBlockedByImageUnsupportedModel('gemini-2.5-pro', true)).toBe(false);
  });

  test('画像入力が必要な文書があっても unknown（カタログ外）モデルはブロックしない（過検出を避ける）', () => {
    expect(isRunBlockedByImageUnsupportedModel('mystery/model', true)).toBe(false);
  });

  // 接続方式 override（issue #191 レビュー対応）: PR レビューで確定した不具合の再現ケース。
  // openai_compatible 接続で qwen モデルを送っている実際の運用では、モデル名推定（openrouter）
  // 由来の unsupported 判定を誤って適用してはいけない
  describe('providerOverride（保存済み接続方式）', () => {
    test('openai_compatible override で qwen モデルはブロックしない（unknown 扱い）', () => {
      expect(
        isRunBlockedByImageUnsupportedModel('qwen/qwen3-235b-a22b-2507', true, 'openai_compatible'),
      ).toBe(false);
    });

    test('override 未指定（null）は従来どおりモデル名推定（openrouter）でブロックする', () => {
      expect(isRunBlockedByImageUnsupportedModel('qwen/qwen3-235b-a22b-2507', true, null)).toBe(true);
    });

    test('override が実測 provider（openrouter）と一致すれば従来どおりブロックする', () => {
      expect(
        isRunBlockedByImageUnsupportedModel('qwen/qwen3-235b-a22b-2507', true, 'openrouter'),
      ).toBe(true);
    });
  });
});
