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

  test('JSON mode と省略応答を扱う', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(response({ choices: [{ message: { content: null } }] }))
      .mockResolvedValueOnce(response({}));
    const provider = new OpenAICompatibleProvider({
      apiKey: 'k',
      model: 'm',
      endpoint: 'https://llm.example/v1/chat/completions',
      fetch: fetchMock,
    });
    await expect(
      provider.chat([{ role: 'user', content: 'q' }], { responseFormat: 'json' }),
    ).resolves.toEqual(expect.objectContaining({ text: '', tokensIn: null, tokensOut: null }));
    const firstBody = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(firstBody.response_format).toEqual({ type: 'json_object' });
    await expect(provider.chat([])).resolves.toEqual(
      expect.objectContaining({ text: '', tokensIn: null, tokensOut: null }),
    );
    const secondBody = JSON.parse((fetchMock.mock.calls[1]?.[1] as RequestInit).body as string);
    expect(secondBody).toEqual({ model: 'm', messages: [] });
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
