// OpenRouterProvider の単体テスト（sr-query-builder から流用。ヘッダ 2 件だけ本リポジトリ向け）
import { OpenRouterProvider } from '../../../../src/lib/llm/OpenRouterProvider';
import { LlmProviderError } from '../../../../src/lib/llm/LLMProvider';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

function errorResponse(status: number, body = 'err', retryAfter: string | null = null): Response {
  return {
    ok: false,
    status,
    json: async () => ({}),
    text: async () => body,
    headers: { get: (name: string) => (name.toLowerCase() === 'retry-after' ? retryAfter : null) },
  } as unknown as Response;
}

function chatCompletion(
  content: string | null,
  usage?: { prompt_tokens?: number; completion_tokens?: number },
) {
  return {
    choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage,
  };
}

describe('OpenRouterProvider.chat', () => {
  test('正しい URL / Authorization / ロール変換 / body を送る', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValue(
        jsonResponse(chatCompletion('Hello!', { prompt_tokens: 10, completion_tokens: 20 })),
      );
    const provider = new OpenRouterProvider({ apiKey: 'k', model: 'qwen/qwen3-235b-a22b-2507', fetch });
    const result = await provider.chat([
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'q1' },
      { role: 'model', content: 'a1' },
      { role: 'user', content: 'q2' },
    ]);

    expect(result).toEqual({
      text: 'Hello!',
      tokensIn: 10,
      tokensOut: 20,
      raw: expect.any(Object),
    });
    expect(provider.providerId).toBe('openrouter');
    expect(provider.model).toBe('qwen/qwen3-235b-a22b-2507');

    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer k');
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['HTTP-Referer']).toBe('https://github.com/youkiti/sr-data-extraction-plugin');
    expect(headers['X-Title']).toBe('sr-data-extraction-plugin');

    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe('qwen/qwen3-235b-a22b-2507');
    expect(body.messages).toEqual([
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'q2' },
    ]);
  });

  test('temperature / maxOutputTokens を body に反映する', async () => {
    const fetch = jest.fn().mockResolvedValue(jsonResponse(chatCompletion('ok')));
    const provider = new OpenRouterProvider({ apiKey: 'k', model: 'm/x', fetch });
    await provider.chat([{ role: 'user', content: 'q' }], {
      temperature: 0.2,
      maxOutputTokens: 256,
    });
    const body = JSON.parse((fetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.temperature).toBe(0.2);
    expect(body.max_tokens).toBe(256);
  });

  test('オプション未指定なら temperature / max_tokens / response_format を付けない', async () => {
    const fetch = jest.fn().mockResolvedValue(jsonResponse(chatCompletion('ok')));
    const provider = new OpenRouterProvider({ apiKey: 'k', model: 'm/x', fetch });
    await provider.chat([{ role: 'user', content: 'q' }]);
    const body = JSON.parse((fetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.temperature).toBeUndefined();
    expect(body.max_tokens).toBeUndefined();
    expect(body.response_format).toBeUndefined();
  });

  test('responseFormat=json なら response_format を json_object にする', async () => {
    const fetch = jest.fn().mockResolvedValue(jsonResponse(chatCompletion('{}')));
    const provider = new OpenRouterProvider({ apiKey: 'k', model: 'm/x', fetch });
    await provider.chat([{ role: 'user', content: 'q' }], { responseFormat: 'json' });
    const body = JSON.parse((fetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  test('responseSchema を渡すと strict な json_schema 構造化出力にする', async () => {
    const fetch = jest.fn().mockResolvedValue(jsonResponse(chatCompletion('{}')));
    const provider = new OpenRouterProvider({ apiKey: 'k', model: 'm/x', fetch });
    const schema = {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
      additionalProperties: false,
    };
    await provider.chat([{ role: 'user', content: 'q' }], {
      responseFormat: 'json',
      responseSchema: schema,
    });
    const body = JSON.parse((fetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'response', strict: true, schema },
    });
  });

  test('HTTP 400 は LlmProviderError（status 400）', async () => {
    const fetch = jest.fn().mockResolvedValue(errorResponse(400, 'bad request'));
    const provider = new OpenRouterProvider({ apiKey: 'k', model: 'm/x', fetch });
    try {
      await provider.chat([{ role: 'user', content: 'q' }]);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(LlmProviderError);
      const e = err as LlmProviderError;
      expect(e.status).toBe(400);
      expect(e.responseBody).toBe('bad request');
      expect(e.providerId).toBe('openrouter');
    }
  });

  test('429 の Retry-After ヘッダ（秒）を retryAfterMs に載せる', async () => {
    const fetch = jest.fn().mockResolvedValue(errorResponse(429, 'slow down', '12'));
    const provider = new OpenRouterProvider({ apiKey: 'k', model: 'm/x', fetch });
    await expect(provider.chat([{ role: 'user', content: 'q' }])).rejects.toMatchObject({
      status: 429,
      retryAfterMs: 12_000,
    });
  });

  test('エラー応答の text() が失敗しても responseBody は空文字で例外を投げる', async () => {
    const fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
      text: async () => {
        throw new Error('body unavailable');
      },
      headers: { get: () => null },
    } as unknown as Response);
    const provider = new OpenRouterProvider({ apiKey: 'k', model: 'm/x', fetch });
    try {
      await provider.chat([{ role: 'user', content: 'q' }]);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(LlmProviderError);
      const e = err as LlmProviderError;
      expect(e.status).toBe(500);
      expect(e.responseBody).toBe('');
    }
  });

  test('usage.prompt_tokens / completion_tokens からトークン数を読む', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValue(
        jsonResponse(chatCompletion('hi', { prompt_tokens: 5, completion_tokens: 7 })),
      );
    const provider = new OpenRouterProvider({ apiKey: 'k', model: 'm/x', fetch });
    const r = await provider.chat([{ role: 'user', content: 'q' }]);
    expect(r.tokensIn).toBe(5);
    expect(r.tokensOut).toBe(7);
  });

  test('usage が無ければトークン数は null', async () => {
    const fetch = jest.fn().mockResolvedValue(jsonResponse(chatCompletion('hi')));
    const provider = new OpenRouterProvider({ apiKey: 'k', model: 'm/x', fetch });
    const r = await provider.chat([{ role: 'user', content: 'q' }]);
    expect(r.tokensIn).toBeNull();
    expect(r.tokensOut).toBeNull();
  });

  test('content が null なら空文字を返す', async () => {
    const fetch = jest.fn().mockResolvedValue(jsonResponse(chatCompletion(null)));
    const provider = new OpenRouterProvider({ apiKey: 'k', model: 'm/x', fetch });
    const r = await provider.chat([{ role: 'user', content: 'q' }]);
    expect(r.text).toBe('');
  });

  test('supportsImageInput は true（OpenAI 互換の image_url をパススルーする）', () => {
    const provider = new OpenRouterProvider({ apiKey: 'k', model: 'm/x' });
    expect(provider.supportsImageInput).toBe(true);
  });

  test('パート配列 content（text + image）は OpenAI 互換の image_url data URL に写す', async () => {
    const fetch = jest.fn().mockResolvedValue(jsonResponse(chatCompletion('ok')));
    const provider = new OpenRouterProvider({ apiKey: 'k', model: 'm/x', fetch });
    await provider.chat([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'この画像を見て' },
          { type: 'image', mimeType: 'image/png', dataBase64: 'aGVsbG8=' },
        ],
      },
    ]);
    const body = JSON.parse((fetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'この画像を見て' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } },
        ],
      },
    ]);
  });

  test('文字列 content のパスは配列対応を追加しても出力が完全一致する', async () => {
    const fetch = jest.fn().mockResolvedValue(jsonResponse(chatCompletion('ok')));
    const provider = new OpenRouterProvider({ apiKey: 'k', model: 'm/x', fetch });
    await provider.chat([{ role: 'user', content: 'q' }]);
    const body = JSON.parse((fetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.messages).toEqual([{ role: 'user', content: 'q' }]);
  });

  test('fetch 未注入なら globalThis.fetch にフォールバックする', async () => {
    const stub = jest.fn().mockResolvedValue(jsonResponse(chatCompletion('ok')));
    const original = (globalThis as { fetch?: typeof fetch }).fetch;
    (globalThis as { fetch?: typeof fetch }).fetch = stub as unknown as typeof fetch;
    try {
      const provider = new OpenRouterProvider({ apiKey: 'k', model: 'm/x' });
      const r = await provider.chat([{ role: 'user', content: 'q' }]);
      expect(r.text).toBe('ok');
      expect(stub).toHaveBeenCalled();
    } finally {
      if (original === undefined) {
        delete (globalThis as { fetch?: typeof fetch }).fetch;
      } else {
        (globalThis as { fetch?: typeof fetch }).fetch = original;
      }
    }
  });
});
