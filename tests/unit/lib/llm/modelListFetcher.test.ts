// モデル一覧の自動取得（issue #127 PR4）の単体テスト
import {
  ANTHROPIC_MODEL_LIST_MAX_PAGES,
  deriveOpenAiCompatibleModelsUrl,
  fetchAnthropicModelIds,
  fetchModelIds,
  fetchOpenAiCompatibleModelIds,
  fetchOpenRouterModelIds,
  isModelListFetchSupported,
} from '../../../../src/lib/llm/modelListFetcher';
import { BROWSER_ACCESS_HEADER } from '../../../../src/lib/llm/AnthropicProvider';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

function errorResponse(status: number, body = 'err'): Response {
  return {
    ok: false,
    status,
    json: async () => ({}),
    text: async () => body,
  } as unknown as Response;
}

/** res.text() 自体が失敗する応答（readErrorBody の catch フォールバック用） */
function errorResponseWithFailingText(status: number): Response {
  return {
    ok: false,
    status,
    json: async () => ({}),
    text: async () => {
      throw new Error('body read failed');
    },
  } as unknown as Response;
}

describe('isModelListFetchSupported', () => {
  test('anthropic / openrouter / openai_compatible は対応、gemini / azure_openai は非対応', () => {
    expect(isModelListFetchSupported('anthropic')).toBe(true);
    expect(isModelListFetchSupported('openrouter')).toBe(true);
    expect(isModelListFetchSupported('openai_compatible')).toBe(true);
    expect(isModelListFetchSupported('gemini')).toBe(false);
    expect(isModelListFetchSupported('azure_openai')).toBe(false);
  });
});

describe('fetchAnthropicModelIds', () => {
  test('1 ページで has_more:false ならそのまま返し、実 API の必須ヘッダを送る', async () => {
    const fetch = jest.fn().mockResolvedValue(
      jsonResponse({
        data: [{ id: 'claude-opus-5' }, { id: 'claude-sonnet-5' }],
        has_more: false,
      }),
    );
    const ids = await fetchAnthropicModelIds('sk-ant-xxx', fetch);
    expect(ids).toEqual(['claude-opus-5', 'claude-sonnet-5']);
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/models');
    expect(init.method).toBe('GET');
    expect(init.headers).toEqual({
      'x-api-key': 'sk-ant-xxx',
      'anthropic-version': '2023-06-01',
      // 実 API の必須ヘッダ（AnthropicProvider.chat と同じ制約。issue #210 / #127）
      [BROWSER_ACCESS_HEADER]: 'true',
    });
  });

  test('has_more:true を after_id で辿り、全ページ分を連結する', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ data: [{ id: 'model-a' }], has_more: true, last_id: 'model-a' }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ data: [{ id: 'model-b' }], has_more: false, last_id: 'model-b' }),
      );
    const ids = await fetchAnthropicModelIds('sk-ant-xxx', fetch);
    expect(ids).toEqual(['model-a', 'model-b']);
    expect(fetch).toHaveBeenCalledTimes(2);
    const secondUrl = (fetch.mock.calls[1] as [string, RequestInit])[0];
    expect(secondUrl).toBe('https://api.anthropic.com/v1/models?after_id=model-a');
  });

  test('ページ数のハードキャップに達したら打ち切り、それまでの ID を返す', async () => {
    const fetch = jest.fn().mockImplementation((url: string) =>
      Promise.resolve(
        jsonResponse({
          data: [{ id: `model-${url}` }],
          has_more: true,
          last_id: `next-${Math.random()}`,
        }),
      ),
    );
    const ids = await fetchAnthropicModelIds('sk-ant-xxx', fetch);
    expect(fetch).toHaveBeenCalledTimes(ANTHROPIC_MODEL_LIST_MAX_PAGES);
    expect(ids).toHaveLength(ANTHROPIC_MODEL_LIST_MAX_PAGES);
  });

  test('has_more:true なのに last_id が無ければ継続不能として打ち切る', async () => {
    const fetch = jest.fn().mockResolvedValue(
      jsonResponse({ data: [{ id: 'model-a' }], has_more: true, last_id: null }),
    );
    const ids = await fetchAnthropicModelIds('sk-ant-xxx', fetch);
    expect(ids).toEqual(['model-a']);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('HTTP エラーは理由付きで例外にする', async () => {
    const fetch = jest.fn().mockResolvedValue(errorResponse(401, 'invalid x-api-key'));
    await expect(fetchAnthropicModelIds('bad-key', fetch)).rejects.toThrow(
      /HTTP 401.*invalid x-api-key/,
    );
  });

  test('id が文字列でないエントリは無視する', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ data: [{ id: 42 }, { id: 'ok' }, {}], has_more: false }));
    const ids = await fetchAnthropicModelIds('sk-ant-xxx', fetch);
    expect(ids).toEqual(['ok']);
  });

  test('data フィールド自体が無い応答は空配列として扱う', async () => {
    const fetch = jest.fn().mockResolvedValue(jsonResponse({ has_more: false }));
    const ids = await fetchAnthropicModelIds('sk-ant-xxx', fetch);
    expect(ids).toEqual([]);
  });
});

describe('fetchOpenRouterModelIds', () => {
  test('公開エンドポイントへ認証なしで GET し、data[].id を返す', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ data: [{ id: 'openrouter/model-a' }] }));
    const ids = await fetchOpenRouterModelIds(fetch);
    expect(ids).toEqual(['openrouter/model-a']);
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/v1/models');
    expect(init.headers).toBeUndefined();
  });

  test('HTTP エラーは理由付きで例外にする', async () => {
    const fetch = jest.fn().mockResolvedValue(errorResponse(503, 'unavailable'));
    await expect(fetchOpenRouterModelIds(fetch)).rejects.toThrow(/HTTP 503.*unavailable/);
  });
});

describe('deriveOpenAiCompatibleModelsUrl', () => {
  test('末尾が /chat/completions のとき /models へ置き換える（クエリ文字列は維持）', () => {
    expect(deriveOpenAiCompatibleModelsUrl('https://llm.example/v1/chat/completions')).toBe(
      'https://llm.example/v1/models',
    );
    expect(
      deriveOpenAiCompatibleModelsUrl(
        'https://llm.example/v1/chat/completions?api-version=2026-01-01',
      ),
    ).toBe('https://llm.example/v1/models?api-version=2026-01-01');
  });

  test('末尾が /chat/completions でない URL は推測せずエラーにする', () => {
    expect(() => deriveOpenAiCompatibleModelsUrl('https://llm.example/v1/completions')).toThrow(
      /推測できません/,
    );
    expect(() => deriveOpenAiCompatibleModelsUrl('https://llm.example/v1/chat/completions/extra')).toThrow(
      /推測できません/,
    );
  });
});

describe('fetchOpenAiCompatibleModelIds', () => {
  test('導出した URL へ Authorization 付きで GET する', async () => {
    const fetch = jest.fn().mockResolvedValue(jsonResponse({ data: [{ id: 'local-model' }] }));
    const ids = await fetchOpenAiCompatibleModelIds(
      'https://llm.example/v1/chat/completions',
      'sk-local',
      fetch,
    );
    expect(ids).toEqual(['local-model']);
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://llm.example/v1/models');
    expect(init.headers).toEqual({ Authorization: 'Bearer sk-local' });
  });

  test('空キー（loopback 許可）では Authorization ヘッダーを送らない', async () => {
    const fetch = jest.fn().mockResolvedValue(jsonResponse({ data: [] }));
    await fetchOpenAiCompatibleModelIds('http://localhost:11434/v1/chat/completions', '', fetch);
    const init = (fetch.mock.calls[0] as [string, RequestInit])[1];
    expect(init.headers).toEqual({});
  });

  test('HTTP エラーは理由付きで例外にする', async () => {
    const fetch = jest.fn().mockResolvedValue(errorResponse(404, 'not found'));
    await expect(
      fetchOpenAiCompatibleModelIds('https://llm.example/v1/chat/completions', 'k', fetch),
    ).rejects.toThrow(/HTTP 404.*not found/);
  });

  test('URL 導出に失敗すればそのエラーがそのまま伝播する', async () => {
    const fetch = jest.fn();
    await expect(
      fetchOpenAiCompatibleModelIds('https://llm.example/v1/completions', 'k', fetch),
    ).rejects.toThrow(/推測できません/);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('fetchModelIds（接続方式ごとの窓口）', () => {
  test('anthropic は fetchAnthropicModelIds へ委譲する', async () => {
    const fetch = jest.fn().mockResolvedValue(jsonResponse({ data: [{ id: 'claude-x' }], has_more: false }));
    const ids = await fetchModelIds({ provider: 'anthropic', apiKey: 'sk-ant', fetch });
    expect(ids).toEqual(['claude-x']);
  });

  test('openrouter は fetchOpenRouterModelIds へ委譲する（apiKey は無視）', async () => {
    const fetch = jest.fn().mockResolvedValue(jsonResponse({ data: [{ id: 'or-x' }] }));
    const ids = await fetchModelIds({ provider: 'openrouter', apiKey: '', fetch });
    expect(ids).toEqual(['or-x']);
  });

  test('openai_compatible は chatCompletionsUrl から導出した URL へ委譲する', async () => {
    const fetch = jest.fn().mockResolvedValue(jsonResponse({ data: [{ id: 'compat-x' }] }));
    const ids = await fetchModelIds({
      provider: 'openai_compatible',
      apiKey: 'k',
      chatCompletionsUrl: 'https://llm.example/v1/chat/completions',
      fetch,
    });
    expect(ids).toEqual(['compat-x']);
  });

  test('openai_compatible で chatCompletionsUrl 未指定はエラーにする', async () => {
    await expect(
      fetchModelIds({ provider: 'openai_compatible', apiKey: 'k', fetch: jest.fn() }),
    ).rejects.toThrow(/エンドポイント URL が未設定/);
  });
});

describe('fetch 省略時の既定値（globalThis.fetch）', () => {
  let originalFetch: typeof fetch | undefined;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    if (originalFetch === undefined) {
      delete (globalThis as { fetch?: typeof fetch }).fetch;
    } else {
      globalThis.fetch = originalFetch;
    }
  });

  test('fetchAnthropicModelIds は fetch 省略時に globalThis.fetch を使う', async () => {
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue(
        jsonResponse({ data: [{ id: 'claude-global' }], has_more: false }),
      ) as unknown as typeof fetch;
    const ids = await fetchAnthropicModelIds('sk-ant-xxx');
    expect(ids).toEqual(['claude-global']);
  });

  test('fetchOpenRouterModelIds は fetch 省略時に globalThis.fetch を使う', async () => {
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ data: [{ id: 'or-global' }] })) as unknown as typeof fetch;
    const ids = await fetchOpenRouterModelIds();
    expect(ids).toEqual(['or-global']);
  });

  test('fetchOpenAiCompatibleModelIds は fetch 省略時に globalThis.fetch を使う', async () => {
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ data: [{ id: 'compat-global' }] })) as unknown as typeof fetch;
    const ids = await fetchOpenAiCompatibleModelIds(
      'https://llm.example/v1/chat/completions',
      'k',
    );
    expect(ids).toEqual(['compat-global']);
  });

  test('fetchModelIds は config.fetch 省略時に globalThis.fetch を使う', async () => {
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ data: [{ id: 'or-via-dispatcher' }] })) as unknown as typeof fetch;
    const ids = await fetchModelIds({ provider: 'openrouter', apiKey: '' });
    expect(ids).toEqual(['or-via-dispatcher']);
  });
});

describe('readErrorBody のフォールバック（res.text() 自体が失敗する場合）', () => {
  test('Anthropic: 本文が読めなくてもステータスだけで例外にする', async () => {
    const fetch = jest.fn().mockResolvedValue(errorResponseWithFailingText(500));
    await expect(fetchAnthropicModelIds('sk-ant-xxx', fetch)).rejects.toThrow(/HTTP 500/);
  });

  test('OpenRouter: 本文が読めなくてもステータスだけで例外にする', async () => {
    const fetch = jest.fn().mockResolvedValue(errorResponseWithFailingText(503));
    await expect(fetchOpenRouterModelIds(fetch)).rejects.toThrow(/HTTP 503/);
  });

  test('OpenAI 互換 API: 本文が読めなくてもステータスだけで例外にする', async () => {
    const fetch = jest.fn().mockResolvedValue(errorResponseWithFailingText(404));
    await expect(
      fetchOpenAiCompatibleModelIds('https://llm.example/v1/chat/completions', 'k', fetch),
    ).rejects.toThrow(/HTTP 404/);
  });
});
