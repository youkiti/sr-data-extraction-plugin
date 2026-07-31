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

  // issue #127 PR5: reasoning effort の設定化。「未指定 → 従来どおり body を一切変えない」が
  // 最重要の受け入れ条件（既存ユーザーの body はバイト単位で不変であること。Azure OpenAI も
  // このクラスを流用するため authMode: 'azure_api_key' でも同じ契約が成り立つ必要がある）
  describe('reasoning effort（issue #127 PR5）', () => {
    test('未指定（construction / 呼び出し 1 回ぶんとも）なら body は従来どおり（reasoning_effort を持たない）', async () => {
      const fetchMock = jest
        .fn()
        .mockResolvedValue(response({ choices: [{ message: { content: 'ok' } }] }));
      const provider = new OpenAICompatibleProvider({
        apiKey: 'secret',
        model: 'org/model',
        endpoint: 'https://llm.example/v1/chat/completions',
        fetch: fetchMock,
      });
      await provider.chat([{ role: 'user', content: 'u' }]);
      const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
      expect(JSON.parse(init.body as string)).toEqual({
        model: 'org/model',
        messages: [{ role: 'user', content: 'u' }],
      });
    });

    test('construction 時に reasoningEffort: null を渡しても body は従来どおり', async () => {
      const fetchMock = jest
        .fn()
        .mockResolvedValue(response({ choices: [{ message: { content: 'ok' } }] }));
      const provider = new OpenAICompatibleProvider({
        apiKey: 'secret',
        model: 'org/model',
        endpoint: 'https://llm.example/v1/chat/completions',
        fetch: fetchMock,
        reasoningEffort: null,
      });
      await provider.chat([{ role: 'user', content: 'u' }]);
      const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
      expect(JSON.parse(init.body as string)).not.toHaveProperty('reasoning_effort');
    });

    test('construction 時の reasoningEffort（Options 既定値）を reasoning_effort へ写す（Azure OpenAI 経由も含む）', async () => {
      const fetchMock = jest
        .fn()
        .mockResolvedValue(response({ choices: [{ message: { content: 'ok' } }] }));
      const provider = new OpenAICompatibleProvider({
        apiKey: 'secret',
        model: 'gpt-4o-deployment',
        endpoint: 'https://res.openai.azure.com/openai/deployments/gpt-4o-deployment/chat/completions?api-version=2026-01-01',
        fetch: fetchMock,
        authMode: 'azure_api_key',
        reasoningEffort: 'low',
      });
      await provider.chat([{ role: 'user', content: 'u' }]);
      const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
      expect(JSON.parse(init.body as string).reasoning_effort).toBe('low');
    });

    test('呼び出し 1 回ぶんの ChatOptions.reasoningEffort が construction 時の既定より優先する', async () => {
      const fetchMock = jest
        .fn()
        .mockResolvedValue(response({ choices: [{ message: { content: 'ok' } }] }));
      const provider = new OpenAICompatibleProvider({
        apiKey: 'secret',
        model: 'org/model',
        endpoint: 'https://llm.example/v1/chat/completions',
        fetch: fetchMock,
        reasoningEffort: 'low',
      });
      await provider.chat([{ role: 'user', content: 'u' }], { reasoningEffort: 'high' });
      const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
      expect(JSON.parse(init.body as string).reasoning_effort).toBe('high');
    });
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

  // issue #127 PR5 レビュー対応: reasoning_effort 拒否の一度きりの縮退フォールバック
  // （requirements.md §10 Q11。任意の利用者指定エンドポイント — localhost の llama.cpp /
  // LM Studio / Ollama 等 — が reasoning_effort を知らずに 400/422 を返すケースを救済する）
  describe('reasoning_effort 拒否の縮退フォールバック（issue #127 PR5 レビュー対応）', () => {
    test('reasoning_effort 拒否の 400 は 1 回だけ落として再送し、成功する', async () => {
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce(
          response({ error: "Unsupported parameter: 'reasoning_effort'" }, false, 400),
        )
        .mockResolvedValueOnce(response({ choices: [{ message: { content: 'ok' } }] }));
      const provider = new OpenAICompatibleProvider({
        apiKey: 'k',
        model: 'm',
        endpoint: 'https://llm.example/v1/chat/completions',
        fetch: fetchMock,
        reasoningEffort: 'high',
      });
      const result = await provider.chat([{ role: 'user', content: 'u' }]);
      expect(result.text).toBe('ok');
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const firstBody = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string);
      const secondBody = JSON.parse((fetchMock.mock.calls[1]?.[1] as RequestInit).body as string);
      expect(firstBody.reasoning_effort).toBe('high');
      expect(secondBody).not.toHaveProperty('reasoning_effort');
    });

    test('reasoning_effort 拒否の縮退は 1 回だけ（2 回目も reasoning_effort 拒否なら例外化する）', async () => {
      const fetchMock = jest
        .fn()
        .mockResolvedValue(
          response({ error: "Unsupported parameter: 'reasoning_effort'" }, false, 400),
        );
      const provider = new OpenAICompatibleProvider({
        apiKey: 'k',
        model: 'm',
        endpoint: 'https://llm.example/v1/chat/completions',
        fetch: fetchMock,
        reasoningEffort: 'high',
      });
      await expect(provider.chat([{ role: 'user', content: 'u' }])).rejects.toMatchObject({
        status: 400,
      });
      // 1 回目（reasoning_effort あり）→ 縮退して 2 回目（reasoning_effort なし）→ 失敗して即例外化。
      // 3 回目は無い（一度きりであることの固定）
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    test('reasoning_effort 拒否は HTTP 422 でも同様に 1 回だけ落として再送する', async () => {
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce(
          response({ error: "Invalid parameter: 'reasoning_effort'" }, false, 422),
        )
        .mockResolvedValueOnce(response({ choices: [{ message: { content: 'ok' } }] }));
      const provider = new OpenAICompatibleProvider({
        apiKey: 'k',
        model: 'm',
        endpoint: 'https://llm.example/v1/chat/completions',
        fetch: fetchMock,
        reasoningEffort: 'low',
      });
      const result = await provider.chat([{ role: 'user', content: 'u' }]);
      expect(result.text).toBe('ok');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    test('reasoning_effort 未設定なら拒否メッセージが来ても新しい再試行を起こさない（既存挙動の保護）', async () => {
      const fetchMock = jest.fn().mockResolvedValue(
        response({ error: "Unsupported parameter: 'reasoning_effort'" }, false, 400),
      );
      const provider = new OpenAICompatibleProvider({
        apiKey: 'k',
        model: 'm',
        endpoint: 'https://llm.example/v1/chat/completions',
        fetch: fetchMock,
      });
      await expect(provider.chat([{ role: 'user', content: 'u' }])).rejects.toMatchObject({
        status: 400,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    test('reasoning_effort 拒否でも構造化出力でもない 400 は即座に例外化する（新しい黙示的リトライを追加しない）', async () => {
      const fetchMock = jest.fn().mockResolvedValue(response({ error: 'model not found' }, false, 400));
      const provider = new OpenAICompatibleProvider({
        apiKey: 'k',
        model: 'missing',
        endpoint: 'https://llm.example/v1/chat/completions',
        fetch: fetchMock,
        reasoningEffort: 'high',
      });
      await expect(provider.chat([{ role: 'user', content: 'u' }])).rejects.toMatchObject({
        status: 400,
        responseBody: '{"error":"model not found"}',
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    test('構造化出力の縮退と reasoning_effort の縮退が絡んでも、互いをトリガーし返す（ping-pong する）ことなく決定的に終わる', async () => {
      const fetchMock = jest
        .fn()
        // 1 回目: mode=json_schema_strict（既定）+ reasoning_effort あり → strict 非対応で
        //         構造化出力側だけが 1 段階進む（reasoning_effort 側は未反応。文言が一致しないため）
        .mockResolvedValueOnce(response({ error: 'strict unsupported' }, false, 400))
        // 2 回目: mode=json_schema（strict なし）+ reasoning_effort あり → reasoning_effort 拒否。
        //         mode には触れず reasoning_effort だけを 1 回きり落として同じ mode で再送する
        .mockResolvedValueOnce(
          response({ error: "Unsupported parameter: 'reasoning_effort'" }, false, 400),
        )
        // 3 回目: mode=json_schema（reasoning_effort は既に無し）→ それでも構造化出力非互換 →
        //         json_object へ 1 段階進む（reasoning_effort はもう縮退済みなので再度は反応しない）
        .mockResolvedValueOnce(response({ error: 'json_schema unsupported' }, false, 422))
        // 4 回目: mode=json_object（reasoning_effort なし）→ 成功
        .mockResolvedValueOnce(response({ choices: [{ message: { content: 'ok' } }] }));
      const provider = new OpenAICompatibleProvider({
        apiKey: 'k',
        model: 'm',
        endpoint: 'https://llm.example/v1/chat/completions',
        fetch: fetchMock,
        reasoningEffort: 'medium',
      });
      const result = await provider.chat([], { responseSchema: { type: 'object' } });
      expect(result.text).toBe('ok');
      // ちょうど 4 回（3 段の mode カスケード分 + reasoning_effort の 1 回きり縮退分）で終わる。
      // 両者が互いを再トリガーし続ける ping-pong なら 4 回では終わらない
      expect(fetchMock).toHaveBeenCalledTimes(4);
      const bodies = fetchMock.mock.calls.map((call) =>
        JSON.parse((call[1] as RequestInit).body as string),
      );
      // 構造化出力側: strict → 素の json_schema（2・3 回目は同じ mode のまま）→ json_object
      expect(bodies[0].response_format.json_schema).toEqual({
        name: 'response',
        strict: true,
        schema: { type: 'object' },
      });
      expect(bodies[1].response_format.json_schema).toEqual({
        name: 'response',
        schema: { type: 'object' },
      });
      expect(bodies[2].response_format.json_schema).toEqual({
        name: 'response',
        schema: { type: 'object' },
      });
      expect(bodies[3].response_format).toEqual({ type: 'json_object' });
      // reasoning_effort: 1・2 回目は付き、3 回目以降は落ちたまま（一度きりの縮退が維持される。
      // mode が 3 回目・4 回目で進んでも reasoning_effort が復活しないことの固定）
      expect(bodies[0].reasoning_effort).toBe('medium');
      expect(bodies[1].reasoning_effort).toBe('medium');
      expect(bodies[2]).not.toHaveProperty('reasoning_effort');
      expect(bodies[3]).not.toHaveProperty('reasoning_effort');
    });
  });

  // issue #127 PR3: Azure OpenAI は OpenAICompatibleProvider を認証方式だけ切り替えて流用する
  describe('Azure OpenAI 認証モード（authMode: "azure_api_key"）', () => {
    test('api-key ヘッダーで送信し、Authorization は付けない', async () => {
      const fetchMock = jest.fn().mockResolvedValue(
        response({ choices: [{ message: { content: '{"ok":true}' } }] }),
      );
      const provider = new OpenAICompatibleProvider({
        apiKey: 'azure-secret',
        model: 'gpt-4o-deployment',
        endpoint:
          'https://res.openai.azure.com/openai/deployments/gpt-4o-deployment/chat/completions?api-version=2026-01-01',
        fetch: fetchMock,
        authMode: 'azure_api_key',
      });
      await provider.chat([{ role: 'user', content: 'q' }]);
      const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Record<
        string,
        string
      >;
      expect(headers).toEqual({ 'Content-Type': 'application/json', 'api-key': 'azure-secret' });
      expect(headers['Authorization']).toBeUndefined();
      expect(fetchMock).toHaveBeenCalledWith(
        'https://res.openai.azure.com/openai/deployments/gpt-4o-deployment/chat/completions?api-version=2026-01-01',
        expect.anything(),
      );
    });

    test('providerId は azure_openai を報告する（LLMApiLog.provider への記録用）', () => {
      const provider = new OpenAICompatibleProvider({
        apiKey: 'k',
        model: 'm',
        endpoint: 'https://res.openai.azure.com/openai/deployments/m/chat/completions?api-version=2026-01-01',
        authMode: 'azure_api_key',
      });
      expect(provider.providerId).toBe('azure_openai');
    });

    test('authMode 省略時（既定の bearer モード）は従来どおり providerId が openai_compatible のまま', () => {
      const provider = new OpenAICompatibleProvider({
        apiKey: 'k',
        model: 'm',
        endpoint: 'https://llm.example/v1/chat/completions',
      });
      expect(provider.providerId).toBe('openai_compatible');
    });

    test('既定モード（bearer）の送信ヘッダーは authMode 追加前とバイト単位で同一', async () => {
      const fetchMock = jest.fn().mockResolvedValue(
        response({ choices: [{ message: { content: 'ok' } }] }),
      );
      const provider = new OpenAICompatibleProvider({
        apiKey: 'secret',
        model: 'm',
        endpoint: 'https://llm.example/v1/chat/completions',
        fetch: fetchMock,
        authMode: 'bearer',
      });
      await provider.chat([]);
      expect((fetchMock.mock.calls[0]?.[1] as RequestInit).headers).toEqual({
        'Content-Type': 'application/json',
        Authorization: 'Bearer secret',
      });
    });

    test('loopback の空 API キー + azure_api_key モードでも認証ヘッダーを送らない', async () => {
      const fetchMock = jest.fn().mockResolvedValue(
        response({ choices: [{ message: { content: 'ok' } }] }),
      );
      const provider = new OpenAICompatibleProvider({
        apiKey: '   ',
        model: 'm',
        endpoint: 'http://localhost:11434/v1/chat/completions',
        fetch: fetchMock,
        authMode: 'azure_api_key',
      });
      await provider.chat([]);
      expect((fetchMock.mock.calls[0]?.[1] as RequestInit).headers).toEqual({
        'Content-Type': 'application/json',
      });
    });
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
