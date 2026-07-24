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

  // 応答内容の検査（issue #187）: 空 content・打ち切り・ボディ切断を原因付きで throw する
  describe('応答内容の検査（issue #187）', () => {
    test('content が null なら finish_reason 付きの LlmProviderError（再試行対象外）', async () => {
      const fetch = jest.fn().mockResolvedValue(jsonResponse(chatCompletion(null)));
      const provider = new OpenRouterProvider({ apiKey: 'k', model: 'm/x', fetch });
      try {
        await provider.chat([{ role: 'user', content: 'q' }]);
        throw new Error('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(LlmProviderError);
        const e = err as LlmProviderError;
        expect(e.message).toContain('本文（content）がありません');
        expect(e.message).toContain('finish_reason=stop');
        expect(e.retryable).toBe(false);
        expect(JSON.parse(e.responseBody)).toMatchObject({ finish_reason: 'stop' });
      }
    });

    test('content が空文字でも同様に throw する', async () => {
      const fetch = jest.fn().mockResolvedValue(jsonResponse(chatCompletion('')));
      const provider = new OpenRouterProvider({ apiKey: 'k', model: 'm/x', fetch });
      await expect(provider.chat([{ role: 'user', content: 'q' }])).rejects.toThrow(
        '本文（content）がありません',
      );
    });

    test('choices 自体が無い応答は finish_reason=不明 で throw する', async () => {
      const fetch = jest.fn().mockResolvedValue(jsonResponse({ usage: {} }));
      const provider = new OpenRouterProvider({ apiKey: 'k', model: 'm/x', fetch });
      await expect(provider.chat([{ role: 'user', content: 'q' }])).rejects.toThrow(
        'finish_reason=不明',
      );
    });

    test('HTTP 200 でもボディが JSON として読めなければ retryable な LlmProviderError（切断疑い）', async () => {
      const fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => '{"choices":[{"message":{"content":"truncat',
      } as unknown as Response);
      const provider = new OpenRouterProvider({ apiKey: 'k', model: 'm/x', fetch });
      try {
        await provider.chat([{ role: 'user', content: 'q' }]);
        throw new Error('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(LlmProviderError);
        const e = err as LlmProviderError;
        expect(e.message).toContain('JSON として読めません');
        expect(e.retryable).toBe(true);
        expect(e.status).toBe(200);
        expect(e.responseBody).toContain('truncat'); // ボディ末尾の抜粋を残す
      }
    });

    test('choice にプロバイダ側 error があれば retryable な LlmProviderError', async () => {
      const fetch = jest.fn().mockResolvedValue(
        jsonResponse({
          choices: [
            {
              message: { role: 'assistant', content: null },
              finish_reason: 'error',
              native_finish_reason: 'upstream_timeout',
              error: { message: 'Provider returned error', code: 502 },
            },
          ],
        }),
      );
      const provider = new OpenRouterProvider({ apiKey: 'k', model: 'm/x', fetch });
      try {
        await provider.chat([{ role: 'user', content: 'q' }]);
        throw new Error('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(LlmProviderError);
        const e = err as LlmProviderError;
        expect(e.message).toContain('プロバイダ側エラー');
        expect(e.retryable).toBe(true);
        expect(JSON.parse(e.responseBody)).toMatchObject({
          finish_reason: 'error',
          native_finish_reason: 'upstream_timeout',
          error: { message: 'Provider returned error', code: 502 },
        });
      }
    });

    test('finish_reason 無しでも choice に error があれば finish_reason=不明 で throw する', async () => {
      const fetch = jest.fn().mockResolvedValue(
        jsonResponse({
          choices: [{ message: { role: 'assistant', content: null }, error: { message: 'boom' } }],
        }),
      );
      const provider = new OpenRouterProvider({ apiKey: 'k', model: 'm/x', fetch });
      await expect(provider.chat([{ role: 'user', content: 'q' }])).rejects.toThrow(
        'プロバイダ側エラーを返しました（finish_reason=不明）',
      );
    });

    test('finish_reason=length は content があっても出力トークン上限の打ち切りとして throw', async () => {
      const fetch = jest.fn().mockResolvedValue(
        jsonResponse({
          choices: [{ message: { role: 'assistant', content: '[{"trunca' }, finish_reason: 'length' }],
        }),
      );
      const provider = new OpenRouterProvider({ apiKey: 'k', model: 'm/x', fetch });
      await expect(provider.chat([{ role: 'user', content: 'q' }])).rejects.toThrow(
        '出力トークン上限で打ち切られました',
      );
    });

    test('finish_reason=content_filter はコンテンツフィルタの打ち切りとして throw（再試行対象外）', async () => {
      const fetch = jest.fn().mockResolvedValue(
        jsonResponse({
          choices: [{ message: { role: 'assistant', content: 'partial' }, finish_reason: 'content_filter' }],
        }),
      );
      const provider = new OpenRouterProvider({ apiKey: 'k', model: 'm/x', fetch });
      try {
        await provider.chat([{ role: 'user', content: 'q' }]);
        throw new Error('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(LlmProviderError);
        expect((err as LlmProviderError).message).toContain('コンテンツフィルタ');
        expect((err as LlmProviderError).retryable).toBe(false);
      }
    });
  });

  // 失敗種別（LlmFailureKind）の分類（実データ抽出の失敗ヒント）
  describe('失敗種別（LlmFailureKind）の分類', () => {
    test('choice.error.metadata.error_type === "timeout" は timeout', async () => {
      const fetch = jest.fn().mockResolvedValue(
        jsonResponse({
          choices: [
            {
              message: { role: 'assistant', content: null },
              finish_reason: 'error',
              error: { message: 'Upstream idle timeout exceeded', code: 504, metadata: { error_type: 'timeout' } },
            },
          ],
        }),
      );
      const provider = new OpenRouterProvider({ apiKey: 'k', model: 'm/x', fetch });
      await expect(provider.chat([{ role: 'user', content: 'q' }])).rejects.toMatchObject({
        failureKind: 'timeout',
        retryable: true,
      });
    });

    test('error.code === 504（metadata なし）も timeout', async () => {
      const fetch = jest.fn().mockResolvedValue(
        jsonResponse({
          choices: [
            { message: { role: 'assistant', content: null }, finish_reason: 'error', error: { code: 504 } },
          ],
        }),
      );
      const provider = new OpenRouterProvider({ apiKey: 'k', model: 'm/x', fetch });
      await expect(provider.chat([{ role: 'user', content: 'q' }])).rejects.toMatchObject({
        failureKind: 'timeout',
      });
    });

    test('finish_reason=error でも choice.error 自体が無ければ failureKind は null', async () => {
      const fetch = jest.fn().mockResolvedValue(
        jsonResponse({
          choices: [{ message: { role: 'assistant', content: null }, finish_reason: 'error' }],
        }),
      );
      const provider = new OpenRouterProvider({ apiKey: 'k', model: 'm/x', fetch });
      await expect(provider.chat([{ role: 'user', content: 'q' }])).rejects.toMatchObject({
        failureKind: null,
      });
    });

    test('finish_reason=error でも timeout シグナルが無ければ failureKind は null（汎用フォールバック。判定優先順位）', async () => {
      const fetch = jest.fn().mockResolvedValue(
        jsonResponse({
          choices: [
            {
              message: { role: 'assistant', content: null },
              finish_reason: 'error',
              error: { message: 'Provider returned error', code: 502 },
            },
          ],
        }),
      );
      const provider = new OpenRouterProvider({ apiKey: 'k', model: 'm/x', fetch });
      await expect(provider.chat([{ role: 'user', content: 'q' }])).rejects.toMatchObject({
        failureKind: null,
      });
    });

    test('HTTP 404 + 画像入力非対応の本文は image_unsupported（実物: OpenRouter の "No endpoints found that support image input"）', async () => {
      const fetch = jest.fn().mockResolvedValue(
        errorResponse(404, JSON.stringify({ error: { message: 'No endpoints found that support image input', code: 404 } })),
      );
      const provider = new OpenRouterProvider({ apiKey: 'k', model: 'qwen/qwen3-235b-a22b-2507', fetch });
      await expect(provider.chat([{ role: 'user', content: 'q' }])).rejects.toMatchObject({
        failureKind: 'image_unsupported',
        status: 404,
      });
    });

    test('HTTP 404 でも画像入力非対応と無関係な本文なら failureKind は null', async () => {
      const fetch = jest.fn().mockResolvedValue(
        errorResponse(404, JSON.stringify({ error: { message: 'model not found', code: 404 } })),
      );
      const provider = new OpenRouterProvider({ apiKey: 'k', model: 'm/x', fetch });
      await expect(provider.chat([{ role: 'user', content: 'q' }])).rejects.toMatchObject({
        failureKind: null,
      });
    });

    test('HTTP 404 の本文が JSON として読めなければ failureKind は null', async () => {
      const fetch = jest.fn().mockResolvedValue(errorResponse(404, 'not json'));
      const provider = new OpenRouterProvider({ apiKey: 'k', model: 'm/x', fetch });
      await expect(provider.chat([{ role: 'user', content: 'q' }])).rejects.toMatchObject({
        failureKind: null,
      });
    });

    test('HTTP 404 以外のステータスは画像非対応の本文でも image_unsupported にしない', async () => {
      const fetch = jest.fn().mockResolvedValue(
        errorResponse(400, JSON.stringify({ error: { message: 'No endpoints found that support image input', code: 400 } })),
      );
      const provider = new OpenRouterProvider({ apiKey: 'k', model: 'm/x', fetch });
      await expect(provider.chat([{ role: 'user', content: 'q' }])).rejects.toMatchObject({
        failureKind: null,
        status: 400,
      });
    });

    test('finish_reason=length は output_limit', async () => {
      const fetch = jest.fn().mockResolvedValue(
        jsonResponse({
          choices: [{ message: { role: 'assistant', content: '[{"trunca' }, finish_reason: 'length' }],
        }),
      );
      const provider = new OpenRouterProvider({ apiKey: 'k', model: 'm/x', fetch });
      await expect(provider.chat([{ role: 'user', content: 'q' }])).rejects.toMatchObject({
        failureKind: 'output_limit',
      });
    });

    test('finish_reason=content_filter は content_filter', async () => {
      const fetch = jest.fn().mockResolvedValue(
        jsonResponse({
          choices: [{ message: { role: 'assistant', content: 'partial' }, finish_reason: 'content_filter' }],
        }),
      );
      const provider = new OpenRouterProvider({ apiKey: 'k', model: 'm/x', fetch });
      await expect(provider.chat([{ role: 'user', content: 'q' }])).rejects.toMatchObject({
        failureKind: 'content_filter',
      });
    });

    test('ボディが JSON として読めない（切断）は malformed', async () => {
      const fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => '{"choices":[{"message":{"content":"truncat',
      } as unknown as Response);
      const provider = new OpenRouterProvider({ apiKey: 'k', model: 'm/x', fetch });
      await expect(provider.chat([{ role: 'user', content: 'q' }])).rejects.toMatchObject({
        failureKind: 'malformed',
        retryable: true,
      });
    });

    test('content が空（理由不明）は failureKind が null', async () => {
      const fetch = jest.fn().mockResolvedValue(jsonResponse(chatCompletion(null)));
      const provider = new OpenRouterProvider({ apiKey: 'k', model: 'm/x', fetch });
      await expect(provider.chat([{ role: 'user', content: 'q' }])).rejects.toMatchObject({
        failureKind: null,
      });
    });
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
