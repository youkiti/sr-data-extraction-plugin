// GeminiProvider（API キー方式 / systemInstruction 分離 / 構造化出力）の単体テスト
// （sr-query-builder から流用。nullable union → nullable 変換のテストを追加）
import { GeminiProvider, toGeminiSchema } from '../../../../src/lib/llm/GeminiProvider';
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

describe('GeminiProvider.chat', () => {
  test('user メッセージを contents に渡し、テキストを返す', async () => {
    const fetch = jest.fn().mockResolvedValue(
      jsonResponse({
        candidates: [
          {
            content: { parts: [{ text: 'Hello!' }], role: 'model' },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 },
      }),
    );
    const provider = new GeminiProvider({ apiKey: 'k', fetch });
    const result = await provider.chat([{ role: 'user', content: 'hi' }]);
    expect(result).toEqual({
      text: 'Hello!',
      tokensIn: 10,
      tokensOut: 20,
      raw: expect.any(Object),
    });
    expect(provider.providerId).toBe('gemini');
    expect(provider.model).toBe('gemini-3.5-flash');
    const [url, init] = fetch.mock.calls[0];
    expect(url).toContain('/models/gemini-3.5-flash:generateContent');
    expect(url).toContain('key=k');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'hi' }] }]);
    expect(body.systemInstruction).toBeUndefined();
    expect(body.generationConfig).toBeUndefined();
  });

  test('system メッセージは systemInstruction に分離される', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }));
    const provider = new GeminiProvider({ apiKey: 'k', fetch });
    await provider.chat([
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'q' },
    ]);
    const body = JSON.parse((fetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.systemInstruction).toEqual({ parts: [{ text: 'You are helpful.' }] });
    expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'q' }] }]);
  });

  test('model ロールはそのまま contents に入る', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }));
    const provider = new GeminiProvider({ apiKey: 'k', fetch });
    await provider.chat([
      { role: 'user', content: 'q1' },
      { role: 'model', content: 'a1' },
      { role: 'user', content: 'q2' },
    ]);
    const body = JSON.parse((fetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.contents.map((c: { role: string }) => c.role)).toEqual(['user', 'model', 'user']);
  });

  test('temperature / maxOutputTokens / responseFormat=json を generationConfig に反映する', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ candidates: [{ content: { parts: [{ text: '{}' }] } }] }));
    const provider = new GeminiProvider({ apiKey: 'k', fetch });
    await provider.chat([{ role: 'user', content: 'q' }], {
      temperature: 0.2,
      maxOutputTokens: 256,
      responseFormat: 'json',
    });
    const body = JSON.parse((fetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.generationConfig).toEqual({
      temperature: 0.2,
      maxOutputTokens: 256,
      responseMimeType: 'application/json',
    });
  });

  test('responseSchema を渡すと responseMimeType + 変換済み responseSchema を載せる', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ candidates: [{ content: { parts: [{ text: '{}' }] } }] }));
    const provider = new GeminiProvider({ apiKey: 'k', fetch });
    await provider.chat([{ role: 'user', content: 'q' }], {
      responseFormat: 'json',
      responseSchema: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
        additionalProperties: false,
      },
      temperature: 0.3,
    });
    const body = JSON.parse((fetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    // type は大文字 enum へ、additionalProperties は落ちる
    expect(body.generationConfig.responseSchema).toEqual({
      type: 'OBJECT',
      properties: { name: { type: 'STRING' } },
      required: ['name'],
    });
    expect(body.generationConfig.temperature).toBe(0.3);
  });

  test('responseFormat=text なら responseMimeType を付けない', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }));
    const provider = new GeminiProvider({ apiKey: 'k', fetch });
    await provider.chat([{ role: 'user', content: 'q' }], { responseFormat: 'text' });
    const body = JSON.parse((fetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.generationConfig).toBeUndefined();
  });

  test('複数 parts は連結してテキスト化、空 parts は除外', async () => {
    const fetch = jest.fn().mockResolvedValue(
      jsonResponse({
        candidates: [{ content: { parts: [{ text: 'foo' }, { text: '' }, { text: 'bar' }] } }],
      }),
    );
    const provider = new GeminiProvider({ apiKey: 'k', fetch });
    const r = await provider.chat([{ role: 'user', content: 'q' }]);
    expect(r.text).toBe('foobar');
  });

  test('parts に text が無いキーが混ざっても他の text パートを拾う', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ candidates: [{ content: { parts: [{}, { text: 'ok' }] } }] }));
    const provider = new GeminiProvider({ apiKey: 'k', fetch });
    const r = await provider.chat([{ role: 'user', content: 'q' }]);
    expect(r.text).toBe('ok');
  });

  // 応答内容の検査（issue #187）: 空応答・打ち切り・ボディ切断を原因付きで throw する
  describe('応答内容の検査（issue #187）', () => {
    test('candidates が無い場合は「本文がありません」で throw する', async () => {
      const fetch = jest.fn().mockResolvedValue(jsonResponse({}));
      const provider = new GeminiProvider({ apiKey: 'k', fetch });
      try {
        await provider.chat([{ role: 'user', content: 'q' }]);
        throw new Error('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(LlmProviderError);
        const e = err as LlmProviderError;
        expect(e.message).toContain('本文がありません');
        expect(e.message).toContain('finishReason=不明');
        expect(e.retryable).toBe(false);
      }
    });

    test('プロンプトがブロックされた場合は blockReason も message に載る', async () => {
      const fetch = jest
        .fn()
        .mockResolvedValue(jsonResponse({ promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } }));
      const provider = new GeminiProvider({ apiKey: 'k', fetch });
      await expect(provider.chat([{ role: 'user', content: 'q' }])).rejects.toThrow(
        'blockReason=PROHIBITED_CONTENT',
      );
    });

    test('finishReason=MAX_TOKENS は text があっても出力トークン上限の打ち切りとして throw', async () => {
      const fetch = jest.fn().mockResolvedValue(
        jsonResponse({
          candidates: [{ content: { parts: [{ text: '[{"trunca' }] }, finishReason: 'MAX_TOKENS' }],
        }),
      );
      const provider = new GeminiProvider({ apiKey: 'k', fetch });
      await expect(provider.chat([{ role: 'user', content: 'q' }])).rejects.toThrow(
        '出力トークン上限で打ち切られました（finishReason=MAX_TOKENS）',
      );
    });

    test('finishReason=RECITATION は引用チェックの打ち切りとして throw し、診断を responseBody に残す', async () => {
      const fetch = jest.fn().mockResolvedValue(
        jsonResponse({
          candidates: [{ content: { parts: [] }, finishReason: 'RECITATION' }],
        }),
      );
      const provider = new GeminiProvider({ apiKey: 'k', fetch });
      try {
        await provider.chat([{ role: 'user', content: 'q' }]);
        throw new Error('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(LlmProviderError);
        const e = err as LlmProviderError;
        expect(e.message).toContain('引用（recitation）チェックで打ち切られました');
        expect(JSON.parse(e.responseBody)).toEqual({ finishReason: 'RECITATION', blockReason: null });
      }
    });

    test('未知の finishReason はそのままラベルとして message に載る', async () => {
      const fetch = jest.fn().mockResolvedValue(
        jsonResponse({
          candidates: [{ content: { parts: [{ text: 'x' }] }, finishReason: 'NEW_REASON' }],
        }),
      );
      const provider = new GeminiProvider({ apiKey: 'k', fetch });
      await expect(provider.chat([{ role: 'user', content: 'q' }])).rejects.toThrow(
        'NEW_REASONで打ち切られました',
      );
    });

    test('HTTP 200 でもボディが JSON として読めなければ retryable な LlmProviderError（切断疑い）', async () => {
      const fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => '{"candidates":[{"content":{"par',
      } as unknown as Response);
      const provider = new GeminiProvider({ apiKey: 'k', fetch });
      try {
        await provider.chat([{ role: 'user', content: 'q' }]);
        throw new Error('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(LlmProviderError);
        const e = err as LlmProviderError;
        expect(e.message).toContain('JSON として読めません');
        expect(e.retryable).toBe(true);
        expect(e.status).toBe(200);
      }
    });
  });

  test('model オプションを反映する', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }));
    const provider = new GeminiProvider({ apiKey: 'k', model: 'gemini-2.5-pro', fetch });
    await provider.chat([{ role: 'user', content: 'q' }]);
    const url = fetch.mock.calls[0][0] as string;
    expect(url).toContain('/models/gemini-2.5-pro:');
  });

  test('HTTP エラーは LlmProviderError', async () => {
    const fetch = jest.fn().mockResolvedValue(errorResponse(429, 'rate limit'));
    const provider = new GeminiProvider({ apiKey: 'k', fetch });
    try {
      await provider.chat([{ role: 'user', content: 'q' }]);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(LlmProviderError);
      const e = err as LlmProviderError;
      expect(e.status).toBe(429);
      expect(e.responseBody).toBe('rate limit');
      expect(e.providerId).toBe('gemini');
    }
  });

  test('429 の Retry-After ヘッダ（秒）を retryAfterMs に載せる', async () => {
    const fetch = jest.fn().mockResolvedValue(errorResponse(429, 'rate limit', '30'));
    const provider = new GeminiProvider({ apiKey: 'k', fetch });
    await expect(provider.chat([{ role: 'user', content: 'q' }])).rejects.toMatchObject({
      status: 429,
      retryAfterMs: 30_000,
    });
  });

  test('Retry-After ヘッダが無ければ retryAfterMs は null', async () => {
    const fetch = jest.fn().mockResolvedValue(errorResponse(500, 'boom'));
    const provider = new GeminiProvider({ apiKey: 'k', fetch });
    await expect(provider.chat([{ role: 'user', content: 'q' }])).rejects.toMatchObject({
      status: 500,
      retryAfterMs: null,
    });
  });

  test('text() が失敗しても空文字で吸収して LlmProviderError を投げる', async () => {
    const failingRes = {
      ok: false,
      status: 500,
      json: async () => ({}),
      text: async (): Promise<string> => {
        throw new Error('net');
      },
      headers: { get: () => null },
    } as unknown as Response;
    const fetch = jest.fn().mockResolvedValue(failingRes);
    const provider = new GeminiProvider({ apiKey: 'k', fetch });
    await expect(provider.chat([{ role: 'user', content: 'q' }])).rejects.toMatchObject({
      status: 500,
      responseBody: '',
    });
  });

  test('既定の fetch を使ったコンストラクタ（注入なし）', () => {
    // fetch が globalThis に無い jsdom 環境では作るだけは成功する
    const provider = new GeminiProvider({ apiKey: 'k' });
    expect(provider.providerId).toBe('gemini');
  });

  test('supportsImageInput は true（Gemini はネイティブ対応）', () => {
    const provider = new GeminiProvider({ apiKey: 'k' });
    expect(provider.supportsImageInput).toBe(true);
  });

  test('パート配列 content（text + image）は parts へ inlineData で写す', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }));
    const provider = new GeminiProvider({ apiKey: 'k', fetch });
    await provider.chat([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'この画像の項目を抽出して' },
          { type: 'image', mimeType: 'image/png', dataBase64: 'aGVsbG8=' },
        ],
      },
    ]);
    const body = JSON.parse((fetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.contents).toEqual([
      {
        role: 'user',
        parts: [
          { text: 'この画像の項目を抽出して' },
          { inlineData: { mimeType: 'image/png', data: 'aGVsbG8=' } },
        ],
      },
    ]);
  });

  test('system メッセージがパート配列でも text パートのみ systemInstruction に採用し、image は無視する', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }));
    const provider = new GeminiProvider({ apiKey: 'k', fetch });
    await provider.chat([
      {
        role: 'system',
        content: [
          { type: 'text', text: 'あなたは抽出アシスタントです。' },
          { type: 'image', mimeType: 'image/png', dataBase64: 'ZGF0YQ==' },
          { type: 'text', text: '厳密に抽出すること。' },
        ],
      },
      { role: 'user', content: 'q' },
    ]);
    const body = JSON.parse((fetch.mock.calls[0][1] as RequestInit).body as string);
    // image パートは無視され、text パートのみ連結される（[image ...] プレースホルダも混入しない）
    expect(body.systemInstruction).toEqual({
      parts: [{ text: 'あなたは抽出アシスタントです。厳密に抽出すること。' }],
    });
  });

  test('文字列 content のパスは配列対応を追加しても出力が完全一致する', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }));
    const provider = new GeminiProvider({ apiKey: 'k', fetch });
    await provider.chat([
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'q' },
      { role: 'model', content: 'a' },
    ]);
    const body = JSON.parse((fetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.systemInstruction).toEqual({ parts: [{ text: 'You are helpful.' }] });
    expect(body.contents).toEqual([
      { role: 'user', parts: [{ text: 'q' }] },
      { role: 'model', parts: [{ text: 'a' }] },
    ]);
  });

  test('fetch 未注入なら globalThis.fetch にフォールバックする', async () => {
    const stub = jest
      .fn()
      .mockResolvedValue(jsonResponse({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }));
    const original = (globalThis as { fetch?: typeof fetch }).fetch;
    (globalThis as { fetch?: typeof fetch }).fetch = stub as unknown as typeof fetch;
    try {
      const provider = new GeminiProvider({ apiKey: 'k' });
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

describe('toGeminiSchema', () => {
  test('type を大文字 enum に写し、未対応キーを落とす', () => {
    expect(
      toGeminiSchema({
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'd' },
          items: { type: 'array', items: { type: 'string' } },
        },
        required: ['summary', 'items'],
        additionalProperties: false,
        $schema: 'http://json-schema.org/draft-07/schema#',
      }),
    ).toEqual({
      type: 'OBJECT',
      properties: {
        summary: { type: 'STRING', description: 'd' },
        items: { type: 'ARRAY', items: { type: 'STRING' } },
      },
      required: ['summary', 'items'],
    });
  });

  test('enum はそのまま保持する', () => {
    expect(toGeminiSchema({ type: 'string', enum: ['a', 'b'] })).toEqual({
      type: 'STRING',
      enum: ['a', 'b'],
    });
  });

  test('nullable union（type: [T, null]）は type + nullable: true に写す', () => {
    expect(toGeminiSchema({ type: ['string', 'null'] })).toEqual({
      type: 'STRING',
      nullable: true,
    });
    expect(toGeminiSchema({ type: ['integer', 'null'] })).toEqual({
      type: 'INTEGER',
      nullable: true,
    });
  });

  test('null を含まない配列 type は単型として写し、nullable を付けない', () => {
    expect(toGeminiSchema({ type: ['string'] })).toEqual({ type: 'STRING' });
  });

  test('解決できない配列 type（多型 union / 未知型）は type ごと落とす', () => {
    expect(toGeminiSchema({ type: ['string', 'integer'] })).toEqual({});
    expect(toGeminiSchema({ type: ['mystery', 'null'] })).toEqual({});
  });

  test('type が文字列でも配列でもない場合は落とす', () => {
    expect(toGeminiSchema({ type: 42 })).toEqual({});
  });

  test('未知の型名（文字列）は type ごと落とす', () => {
    expect(toGeminiSchema({ type: 'mystery' })).toEqual({});
  });

  test('enum の null は取り除いて nullable: true に写す（extract-data の confidence）', () => {
    expect(toGeminiSchema({ type: ['string', 'null'], enum: ['high', 'medium', 'low', null] })).toEqual(
      {
        type: 'STRING',
        nullable: true,
        enum: ['high', 'medium', 'low'],
      },
    );
  });

  test('enum が配列でない場合はそのまま通す（プロバイダ側でエラーにさせる）', () => {
    expect(toGeminiSchema({ enum: 'oops' })).toEqual({ enum: 'oops' });
  });
});
