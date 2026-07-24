import { LlmProviderError } from '../../../../src/lib/llm/LLMProvider';
import { OpenAICompatibleProvider } from '../../../../src/lib/llm/OpenAICompatibleProvider';

function response(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe('OpenAICompatibleProvider', () => {
  test('Bearer 認証で構造化出力を要求し、usage と本文を返す', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      response({
        choices: [{ message: { content: '{"ok":true}' } }],
        usage: { prompt_tokens: 12, completion_tokens: 3 },
      }),
    );
    const provider = new OpenAICompatibleProvider({
      apiKey: 'secret',
      model: 'org/model',
      endpoint: 'https://llm.example/v1/chat/completions',
      fetch: fetchMock,
    });
    const schema = {
      type: 'object',
      properties: { ok: { type: 'boolean' } },
      required: ['ok'],
      additionalProperties: false,
    };
    const result = await provider.chat(
      [
        { role: 'system', content: 's' },
        { role: 'user', content: 'u' },
        { role: 'model', content: 'a' },
      ],
      { temperature: 0, maxOutputTokens: 64, responseSchema: schema },
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://llm.example/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer secret' },
      }),
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'org/model',
      messages: [
        { role: 'system', content: 's' },
        { role: 'user', content: 'u' },
        { role: 'assistant', content: 'a' },
      ],
      temperature: 0,
      max_tokens: 64,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'response', strict: true, schema },
      },
    });
    expect(result).toMatchObject({ text: '{"ok":true}', tokensIn: 12, tokensOut: 3 });
  });

  test('JSON mode は response_format を反映する（本文ありの正常応答）', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      response({ choices: [{ message: { content: '{}' } }] }),
    );
    const provider = new OpenAICompatibleProvider({
      apiKey: 'k',
      model: 'm',
      endpoint: 'https://llm.example/v1/chat/completions',
      fetch: fetchMock,
    });
    await expect(
      provider.chat([{ role: 'user', content: 'q' }], { responseFormat: 'json' }),
    ).resolves.toEqual(expect.objectContaining({ text: '{}', tokensIn: null, tokensOut: null }));
    const firstBody = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(firstBody.response_format).toEqual({ type: 'json_object' });
  });

  test('メッセージ 0 件でも body は空配列で送る', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      response({ choices: [{ message: { content: 'ok' } }] }),
    );
    const provider = new OpenAICompatibleProvider({
      apiKey: 'k',
      model: 'm',
      endpoint: 'https://llm.example/v1/chat/completions',
      fetch: fetchMock,
    });
    await provider.chat([]);
    const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body).toEqual({ model: 'm', messages: [] });
  });

  test('loopback の空 API キーでは Authorization ヘッダーを送らない', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      response({ choices: [{ message: { content: 'ok' } }] }),
    );
    const provider = new OpenAICompatibleProvider({
      apiKey: '   ',
      model: 'local-model',
      endpoint: 'http://localhost:11434/v1/chat/completions',
      fetch: fetchMock,
    });
    await provider.chat([]);
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).headers).toEqual({
      'Content-Type': 'application/json',
    });
  });

  // 応答内容の検査（issue #187 / OpenRouterProvider と同じ方針）: 空 content・打ち切り・
  // ボディ切断を原因付きで throw し、length 打ち切りが format_error に化けないようにする
  describe('応答内容の検査（issue #187）', () => {
    test('content が null なら本文なしの LlmProviderError（failureKind は不明のまま null）', async () => {
      const fetchMock = jest.fn().mockResolvedValue(
        response({ choices: [{ message: { content: null }, finish_reason: 'stop' }] }),
      );
      const provider = new OpenAICompatibleProvider({
        apiKey: 'k',
        model: 'm',
        endpoint: 'https://llm.example/v1/chat/completions',
        fetch: fetchMock,
      });
      try {
        await provider.chat([{ role: 'user', content: 'q' }]);
        throw new Error('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(LlmProviderError);
        const e = err as LlmProviderError;
        expect(e.message).toContain('本文（content）がありません');
        expect(e.failureKind).toBeNull();
      }
    });

    test('choices 自体が無い応答（{}）も本文なしとして throw する', async () => {
      const fetchMock = jest.fn().mockResolvedValue(response({}));
      const provider = new OpenAICompatibleProvider({
        apiKey: 'k',
        model: 'm',
        endpoint: 'https://llm.example/v1/chat/completions',
        fetch: fetchMock,
      });
      await expect(provider.chat([])).rejects.toThrow('本文（content）がありません');
    });

    test('HTTP 200 でもボディが JSON として読めなければ retryable な LlmProviderError（malformed）', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => '{"choices":[{"message":{"content":"truncat',
      } as unknown as Response);
      const provider = new OpenAICompatibleProvider({
        apiKey: 'k',
        model: 'm',
        endpoint: 'https://llm.example/v1/chat/completions',
        fetch: fetchMock,
      });
      try {
        await provider.chat([{ role: 'user', content: 'q' }]);
        throw new Error('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(LlmProviderError);
        const e = err as LlmProviderError;
        expect(e.message).toContain('JSON として読めません');
        expect(e.retryable).toBe(true);
        expect(e.failureKind).toBe('malformed');
      }
    });

    test('finish_reason=length は content があっても output_limit として分類する（format_error に化けない）', async () => {
      const fetchMock = jest.fn().mockResolvedValue(
        response({
          choices: [{ message: { content: '[{"trunca' }, finish_reason: 'length' }],
        }),
      );
      const provider = new OpenAICompatibleProvider({
        apiKey: 'k',
        model: 'm',
        endpoint: 'https://llm.example/v1/chat/completions',
        fetch: fetchMock,
      });
      try {
        await provider.chat([{ role: 'user', content: 'q' }]);
        throw new Error('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(LlmProviderError);
        const e = err as LlmProviderError;
        expect(e.message).toContain('出力トークン上限で打ち切られました');
        expect(e.failureKind).toBe('output_limit');
        expect(e.retryable).toBe(false);
      }
    });

    test('finish_reason=content_filter は content_filter として分類する', async () => {
      const fetchMock = jest.fn().mockResolvedValue(
        response({
          choices: [{ message: { content: 'partial' }, finish_reason: 'content_filter' }],
        }),
      );
      const provider = new OpenAICompatibleProvider({
        apiKey: 'k',
        model: 'm',
        endpoint: 'https://llm.example/v1/chat/completions',
        fetch: fetchMock,
      });
      try {
        await provider.chat([{ role: 'user', content: 'q' }]);
        throw new Error('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(LlmProviderError);
        expect((err as LlmProviderError).failureKind).toBe('content_filter');
      }
    });
  });

  test('strict 非対応時は strict なしへフォールバックし、成功方式を再利用する', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(response({ error: 'strict is unsupported' }, false, 400))
      .mockResolvedValue(response({ choices: [{ message: { content: '{"ok":true}' } }] }));
    const provider = new OpenAICompatibleProvider({
      apiKey: 'k',
      model: 'm',
      endpoint: 'https://llm.example/v1/chat/completions',
      fetch: fetchMock,
    });
    const schema = { type: 'object' };
    await provider.chat([], { responseSchema: schema });
    await provider.chat([], { responseSchema: schema });

    const bodies = fetchMock.mock.calls.map((call) =>
      JSON.parse((call[1] as RequestInit).body as string),
    );
    expect(bodies[0].response_format.json_schema).toEqual({
      name: 'response',
      strict: true,
      schema,
    });
    expect(bodies[1].response_format.json_schema).toEqual({ name: 'response', schema });
    expect(bodies[2].response_format.json_schema).toEqual({ name: 'response', schema });
  });

  test('json_schema 非対応時は json_object までフォールバックする', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(response({ error: 'strict unsupported' }, false, 400))
      .mockResolvedValueOnce(response({ error: 'json_schema unsupported' }, false, 422))
      .mockResolvedValueOnce(
        response({ choices: [{ message: { content: '{"ok":true}' } }] }),
      );
    const provider = new OpenAICompatibleProvider({
      apiKey: 'k',
      model: 'm',
      endpoint: 'https://llm.example/v1/chat/completions',
      fetch: fetchMock,
    });
    await provider.chat([], { responseSchema: { type: 'object' } });
    const body = JSON.parse((fetchMock.mock.calls[2]?.[1] as RequestInit).body as string);
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  test('json_object も非対応なら最後の LlmProviderError を返す', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(response({ error: 'strict unsupported' }, false, 400))
      .mockResolvedValueOnce(response({ error: 'json_schema unsupported' }, false, 400))
      .mockResolvedValueOnce(response({ error: 'response_format unsupported' }, false, 400));
    const provider = new OpenAICompatibleProvider({
      apiKey: 'k',
      model: 'm',
      endpoint: 'https://llm.example/v1/chat/completions',
      fetch: fetchMock,
    });
    await expect(provider.chat([], { responseSchema: { type: 'object' } })).rejects.toMatchObject({
      status: 400,
      responseBody: '{"error":"response_format unsupported"}',
    });
  });

  test('構造化出力と無関係な 400 はフォールバックしない', async () => {
    const fetchMock = jest.fn().mockResolvedValue(response({ error: 'model not found' }, false, 400));
    const provider = new OpenAICompatibleProvider({
      apiKey: 'k',
      model: 'missing',
      endpoint: 'https://llm.example/v1/chat/completions',
      fetch: fetchMock,
    });
    await expect(provider.chat([], { responseSchema: { type: 'object' } })).rejects.toMatchObject({
      status: 400,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('supportsImageInput は true（OpenAI 互換の image_url をパススルーする）', () => {
    const provider = new OpenAICompatibleProvider({
      apiKey: 'k',
      model: 'm',
      endpoint: 'https://llm.example/v1/chat/completions',
    });
    expect(provider.supportsImageInput).toBe(true);
  });

  test('パート配列 content（text + image）は OpenAI 互換の image_url data URL に写す', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      response({ choices: [{ message: { content: 'ok' } }] }),
    );
    const provider = new OpenAICompatibleProvider({
      apiKey: 'k',
      model: 'm',
      endpoint: 'https://llm.example/v1/chat/completions',
      fetch: fetchMock,
    });
    await provider.chat([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'この画像を見て' },
          { type: 'image', mimeType: 'image/jpeg', dataBase64: 'Zm9v' },
        ],
      },
    ]);
    const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'この画像を見て' },
          { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,Zm9v' } },
        ],
      },
    ]);
  });

  test('文字列 content のパスは配列対応を追加しても出力が完全一致する', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      response({ choices: [{ message: { content: 'ok' } }] }),
    );
    const provider = new OpenAICompatibleProvider({
      apiKey: 'k',
      model: 'm',
      endpoint: 'https://llm.example/v1/chat/completions',
      fetch: fetchMock,
    });
    await provider.chat([{ role: 'user', content: 'q' }]);
    const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body.messages).toEqual([{ role: 'user', content: 'q' }]);
  });

  test('HTTP エラーを LlmProviderError にする', async () => {
    const fetchMock = jest.fn().mockResolvedValue(response({ error: 'bad' }, false, 401));
    const provider = new OpenAICompatibleProvider({
      apiKey: 'k',
      model: 'm',
      endpoint: 'https://llm.example/v1/chat/completions',
      fetch: fetchMock,
    });
    await expect(provider.chat([])).rejects.toMatchObject({
      name: 'LlmProviderError',
      providerId: 'openai_compatible',
      status: 401,
      responseBody: '{"error":"bad"}',
    } satisfies Partial<LlmProviderError>);
  });

  test('エラー本文を読めない場合と global fetch を扱う', async () => {
    const failedResponse = {
      ok: false,
      status: 500,
      text: async () => Promise.reject(new Error('unreadable')),
    } as unknown as Response;
    const globalFetch = jest.fn().mockResolvedValue(failedResponse);
    const original = globalThis.fetch;
    globalThis.fetch = globalFetch as unknown as typeof fetch;
    try {
      const provider = new OpenAICompatibleProvider({
        apiKey: 'k',
        model: 'm',
        endpoint: 'https://llm.example/v1/chat/completions',
      });
      await expect(provider.chat([])).rejects.toMatchObject({ responseBody: '' });
      expect(globalFetch).toHaveBeenCalled();
    } finally {
      globalThis.fetch = original;
    }
  });
});
