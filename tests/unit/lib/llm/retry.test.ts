// withRetry（指数バックオフ再試行ラッパ）の単体テスト（sr-query-builder から流用）
import {
  LlmProviderError,
  type ChatResponse,
  type LLMProvider,
} from '../../../../src/lib/llm/LLMProvider';
import {
  parseRetryAfterMs,
  parseServerRetryDelayMs,
  RETRYABLE_STATUSES,
  withRetry,
} from '../../../../src/lib/llm/retry';

function okResponse(text = 'ok'): ChatResponse {
  return { text, tokensIn: 1, tokensOut: 1, raw: {} };
}

function providerError(status: number | null): LlmProviderError {
  return new LlmProviderError(`Gemini API failed: HTTP ${status}`, 'gemini', status, '');
}

/** chat が呼ばれるたびに results の先頭から消費する fake provider */
function buildProvider(results: Array<ChatResponse | Error>): {
  provider: LLMProvider;
  calls: () => number;
} {
  let count = 0;
  return {
    provider: {
      providerId: 'gemini',
      model: 'gemini-test',
      chat: async () => {
        const next = results[count];
        count += 1;
        if (next === undefined) {
          throw new Error('fake provider: 想定外の追加呼び出し');
        }
        if (next instanceof Error) {
          throw next;
        }
        return next;
      },
    },
    calls: () => count,
  };
}

const noSleep = (): Promise<void> => Promise.resolve();

describe('withRetry', () => {
  test('成功時はそのまま返し、再試行しない', async () => {
    const { provider, calls } = buildProvider([okResponse()]);
    const wrapped = withRetry(provider, { sleep: noSleep });
    const res = await wrapped.chat([{ role: 'user', content: 'hi' }]);
    expect(res.text).toBe('ok');
    expect(calls()).toBe(1);
  });

  test('providerId / model を元プロバイダから引き継ぐ', () => {
    const { provider } = buildProvider([]);
    const wrapped = withRetry(provider);
    expect(wrapped.providerId).toBe('gemini');
    expect(wrapped.model).toBe('gemini-test');
  });

  test.each([...RETRYABLE_STATUSES])('HTTP %i は再試行して成功すれば返す', async (status) => {
    const { provider, calls } = buildProvider([providerError(status), okResponse('retried')]);
    const wrapped = withRetry(provider, { sleep: noSleep });
    const res = await wrapped.chat([{ role: 'user', content: 'hi' }]);
    expect(res.text).toBe('retried');
    expect(calls()).toBe(2);
  });

  test('maxAttempts 回失敗したら最後のエラーを投げる', async () => {
    const { provider, calls } = buildProvider([
      providerError(503),
      providerError(503),
      providerError(503),
    ]);
    const wrapped = withRetry(provider, { sleep: noSleep });
    await expect(wrapped.chat([{ role: 'user', content: 'hi' }])).rejects.toThrow('HTTP 503');
    expect(calls()).toBe(3);
  });

  test('再試行対象外のステータス（400 等）は即座に投げる', async () => {
    const { provider, calls } = buildProvider([providerError(400)]);
    const wrapped = withRetry(provider, { sleep: noSleep });
    await expect(wrapped.chat([{ role: 'user', content: 'hi' }])).rejects.toThrow('HTTP 400');
    expect(calls()).toBe(1);
  });

  test('status が null（ネットワーク異常など provider 層の整形済みエラー）は再試行しない', async () => {
    const { provider, calls } = buildProvider([providerError(null)]);
    const wrapped = withRetry(provider, { sleep: noSleep });
    await expect(wrapped.chat([{ role: 'user', content: 'hi' }])).rejects.toThrow();
    expect(calls()).toBe(1);
  });

  test('LlmProviderError 以外の例外は再試行しない', async () => {
    const { provider, calls } = buildProvider([new TypeError('fetch failed')]);
    const wrapped = withRetry(provider, { sleep: noSleep });
    await expect(wrapped.chat([{ role: 'user', content: 'hi' }])).rejects.toThrow('fetch failed');
    expect(calls()).toBe(1);
  });

  test('バックオフは指数的に伸びる（1 回目 base、2 回目 base*2）', async () => {
    const delays: number[] = [];
    const { provider } = buildProvider([providerError(503), providerError(503), okResponse()]);
    const wrapped = withRetry(provider, {
      baseDelayMs: 100,
      sleep: (ms) => {
        delays.push(ms);
        return Promise.resolve();
      },
    });
    await wrapped.chat([{ role: 'user', content: 'hi' }]);
    expect(delays).toEqual([100, 200]);
  });

  test('既定 sleep（実タイマー）でも再試行して成功する', async () => {
    const { provider, calls } = buildProvider([providerError(503), okResponse('slow')]);
    const wrapped = withRetry(provider, { baseDelayMs: 1 });
    const res = await wrapped.chat([{ role: 'user', content: 'hi' }]);
    expect(res.text).toBe('slow');
    expect(calls()).toBe(2);
  });

  test('isRetryable を差し替えられる', async () => {
    const { provider, calls } = buildProvider([new Error('custom'), okResponse()]);
    const wrapped = withRetry(provider, { sleep: noSleep, isRetryable: () => true });
    const res = await wrapped.chat([{ role: 'user', content: 'hi' }]);
    expect(res.text).toBe('ok');
    expect(calls()).toBe(2);
  });

  test('サーバ提示の retryDelay（本文 RetryInfo）がバックオフより長ければそちらを待つ', async () => {
    const delays: number[] = [];
    const err = new LlmProviderError(
      'Gemini API failed: HTTP 429',
      'gemini',
      429,
      '{"error":{"details":[{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"42s"}]}}',
    );
    const { provider } = buildProvider([err, okResponse()]);
    const wrapped = withRetry(provider, {
      baseDelayMs: 1_000,
      sleep: (ms) => {
        delays.push(ms);
        return Promise.resolve();
      },
    });
    await wrapped.chat([{ role: 'user', content: 'hi' }]);
    expect(delays).toEqual([42_000]);
  });

  test('Retry-After ヘッダ由来（retryAfterMs）はバックオフより優先される', async () => {
    const delays: number[] = [];
    const err = new LlmProviderError('HTTP 429', 'gemini', 429, '', 8_000);
    const { provider } = buildProvider([err, okResponse()]);
    const wrapped = withRetry(provider, {
      baseDelayMs: 1_000,
      sleep: (ms) => {
        delays.push(ms);
        return Promise.resolve();
      },
    });
    await wrapped.chat([{ role: 'user', content: 'hi' }]);
    expect(delays).toEqual([8_000]);
  });

  test('maxDelayMs でサーバ提示・指数バックオフの両方を頭打ちにする', async () => {
    const delays: number[] = [];
    const err = new LlmProviderError('HTTP 429', 'gemini', 429, '', 999_000);
    const { provider } = buildProvider([err, err, okResponse()]);
    const wrapped = withRetry(provider, {
      baseDelayMs: 1_000,
      maxDelayMs: 5_000,
      sleep: (ms) => {
        delays.push(ms);
        return Promise.resolve();
      },
    });
    await wrapped.chat([{ role: 'user', content: 'hi' }]);
    expect(delays).toEqual([5_000, 5_000]);
  });
});

describe('parseRetryAfterMs', () => {
  test('null / 空文字は null', () => {
    expect(parseRetryAfterMs(null)).toBeNull();
    expect(parseRetryAfterMs('   ')).toBeNull();
  });

  test('数値は秒として ms へ換算する（負値は 0）', () => {
    expect(parseRetryAfterMs('30')).toBe(30_000);
    expect(parseRetryAfterMs('1.5')).toBe(1_500);
    expect(parseRetryAfterMs('-5')).toBe(0);
  });

  test('HTTP-date は現在時刻との差分（過去日付は 0）', () => {
    const now = (): number => Date.parse('2026-07-10T00:00:00Z');
    expect(parseRetryAfterMs('Fri, 10 Jul 2026 00:00:10 GMT', now)).toBe(10_000);
    expect(parseRetryAfterMs('Fri, 10 Jul 2026 00:00:00 GMT', now)).toBe(0);
    // 過去日付
    expect(parseRetryAfterMs('Thu, 09 Jul 2026 00:00:00 GMT', now)).toBe(0);
  });

  test('解釈できない文字列は null', () => {
    expect(parseRetryAfterMs('not-a-date')).toBeNull();
  });

  test('now 未指定でも既定（Date.now）で HTTP-date を処理できる', () => {
    const future = new Date(Date.now() + 5_000).toUTCString();
    const ms = parseRetryAfterMs(future);
    expect(ms).not.toBeNull();
    expect(ms as number).toBeGreaterThan(0);
  });
});

describe('parseServerRetryDelayMs', () => {
  test('LlmProviderError 以外は null', () => {
    expect(parseServerRetryDelayMs(new Error('x'))).toBeNull();
    expect(parseServerRetryDelayMs('oops')).toBeNull();
  });

  test('retryAfterMs があれば最優先で採用する', () => {
    const err = new LlmProviderError('x', 'gemini', 429, '{"retryDelay":"9s"}', 3_000);
    expect(parseServerRetryDelayMs(err)).toBe(3_000);
  });

  test('本文の RetryInfo retryDelay（整数・小数秒）を拾う', () => {
    expect(
      parseServerRetryDelayMs(new LlmProviderError('x', 'gemini', 429, '"retryDelay": "42s"')),
    ).toBe(42_000);
    expect(
      parseServerRetryDelayMs(new LlmProviderError('x', 'gemini', 429, '"retryDelay":"1.5s"')),
    ).toBe(1_500);
  });

  test('retryDelay も retryAfterMs も無ければ null', () => {
    expect(parseServerRetryDelayMs(new LlmProviderError('x', 'gemini', 429, 'no hint'))).toBeNull();
  });
});
