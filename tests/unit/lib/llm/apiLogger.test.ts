// withLogging（LLMApiLog + Drive 保存ラッパ）の単体テスト
// （sr-query-builder から流用。purpose は本拡張の enum、promptVersion 記録のテストを追加）
import type { LlmApiLogEntry } from '../../../../src/domain/llmApiLog';
import { buildPromptSummary, redactMessagesForLog, withLogging } from '../../../../src/lib/llm/apiLogger';
import { OpenRouterProvider } from '../../../../src/lib/llm/OpenRouterProvider';
import {
  LlmProviderError,
  type ChatMessage,
  type ChatResponse,
  type LLMProvider,
} from '../../../../src/lib/llm/LLMProvider';

function makeProvider(impl: LLMProvider['chat']): LLMProvider {
  return {
    providerId: 'gemini',
    model: 'gemini-2.5-pro',
    supportsImageInput: true,
    chat: impl,
  };
}

interface RecordedDeps {
  uploads: Array<{ filename: string; content: string }>;
  entries: LlmApiLogEntry[];
}

function makeDeps(now = '2026-07-01T00:00:00.000Z'): {
  deps: Parameters<typeof withLogging>[2];
  recorded: RecordedDeps;
} {
  const recorded: RecordedDeps = { uploads: [], entries: [] };
  let id = 0;
  return {
    recorded,
    deps: {
      uploadJson: async ({ filename, content }) => {
        recorded.uploads.push({ filename, content });
        return { webViewLink: `https://drive/${filename}` };
      },
      appendLogEntry: async (entry) => {
        recorded.entries.push(entry);
      },
      newUuid: () => {
        id += 1;
        return `log-${id}`;
      },
      now: () => now,
    },
  };
}

describe('OpenRouter の報告費用', () => {
  test.each([
    [0.00207214, 0.00207214], [0, 0], [undefined, 0.000308],
    [null, 0.000308], ['0.1', 0.000308], [-1, 0.000308],
    [true, 0.000308], [{}, 0.000308],
  ])('usage.cost=%j の費用を記録する', async (cost, expected) => {
    const provider = new OpenRouterProvider({
      apiKey: 'k', model: 'deepseek/deepseek-v4-flash',
      fetch: jest.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({
          choices: [{ message: { content: '回答' } }],
          usage: { prompt_tokens: 1000, completion_tokens: 1000,
            prompt_tokens_details: { cached_tokens: 1000 }, cost },
        }),
      }),
    });
    const { deps, recorded } = makeDeps();
    await withLogging(provider, 'extract_study', deps).chat([]);
    expect(recorded.entries[0]!.costEstimateUsd).toBeCloseTo(expected as number, 12);
  });

  test('応答内容エラーでも報告費用を記録する', async () => {
    const provider = new OpenRouterProvider({
      apiKey: 'k', model: 'unknown',
      fetch: jest.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({
          choices: [{ message: { content: null }, finish_reason: 'length' }],
          usage: { cost: 0.00207214 },
        }),
      }),
    });
    const { deps, recorded } = makeDeps();
    await expect(withLogging(provider, 'extract_study', deps).chat([])).rejects.toThrow();
    expect(recorded.entries[0]!.costEstimateUsd).toBe(0.00207214);
  });

  test.each(['1e999', '-1e999'])('非有限の JSON 数値 %s は単価表へ戻す', async (cost) => {
    const provider = new OpenRouterProvider({
      apiKey: 'k', model: 'deepseek/deepseek-v4-flash',
      fetch: jest.fn().mockResolvedValue({
        ok: true,
        text: async () => `{"choices":[{"message":{"content":"回答"}}],"usage":{"prompt_tokens":1000,"completion_tokens":1000,"cost":${cost}}}`,
      }),
    });
    const { deps, recorded } = makeDeps();
    await withLogging(provider, 'extract_study', deps).chat([]);
    expect(recorded.entries[0]!.costEstimateUsd).toBeCloseTo(0.00042, 12);
  });
});

describe('buildPromptSummary', () => {
  test('ロール付きで連結し、空白を畳む', () => {
    expect(
      buildPromptSummary([
        { role: 'system', content: 'You are\nhelpful.' },
        { role: 'user', content: 'Hi' },
      ]),
    ).toBe('[system] You are helpful. [user] Hi');
  });

  test('500 文字超は 499 + … で打ち切られる', () => {
    const long = 'a'.repeat(600);
    const summary = buildPromptSummary([{ role: 'user', content: long }]);
    expect(summary).toHaveLength(500);
    expect(summary.endsWith('…')).toBe(true);
  });

  test('パート配列 content は chatContentToText で平坦化される（image は [image mimeType] プレースホルダ）', () => {
    const messages: ChatMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'この画像を見て' },
          { type: 'image', mimeType: 'image/png', dataBase64: 'aGVsbG8=' },
        ],
      },
    ];
    expect(buildPromptSummary(messages)).toBe('[user] この画像を見て[image image/png]');
  });
});

describe('redactMessagesForLog', () => {
  test('image パートの dataBase64 を長さ付きの伏字へ置換し、base64 本体は 1 文字も残さない', () => {
    const base64 = 'QQ=='.repeat(100_000); // 数十万文字級の base64（画像想定）
    const messages: ChatMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: '見て' },
          { type: 'image', mimeType: 'image/png', dataBase64: base64 },
        ],
      },
    ];
    const redacted = redactMessagesForLog(messages) as Array<{
      role: string;
      content: Array<Record<string, unknown>>;
    }>;
    const imagePart = redacted[0]?.content[1] as { dataBase64: string };
    expect(imagePart.dataBase64).toBe(`<image image/png ${base64.length} chars redacted>`);
    expect(imagePart.dataBase64).not.toContain(base64);
    // JSON.stringify した全体にも base64 本体が含まれないこと
    expect(JSON.stringify(redacted)).not.toContain(base64);
  });

  test('文字列 content・text パートは無改変', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: [{ type: 'text', text: 'plain text part' }] },
    ];
    expect(redactMessagesForLog(messages)).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: [{ type: 'text', text: 'plain text part' }] },
    ]);
  });
});

describe('withLogging', () => {
  test('成功時に prompt / response を Drive に保存し、ログ行を追記する', async () => {
    const response: ChatResponse = {
      text: 'ok',
      tokensIn: 5,
      tokensOut: 7,
      cachedTokensIn: null,
      raw: { candidates: ['x'] },
    };
    const provider = makeProvider(async () => response);
    const { deps, recorded } = makeDeps();
    const logged = withLogging(provider, 'extract_study', deps);

    const result = await logged.chat([{ role: 'user', content: 'q' }]);
    expect(result).toBe(response);

    expect(recorded.uploads).toHaveLength(2);
    expect(recorded.uploads[0]?.filename).toBe('log-1.prompt.json');
    expect(recorded.uploads[1]?.filename).toBe('log-1.response.json');
    const responseUpload = JSON.parse(recorded.uploads[1]!.content);
    expect(responseUpload).toEqual({ candidates: ['x'] });

    expect(recorded.entries).toHaveLength(1);
    const entry = recorded.entries[0]!;
    expect(entry.logId).toBe('log-1');
    expect(entry.provider).toBe('gemini');
    expect(entry.model).toBe('gemini-2.5-pro');
    expect(entry.purpose).toBe('extract_study');
    expect(entry.tokensIn).toBe(5);
    expect(entry.tokensOut).toBe(7);
    // gemini-2.5-pro: 入力 $1.25 / 出力 $10.00 per 1M → 5*1.25/1e6 + 7*10/1e6
    expect(entry.costEstimateUsd).toBeCloseTo(5 * 1.25e-6 + 7 * 10e-6, 12);
    expect(entry.error).toBeNull();
    expect(entry.promptRef).toBe('https://drive/log-1.prompt.json');
    expect(entry.responseRef).toBe('https://drive/log-1.response.json');
    expect(entry.promptSummary).toContain('[user] q');
    expect(entry.latencyMs).toBeGreaterThanOrEqual(0);
  });

  test('promptVersion を渡すと prompt payload に記録される（§4.3 プロンプト版数）', async () => {
    const provider = makeProvider(async () => ({ text: 'ok', tokensIn: 1, tokensOut: 1, cachedTokensIn: null, raw: {} }));
    const { deps, recorded } = makeDeps();
    const logged = withLogging(provider, 'extract_study', { ...deps, promptVersion: 3 });
    await logged.chat([{ role: 'user', content: 'q' }], { temperature: 0 });
    const promptUpload = JSON.parse(recorded.uploads[0]!.content);
    expect(promptUpload).toEqual({
      promptVersion: 3,
      messages: [{ role: 'user', content: 'q' }],
      options: { temperature: 0 },
    });
  });

  test('promptVersion 未指定なら prompt payload には null で記録される', async () => {
    const provider = makeProvider(async () => ({ text: 'ok', tokensIn: 1, tokensOut: 1, cachedTokensIn: null, raw: {} }));
    const { deps, recorded } = makeDeps();
    const logged = withLogging(provider, 'other', deps);
    await logged.chat([{ role: 'user', content: 'q' }]);
    const promptUpload = JSON.parse(recorded.uploads[0]!.content);
    expect(promptUpload.promptVersion).toBeNull();
  });

  test('LlmProviderError 発生時もログを残し、例外を再 throw する', async () => {
    const provider = makeProvider(async () => {
      throw new LlmProviderError('boom', 'gemini', 503, 'overloaded');
    });
    const { deps, recorded } = makeDeps();
    const logged = withLogging(provider, 'extract_study', deps);

    await expect(logged.chat([{ role: 'user', content: 'q' }])).rejects.toBeInstanceOf(
      LlmProviderError,
    );
    expect(recorded.entries).toHaveLength(1);
    expect(recorded.entries[0]?.error).toContain('status=503');
    // プロバイダ応答本文（400 等の具体的理由の一次資料）を丸ごと残す
    expect(recorded.entries[0]?.error).toContain('overloaded');
    expect(recorded.entries[0]?.tokensIn).toBeNull();
    const responseUpload = JSON.parse(recorded.uploads[1]!.content);
    expect(responseUpload).toEqual({ error: expect.stringContaining('overloaded') });
  });

  test('LlmProviderError の status=null は n/a として記録される', async () => {
    const provider = makeProvider(async () => {
      throw new LlmProviderError('network', 'gemini', null, '');
    });
    const { deps, recorded } = makeDeps();
    const logged = withLogging(provider, 'other', deps);
    await expect(logged.chat([{ role: 'user', content: 'q' }])).rejects.toBeInstanceOf(
      LlmProviderError,
    );
    expect(recorded.entries[0]?.error).toContain('status=n/a');
  });

  test('Error 以外の例外も文字列化される', async () => {
    const provider = makeProvider(async () => {
      throw 'string error';
    });
    const { deps, recorded } = makeDeps();
    const logged = withLogging(provider, 'other', deps);
    await expect(logged.chat([{ role: 'user', content: 'q' }])).rejects.toBe('string error');
    expect(recorded.entries[0]?.error).toBe('string error');
  });

  test('一般 Error も文字列化される', async () => {
    const provider = makeProvider(async () => {
      throw new Error('unhandled');
    });
    const { deps, recorded } = makeDeps();
    const logged = withLogging(provider, 'other', deps);
    await expect(logged.chat([{ role: 'user', content: 'q' }])).rejects.toThrow('unhandled');
    expect(recorded.entries[0]?.error).toBe('unhandled');
  });

  test('未知モデルは cost_estimate_usd が null', async () => {
    const provider: LLMProvider = {
      providerId: 'gemini',
      model: 'unknown-model-x',
      supportsImageInput: true,
      chat: async () => ({ text: 'ok', tokensIn: 100, tokensOut: 50, cachedTokensIn: null, raw: {} }),
    };
    const { deps, recorded } = makeDeps();
    const logged = withLogging(provider, 'other', deps);
    await logged.chat([{ role: 'user', content: 'q' }]);
    expect(recorded.entries[0]?.costEstimateUsd).toBeNull();
  });

  test('トークン数が両方 null なら cost_estimate_usd も null', async () => {
    const provider = makeProvider(async () => ({
      text: 'ok',
      tokensIn: null,
      tokensOut: null,
      cachedTokensIn: null,
      raw: {},
    }));
    const { deps, recorded } = makeDeps();
    const logged = withLogging(provider, 'other', deps);
    await logged.chat([{ role: 'user', content: 'q' }]);
    expect(recorded.entries[0]?.costEstimateUsd).toBeNull();
  });

  test('既定 newUuid / now を使うラッパも作れる（差し替えなし）', async () => {
    const provider = makeProvider(async () => ({
      text: 'ok',
      tokensIn: null,
      tokensOut: null,
      cachedTokensIn: null,
      raw: {},
    }));
    const logged = withLogging(provider, 'other', {
      uploadJson: async () => ({ webViewLink: '' }),
      appendLogEntry: async () => undefined,
    });
    await expect(logged.chat([{ role: 'user', content: 'q' }])).resolves.toMatchObject({
      text: 'ok',
    });
  });

  test('supportsImageInput を元プロバイダから引き継ぐ', async () => {
    const provider = makeProvider(async () => ({ text: 'ok', tokensIn: 1, tokensOut: 1, cachedTokensIn: null, raw: {} }));
    const { deps } = makeDeps();
    const logged = withLogging(provider, 'other', deps);
    expect(logged.supportsImageInput).toBe(true);
  });

  test('画像パートを含む prompt を保存するとき、Drive へ保存する JSON から base64 本体が除かれる', async () => {
    const base64 = 'QQ=='.repeat(100_000);
    const provider = makeProvider(async () => ({ text: 'ok', tokensIn: 1, tokensOut: 1, cachedTokensIn: null, raw: {} }));
    const { deps, recorded } = makeDeps();
    const logged = withLogging(provider, 'other', deps);
    await logged.chat([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'この画像を見て' },
          { type: 'image', mimeType: 'image/png', dataBase64: base64 },
        ],
      },
    ]);
    const promptUpload = recorded.uploads[0]!.content;
    expect(promptUpload).not.toContain(base64);
    expect(promptUpload).toContain(`<image image/png ${base64.length} chars redacted>`);
  });
});

describe('withLogging のキャッシュヒット計測', () => {
  test('cachedTokensIn をログ行へ残し、コスト概算からも割り引く', async () => {
    const provider = makeProvider(async () => ({
      text: 'ok',
      tokensIn: 1_000_000,
      tokensOut: 0,
      cachedTokensIn: 800_000,
      raw: {},
    }));
    const { deps, recorded } = makeDeps();
    const logged = withLogging({ ...provider, model: 'gemini-3.5-flash' }, 'extract_study', deps);
    await logged.chat([{ role: 'user', content: 'q' }]);
    const entry = recorded.entries[0];
    expect(entry?.cachedTokensIn).toBe(800_000);
    // 200,000 × $1.50 + 800,000 × $0.15 = 0.42。割り引かなければ 1.50 になる
    expect(entry?.costEstimateUsd).toBeCloseTo(0.42, 10);
  });

  test('provider がキャッシュ情報を返さなければ cachedTokensIn は null のまま記録する', async () => {
    const provider = makeProvider(async () => ({
      text: 'ok',
      tokensIn: 1_000_000,
      tokensOut: 0,
      cachedTokensIn: null,
      raw: {},
    }));
    const { deps, recorded } = makeDeps();
    const logged = withLogging({ ...provider, model: 'gemini-3.5-flash' }, 'extract_study', deps);
    await logged.chat([{ role: 'user', content: 'q' }]);
    expect(recorded.entries[0]?.cachedTokensIn).toBeNull();
    expect(recorded.entries[0]?.costEstimateUsd).toBeCloseTo(1.5, 10);
  });
});

describe('withLogging の文脈・エラー使用量', () => {
  test('実行と呼び出しの文脈、プロンプト版数、思考内訳をログ列へ記録する', async () => {
    const response: ChatResponse = {
      text: 'ok',
      tokensIn: 100,
      tokensOut: 50,
      cachedTokensIn: 80,
      thoughtsTokensOut: 30,
      raw: {},
    };
    const chat = jest.fn().mockResolvedValue(response);
    const { deps, recorded } = makeDeps();
    const logged = withLogging(makeProvider(chat), 'extract_study', {
      ...deps,
      runId: 'run-1',
      promptVersion: 9,
    });
    const options = { logContext: { studyId: 'study-1', section: 'methods' } };
    await logged.chat([], options);
    expect(chat).toHaveBeenCalledWith([], options);
    expect(recorded.entries[0]).toMatchObject({
      runId: 'run-1',
      studyId: 'study-1',
      section: 'methods',
      promptVersion: 9,
      thoughtsTokensOut: 30,
    });
    await logged.chat([], { logContext: { studyId: 'study-2', section: null } });
    expect(recorded.entries[1]).toMatchObject({
      runId: 'run-1',
      studyId: 'study-2',
      section: null,
    });
  });

  test('文脈・版数・思考内訳が未指定なら null を記録する', async () => {
    const provider = makeProvider(async () => ({
      text: 'ok',
      tokensIn: null,
      tokensOut: null,
      cachedTokensIn: null,
      raw: {},
    }));
    const { deps, recorded } = makeDeps();
    await withLogging(provider, 'draft_schema', deps).chat([]);
    expect(recorded.entries[0]).toMatchObject({
      runId: null,
      studyId: null,
      section: null,
      promptVersion: null,
      thoughtsTokensOut: null,
    });
  });

  test('エラーに付随する使用量で成功時と同じ概算費用を計算し、元の例外を再送出する', async () => {
    const usage = {
      tokensIn: 100,
      tokensOut: 50,
      cachedTokensIn: 80,
      thoughtsTokensOut: 30,
    };
    const error = new LlmProviderError(
      '打ち切り',
      'gemini',
      200,
      'details',
      null,
      false,
      'output_limit',
      usage,
    );
    const { deps, recorded } = makeDeps();
    const success = withLogging(
      makeProvider(async () => ({
        ...usage,
        text: 'ok',
        raw: {},
      })),
      'extract_study',
      deps,
    );
    await success.chat([]);
    const logged = withLogging(
      makeProvider(async () => {
        throw error;
      }),
      'extract_study',
      {
        ...deps,
        runId: 'run-1',
        promptVersion: 9,
      },
    );
    await expect(
      logged.chat([], {
        logContext: { studyId: 'study-1', section: 'methods' },
      }),
    ).rejects.toBe(error);
    expect(recorded.entries[1]).toMatchObject({
      ...usage,
      costEstimateUsd: recorded.entries[0]!.costEstimateUsd,
      error: '打ち切り (status=200): details',
      runId: 'run-1',
      studyId: 'study-1',
      section: 'methods',
      promptVersion: 9,
    });
    expect(recorded.entries[1]!.costEstimateUsd).not.toBeNull();
    expect(JSON.parse(recorded.uploads[3]!.content)).toEqual({
      error: '打ち切り (status=200): details',
    });
  });
});
test('本文省略時は uploadJson を呼ばず質問と回答の本文を記録しない', async () => {
  const { deps, recorded } = makeDeps();
  const provider = withLogging(
    makeProvider(async () => ({
      text: '秘密の回答',
      raw: '秘密の応答',
      tokensIn: 100,
      tokensOut: 20,
      cachedTokensIn: 50,
    })),
    'ask_paper',
    { ...deps, omitPayload: true },
  );
  await provider.chat([{ role: 'user', content: '秘密の質問' }]);
  expect(recorded.uploads).toEqual([]);
  expect(recorded.entries[0]).toMatchObject({
    purpose: 'ask_paper',
    promptRef: '',
    responseRef: '',
    promptSummary: null,
    tokensIn: 100,
    tokensOut: 20,
    cachedTokensIn: 50,
    costEstimateUsd: expect.any(Number),
    latencyMs: expect.any(Number),
    error: null,
  });
  expect(JSON.stringify(recorded.entries)).not.toContain('秘密');
});

test('本文省略時はエラー本文を保存せずメタデータだけ保持する', async () => {
  const { deps, recorded } = makeDeps();
  const error = new LlmProviderError('失敗', 'gemini', 400, '応答本文');
  const provider = withLogging(
    makeProvider(async () => {
      throw error;
    }),
    'ask_paper',
    { ...deps, omitPayload: true },
  );
  await expect(provider.chat([{ role: 'user', content: '秘密の質問' }])).rejects.toBe(error);
  expect(recorded.uploads).toEqual([]);
  expect(recorded.entries[0]).toMatchObject({
    promptRef: '',
    responseRef: '',
    promptSummary: null,
    tokensIn: null,
    tokensOut: null,
    error: 'LlmProviderError (status=400)',
  });
});

test.each([
  new LlmProviderError(
    'Gemini 応答ボディが JSON として読めません',
    'gemini',
    200,
    '秘密の回答本文',
  ),
  new LlmProviderError('finishReason=秘密の回答本文', 'gemini', null, '秘密の回答本文'),
  new Error('秘密の質問と回答本文'),
  '秘密の質問と回答本文',
])('本文省略時は解析失敗やmessage中の本文も記録しない: %s', async (error) => {
  const { deps, recorded } = makeDeps();
  const provider = withLogging(
    makeProvider(async () => {
      throw error;
    }),
    'ask_paper',
    { ...deps, omitPayload: true },
  );
  await expect(provider.chat([{ role: 'user', content: '秘密の質問' }])).rejects.toBe(error);
  expect(JSON.stringify(recorded.entries)).not.toContain('秘密');
  expect(recorded.entries[0]?.error).toBe(
    error instanceof LlmProviderError
      ? `LlmProviderError (status=${error.status ?? 'n/a'})`
      : 'Error',
  );
  expect(recorded.uploads).toEqual([]);
});
