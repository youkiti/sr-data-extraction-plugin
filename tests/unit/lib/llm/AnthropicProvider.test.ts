// AnthropicProvider（固定認証ヘッダー / system 分離 / 構造化出力方言変換）の単体テスト（issue #127 PR1）
import { AnthropicProvider, toAnthropicSchema } from '../../../../src/lib/llm/AnthropicProvider';
import {
  EXTRACT_DATA_RESPONSE_SCHEMA,
  extractDataResponseSchema,
} from '../../../../src/features/extraction/skills/extractData';

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

describe('AnthropicProvider.chat', () => {
  test('user メッセージを messages に渡し、テキストを返す（固定ヘッダー3種・max_tokens既定・effort既定）', async () => {
    const fetch = jest.fn().mockResolvedValue(
      jsonResponse({
        content: [{ type: 'text', text: 'Hello!' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
    );
    const provider = new AnthropicProvider({ apiKey: 'sk-ant-xxx', model: 'claude-opus-5', fetch });
    const result = await provider.chat([{ role: 'user', content: 'hi' }]);
    expect(result).toEqual({ text: 'Hello!', tokensIn: 10, tokensOut: 20, raw: expect.any(Object) });
    expect(provider.providerId).toBe('anthropic');
    expect(provider.model).toBe('claude-opus-5');
    expect(provider.supportsImageInput).toBe(true);

    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'x-api-key': 'sk-ant-xxx',
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    });
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      model: 'claude-opus-5',
      max_tokens: 16000,
      messages: [{ role: 'user', content: 'hi' }],
      output_config: { effort: 'low' },
    });
    expect(body.system).toBeUndefined();
    expect(body.thinking).toBeUndefined();
  });

  test('role: model は assistant へ、system メッセージは複数あれば結合してトップレベル system へ写す', async () => {
    const fetch = jest.fn().mockResolvedValue(
      jsonResponse({
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        usage: {},
      }),
    );
    const provider = new AnthropicProvider({ apiKey: 'k', model: 'claude-sonnet-5', fetch });
    await provider.chat([
      { role: 'system', content: 's1' },
      { role: 'system', content: 's2' },
      { role: 'user', content: 'u' },
      { role: 'model', content: 'a' },
    ]);
    const init = fetch.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body.system).toBe('s1\n\ns2');
    expect(body.messages).toEqual([
      { role: 'user', content: 'u' },
      { role: 'assistant', content: 'a' },
    ]);
  });

  test('system メッセージのパート配列は text パートだけを連結する（image パートは無視）', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }));
    const provider = new AnthropicProvider({ apiKey: 'k', model: 'claude-haiku-4-5', fetch });
    await provider.chat([
      {
        role: 'system',
        content: [
          { type: 'text', text: 'a' },
          { type: 'image', mimeType: 'image/png', dataBase64: 'zzz' },
          { type: 'text', text: 'b' },
        ],
      },
      { role: 'user', content: 'u' },
    ]);
    const body = JSON.parse((fetch.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body.system).toBe('ab');
  });

  test('パート配列 content（text + image）は Anthropic の image ブロックに写す', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }));
    const provider = new AnthropicProvider({ apiKey: 'k', model: 'claude-opus-5', fetch });
    await provider.chat([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'see this' },
          { type: 'image', mimeType: 'image/png', dataBase64: 'aGVsbG8=' },
        ],
      },
    ]);
    const body = JSON.parse((fetch.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'see this' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' } },
        ],
      },
    ]);
  });

  test('maxOutputTokens を指定すれば max_tokens へ反映する', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }));
    const provider = new AnthropicProvider({ apiKey: 'k', model: 'claude-opus-5', fetch });
    await provider.chat([{ role: 'user', content: 'u' }], { maxOutputTokens: 4096 });
    const body = JSON.parse((fetch.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body.max_tokens).toBe(4096);
  });

  test('temperature を指定しても body には含めない（claude-opus-5 / claude-sonnet-5 等はサンプリングパラメータ非サポートで 400 になるため）', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }));
    const provider = new AnthropicProvider({ apiKey: 'k', model: 'claude-opus-5', fetch });
    await provider.chat([{ role: 'user', content: 'u' }], { temperature: 0.2 });
    const body = JSON.parse((fetch.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body).not.toHaveProperty('temperature');
    expect(Object.keys(body)).not.toContain('temperature');
  });

  test('claude-haiku-4-5 は output_config.effort を送らない（Haiku 4.5 は effort 非サポートで 400 になるため）', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }));
    const provider = new AnthropicProvider({ apiKey: 'k', model: 'claude-haiku-4-5', fetch });
    await provider.chat([{ role: 'user', content: 'u' }]);
    const body = JSON.parse((fetch.mock.calls[0]?.[1] as RequestInit).body as string);
    // responseSchema も無いため output_config 自体が空になり、フィールドごと省略される
    expect(body).not.toHaveProperty('output_config');
  });

  test('claude-haiku-4-5 + responseSchema は output_config.format のみ送り、effort は含めない', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ content: [{ type: 'text', text: '[]' }], stop_reason: 'end_turn' }));
    const provider = new AnthropicProvider({ apiKey: 'k', model: 'claude-haiku-4-5', fetch });
    const schema = { type: 'object' };
    await provider.chat([{ role: 'user', content: 'u' }], { responseSchema: schema });
    const body = JSON.parse((fetch.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body.output_config).toEqual({
      format: { type: 'json_schema', schema: toAnthropicSchema(schema) },
    });
    expect(body.output_config).not.toHaveProperty('effort');
  });

  test('claude-opus-5 / claude-sonnet-5 のような effort 対応モデルは既定で effort:low を送る', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }));
    const provider = new AnthropicProvider({ apiKey: 'k', model: 'claude-sonnet-5', fetch });
    await provider.chat([{ role: 'user', content: 'u' }]);
    const body = JSON.parse((fetch.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body.output_config).toEqual({ effort: 'low' });
  });

  test('responseSchema を渡すと output_config.format = json_schema（toAnthropicSchema 変換込み）で要求する', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ content: [{ type: 'text', text: '[]' }], stop_reason: 'end_turn' }));
    const provider = new AnthropicProvider({ apiKey: 'k', model: 'claude-opus-5', fetch });
    const schema = { type: ['string', 'null'] };
    await provider.chat([{ role: 'user', content: 'u' }], { responseFormat: 'json', responseSchema: schema });
    const body = JSON.parse((fetch.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body.output_config).toEqual({
      effort: 'low',
      format: { type: 'json_schema', schema: toAnthropicSchema(schema) },
    });
  });

  test('thinking block はテキスト抽出から除外し、text block だけを連結する', async () => {
    const fetch = jest.fn().mockResolvedValue(
      jsonResponse({
        content: [
          { type: 'thinking', thinking: '' },
          { type: 'text', text: 'a' },
          { type: 'text', text: 'b' },
        ],
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 2 },
      }),
    );
    const provider = new AnthropicProvider({ apiKey: 'k', model: 'claude-opus-5', fetch });
    const result = await provider.chat([{ role: 'user', content: 'u' }]);
    expect(result.text).toBe('ab');
  });

  describe('HTTP エラー応答', () => {
    test('HTTP 400 は retryable=false・failureKind=null で例外化する', async () => {
      const fetch = jest.fn().mockResolvedValue(errorResponse(400, 'bad schema'));
      const provider = new AnthropicProvider({ apiKey: 'k', model: 'claude-opus-5', fetch });
      await expect(provider.chat([{ role: 'user', content: 'u' }])).rejects.toMatchObject({
        status: 400,
        responseBody: 'bad schema',
        retryable: false,
        failureKind: null,
      });
    });

    test('構造化出力が 400 で弾かれたときも原因（メッセージ・応答本文）が分かる例外になる', async () => {
      const fetch = jest
        .fn()
        .mockResolvedValue(
          errorResponse(400, JSON.stringify({ error: { message: 'schema is invalid: unsupported keyword' } })),
        );
      const provider = new AnthropicProvider({ apiKey: 'k', model: 'claude-opus-5', fetch });
      await expect(
        provider.chat([{ role: 'user', content: 'u' }], { responseSchema: { type: 'object' } }),
      ).rejects.toMatchObject({
        status: 400,
        responseBody: expect.stringContaining('unsupported keyword'),
        providerId: 'anthropic',
      });
    });

    test('HTTP 429 は retry-after ヘッダを retryAfterMs へ、failureKind は null のまま', async () => {
      const fetch = jest.fn().mockResolvedValue(errorResponse(429, 'rate limited', '3'));
      const provider = new AnthropicProvider({ apiKey: 'k', model: 'claude-opus-5', fetch });
      await expect(provider.chat([{ role: 'user', content: 'u' }])).rejects.toMatchObject({
        status: 429,
        retryAfterMs: 3000,
        failureKind: null,
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
      const provider = new AnthropicProvider({ apiKey: 'k', model: 'claude-opus-5', fetch });
      await expect(provider.chat([{ role: 'user', content: 'u' }])).rejects.toMatchObject({
        status: 500,
        responseBody: '',
      });
    });

    test('HTTP 529（overloaded_error）は retryable=true として扱う', async () => {
      const fetch = jest.fn().mockResolvedValue(errorResponse(529, 'overloaded'));
      const provider = new AnthropicProvider({ apiKey: 'k', model: 'claude-opus-5', fetch });
      await expect(provider.chat([{ role: 'user', content: 'u' }])).rejects.toMatchObject({
        status: 529,
        retryable: true,
        failureKind: null,
      });
    });
  });

  describe('応答内容の検査（stop_reason 分岐）', () => {
    test('応答ボディが JSON として読めない場合は malformed・retryable', async () => {
      const fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => 'not json{{{',
      } as unknown as Response);
      const provider = new AnthropicProvider({ apiKey: 'k', model: 'claude-opus-5', fetch });
      await expect(provider.chat([{ role: 'user', content: 'u' }])).rejects.toMatchObject({
        retryable: true,
        failureKind: 'malformed',
      });
    });

    test('stop_reason=refusal かつ content が空配列でも例外を投げず content_filter として扱う', async () => {
      const fetch = jest.fn().mockResolvedValue(
        jsonResponse({
          content: [],
          stop_reason: 'refusal',
          stop_details: { type: 'refusal', category: null, explanation: null },
        }),
      );
      const provider = new AnthropicProvider({ apiKey: 'k', model: 'claude-opus-5', fetch });
      await expect(provider.chat([{ role: 'user', content: 'u' }])).rejects.toMatchObject({
        failureKind: 'content_filter',
      });
    });

    test('stop_reason=refusal かつ content に部分本文があっても content_filter として扱う（stop_details ではなく stop_reason で分岐）', async () => {
      const fetch = jest.fn().mockResolvedValue(
        jsonResponse({
          content: [{ type: 'text', text: '途中まで' }],
          stop_reason: 'refusal',
          stop_details: null,
        }),
      );
      const provider = new AnthropicProvider({ apiKey: 'k', model: 'claude-opus-5', fetch });
      await expect(provider.chat([{ role: 'user', content: 'u' }])).rejects.toMatchObject({
        failureKind: 'content_filter',
      });
    });

    test('stop_reason=max_tokens は output_limit として扱う', async () => {
      const fetch = jest.fn().mockResolvedValue(
        jsonResponse({
          content: [{ type: 'text', text: '途中' }],
          stop_reason: 'max_tokens',
        }),
      );
      const provider = new AnthropicProvider({ apiKey: 'k', model: 'claude-opus-5', fetch });
      await expect(provider.chat([{ role: 'user', content: 'u' }])).rejects.toMatchObject({
        failureKind: 'output_limit',
      });
    });

    test('text block が無い（thinking のみ等）場合は本文なしエラー（failureKind は不明のまま null）', async () => {
      const fetch = jest.fn().mockResolvedValue(
        jsonResponse({
          content: [{ type: 'thinking', thinking: '' }],
          stop_reason: 'end_turn',
        }),
      );
      const provider = new AnthropicProvider({ apiKey: 'k', model: 'claude-opus-5', fetch });
      await expect(provider.chat([{ role: 'user', content: 'u' }])).rejects.toMatchObject({
        failureKind: null,
      });
    });

    test('content / stop_reason が両方欠落した応答も本文なしエラーになる（"不明" 表示に倒れる）', async () => {
      const fetch = jest.fn().mockResolvedValue(jsonResponse({}));
      const provider = new AnthropicProvider({ apiKey: 'k', model: 'claude-opus-5', fetch });
      await expect(provider.chat([{ role: 'user', content: 'u' }])).rejects.toMatchObject({
        message: expect.stringContaining('不明'),
        failureKind: null,
      });
    });

    test('text ブロックに text フィールドが無い場合は空文字として連結する', async () => {
      const fetch = jest.fn().mockResolvedValue(
        jsonResponse({
          content: [{ type: 'text' }, { type: 'text', text: 'x' }],
          stop_reason: 'end_turn',
        }),
      );
      const provider = new AnthropicProvider({ apiKey: 'k', model: 'claude-opus-5', fetch });
      const result = await provider.chat([{ role: 'user', content: 'u' }]);
      expect(result.text).toBe('x');
    });
  });

  test('fetch 未注入時は globalThis.fetch を使う', async () => {
    const original = globalThis.fetch;
    const mock = jest
      .fn()
      .mockResolvedValue(jsonResponse({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }));
    globalThis.fetch = mock as unknown as typeof fetch;
    try {
      const provider = new AnthropicProvider({ apiKey: 'k', model: 'claude-opus-5' });
      const result = await provider.chat([{ role: 'user', content: 'u' }]);
      expect(result.text).toBe('ok');
      expect(mock).toHaveBeenCalled();
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('toAnthropicSchema', () => {
  test('type: string はそのまま通す', () => {
    expect(toAnthropicSchema({ type: 'string' })).toEqual({ type: 'string' });
  });

  test('型の配列は anyOf へ変換する（null 以外の型ぶんの枝 + null 枝）', () => {
    expect(toAnthropicSchema({ type: ['string', 'null'] })).toEqual({
      anyOf: [{ type: 'string' }, { type: 'null' }],
    });
    expect(toAnthropicSchema({ type: ['integer', 'null'] })).toEqual({
      anyOf: [{ type: 'integer' }, { type: 'null' }],
    });
  });

  test('null を含まない型配列は null 枝を付けない', () => {
    expect(toAnthropicSchema({ type: ['string'] })).toEqual({ anyOf: [{ type: 'string' }] });
  });

  test('enum に null を含む複合型は enum から null を除いて非 null 側の枝へ付ける', () => {
    expect(
      toAnthropicSchema({ type: ['string', 'null'], enum: ['high', 'medium', 'low', null] }),
    ).toEqual({
      anyOf: [{ type: 'string', enum: ['high', 'medium', 'low'] }, { type: 'null' }],
    });
  });

  test('maxItems は必ず削除する', () => {
    expect(toAnthropicSchema({ type: 'array', items: { type: 'string' }, maxItems: 5 })).toEqual({
      type: 'array',
      items: { type: 'string' },
    });
  });

  test('minItems は 0 または 1 のときだけ残し、それ以外（例: 4）は削除する', () => {
    expect(toAnthropicSchema({ type: 'array', items: { type: 'string' }, minItems: 0 })).toEqual({
      type: 'array',
      items: { type: 'string' },
      minItems: 0,
    });
    expect(toAnthropicSchema({ type: 'array', items: { type: 'string' }, minItems: 1 })).toEqual({
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
    });
    expect(toAnthropicSchema({ type: 'array', items: { type: 'string' }, minItems: 4 })).toEqual({
      type: 'array',
      items: { type: 'string' },
    });
  });

  test('型配列 + minItems/maxItems 同居（box_2d 相当）は anyOf の array 枝へ items だけ引き継ぎ minItems/maxItems は落ちる', () => {
    expect(
      toAnthropicSchema({
        type: ['array', 'null'],
        items: { type: 'integer' },
        minItems: 4,
        maxItems: 4,
      }),
    ).toEqual({
      anyOf: [{ type: 'array', items: { type: 'integer' } }, { type: 'null' }],
    });
  });

  test('additionalProperties: false はそのまま維持する', () => {
    expect(
      toAnthropicSchema({
        type: 'object',
        properties: { a: { type: 'string' } },
        required: ['a'],
        additionalProperties: false,
      }),
    ).toEqual({
      type: 'object',
      properties: { a: { type: 'string' } },
      required: ['a'],
      additionalProperties: false,
    });
  });

  test('properties / items はネストして再帰的に変換する', () => {
    expect(
      toAnthropicSchema({
        type: 'object',
        properties: {
          child: {
            type: 'object',
            properties: { v: { type: ['string', 'null'] } },
            additionalProperties: false,
          },
        },
        additionalProperties: false,
      }),
    ).toEqual({
      type: 'object',
      properties: {
        child: {
          type: 'object',
          properties: { v: { anyOf: [{ type: 'string' }, { type: 'null' }] } },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    });
  });

  test('ルートの type:array はそのままパススルーする（ラップしない）', () => {
    const out = toAnthropicSchema({ type: 'array', items: { type: 'string' } });
    expect(out['type']).toBe('array');
    expect(out['anyOf']).toBeUndefined();
  });

  test('EXTRACT_DATA_RESPONSE_SCHEMA 全体を変換できる', () => {
    const out = toAnthropicSchema(EXTRACT_DATA_RESPONSE_SCHEMA);
    expect(out['type']).toBe('array');
    const items = out['items'] as Record<string, unknown>;
    const properties = items['properties'] as Record<string, unknown>;
    expect(properties['field_id']).toEqual({ type: 'string' });
    expect(properties['value']).toEqual({ anyOf: [{ type: 'string' }, { type: 'null' }] });
    expect(properties['confidence']).toEqual({
      anyOf: [{ type: 'string', enum: ['high', 'medium', 'low'] }, { type: 'null' }],
    });
    expect(items['additionalProperties']).toBe(false);
    expect(items['required']).toEqual(
      (EXTRACT_DATA_RESPONSE_SCHEMA['items'] as Record<string, unknown>)['required'],
    );
  });

  test('extractDataResponseSchema(true) の box_2d は anyOf 化 + minItems/maxItems 両方削除で変換できる', () => {
    const schema = extractDataResponseSchema(true);
    const out = toAnthropicSchema(schema);
    const items = out['items'] as Record<string, unknown>;
    const properties = items['properties'] as Record<string, unknown>;
    expect(properties['box_2d']).toEqual({
      anyOf: [{ type: 'array', items: { type: 'integer' } }, { type: 'null' }],
    });
    expect((items['required'] as string[]).includes('box_2d')).toBe(true);
  });
});
