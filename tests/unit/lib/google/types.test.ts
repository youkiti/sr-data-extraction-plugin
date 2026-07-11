import {
  GOOGLE_RETRYABLE_STATUSES,
  GoogleApiError,
  googleFetch,
} from '../../../../src/lib/google/types';

function makeDeps(response: Response): { fetch: jest.Mock; getAccessToken: jest.Mock } {
  return {
    fetch: jest.fn().mockResolvedValue(response),
    getAccessToken: jest.fn().mockResolvedValue('tok'),
  };
}

/** 非 2xx のモック Response。retryable なステータス用に headers も持たせる */
function errorResponse(status: number, body = 'err', headers: HeadersInit = {}): Response {
  return {
    ok: false,
    status,
    headers: new Headers(headers),
    json: async () => ({}),
    text: async () => body,
  } as Response;
}

function okResponse(): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => ({}),
    text: async () => '',
  } as Response;
}

const noSleep = (): Promise<void> => Promise.resolve();
/** ジッタを 0 に固定する乱数源（バックオフ計算を決定的に検証するため） */
const zeroRandom = (): number => 0;

describe('googleFetch', () => {
  test('Authorization ヘッダにトークンを付けて fetch する', async () => {
    const res = {
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => '',
    } as Response;
    const deps = makeDeps(res);
    await googleFetch('https://api/', { method: 'GET' }, deps);
    expect(deps.fetch).toHaveBeenCalledTimes(1);
    const [, init] = deps.fetch.mock.calls[0];
    const headers = (init as RequestInit).headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer tok');
  });

  test('非 2xx は GoogleApiError を throw する', async () => {
    const res = {
      ok: false,
      status: 403,
      json: async () => ({}),
      text: async () => 'forbidden',
    } as Response;
    const deps = makeDeps(res);
    await expect(googleFetch('https://api/', { method: 'GET' }, deps)).rejects.toBeInstanceOf(
      GoogleApiError,
    );
  });

  test('GoogleApiError は status / endpoint / responseBody を保持する', async () => {
    const res = {
      ok: false,
      status: 500,
      json: async () => ({}),
      text: async () => 'server err',
    } as Response;
    const deps = makeDeps(res);
    try {
      await googleFetch('https://api/x', { method: 'GET' }, deps);
    } catch (err) {
      expect(err).toBeInstanceOf(GoogleApiError);
      const e = err as GoogleApiError;
      expect(e.status).toBe(500);
      expect(e.endpoint).toBe('https://api/x');
      expect(e.responseBody).toBe('server err');
      return;
    }
    throw new Error('should have thrown');
  });

  test('text() が失敗しても空文字で握りつぶして GoogleApiError を投げる', async () => {
    const res = {
      ok: false,
      status: 502,
      json: async () => ({}),
      text: async (): Promise<string> => {
        throw new Error('network');
      },
    } as Response;
    const deps = makeDeps(res);
    await expect(googleFetch('https://api/', { method: 'GET' }, deps)).rejects.toMatchObject({
      status: 502,
      responseBody: '',
    });
  });

  test('初期ヘッダをマージする', async () => {
    const res = {
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => '',
    } as Response;
    const deps = makeDeps(res);
    await googleFetch(
      'https://api/',
      { method: 'POST', headers: { 'Content-Type': 'application/json' } },
      deps,
    );
    const [, init] = deps.fetch.mock.calls[0];
    const headers = (init as RequestInit).headers as Headers;
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('Authorization')).toBe('Bearer tok');
  });
});

describe('googleFetch の 429/503 リトライ', () => {
  test.each([429, 503])(
    'ステータス %i は指数バックオフで再送し、成功すればそれを返す（試行のたびに待ち時間が倍増する）',
    async (status) => {
      const fetch = jest
        .fn()
        .mockResolvedValueOnce(errorResponse(status))
        .mockResolvedValueOnce(errorResponse(status))
        .mockResolvedValueOnce(okResponse());
      const deps = { fetch, getAccessToken: jest.fn().mockResolvedValue('tok') };
      const sleepCalls: number[] = [];
      const sleep = (ms: number): Promise<void> => {
        sleepCalls.push(ms);
        return Promise.resolve();
      };

      const res = await googleFetch(
        'https://api/',
        { method: 'GET' },
        deps,
        { sleep, random: zeroRandom },
      );

      expect(res.ok).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(3);
      // baseDelayMs 既定 1000ms・ジッタ 0（zeroRandom）: 1 回目 1000ms・2 回目 2000ms（指数バックオフ）
      expect(sleepCalls).toEqual([1000, 2000]);
    },
  );

  test('サーバ提示の Retry-After ヘッダ（秒）を指数バックオフより優先する', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValueOnce(errorResponse(429, 'err', { 'Retry-After': '5' }))
      .mockResolvedValueOnce(okResponse());
    const deps = { fetch, getAccessToken: jest.fn().mockResolvedValue('tok') };
    const sleepCalls: number[] = [];
    const sleep = (ms: number): Promise<void> => {
      sleepCalls.push(ms);
      return Promise.resolve();
    };

    const res = await googleFetch('https://api/', { method: 'GET' }, deps, {
      sleep,
      random: zeroRandom,
    });

    expect(res.ok).toBe(true);
    // 指数バックオフ（1 回目 1000ms）より Retry-After（5000ms）の方が長いのでそちらを採用する
    expect(sleepCalls).toEqual([5000]);
  });

  test('ジッタ（random）を baseDelayMs の 0〜20% ぶん上乗せする', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValueOnce(errorResponse(429))
      .mockResolvedValueOnce(okResponse());
    const deps = { fetch, getAccessToken: jest.fn().mockResolvedValue('tok') };
    const sleepCalls: number[] = [];
    const sleep = (ms: number): Promise<void> => {
      sleepCalls.push(ms);
      return Promise.resolve();
    };

    await googleFetch('https://api/', { method: 'GET' }, deps, {
      sleep,
      random: () => 0.5, // baseDelayMs(1000) * 0.2 * 0.5 = 100ms のジッタ
    });

    // 1 回目のバックオフ 1000ms + ジッタ 100ms
    expect(sleepCalls).toEqual([1100]);
  });

  test('maxDelayMs を超える待ち時間は上限で頭打ちにする', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValueOnce(errorResponse(503))
      .mockResolvedValueOnce(okResponse());
    const deps = { fetch, getAccessToken: jest.fn().mockResolvedValue('tok') };
    const sleepCalls: number[] = [];
    const sleep = (ms: number): Promise<void> => {
      sleepCalls.push(ms);
      return Promise.resolve();
    };

    await googleFetch('https://api/', { method: 'GET' }, deps, {
      baseDelayMs: 100_000,
      maxDelayMs: 5_000,
      sleep,
      random: zeroRandom,
    });

    expect(sleepCalls).toEqual([5_000]);
  });

  test('最大試行回数に達したら GoogleApiError を throw する（リトライ対象ステータスのままでも）', async () => {
    const fetch = jest.fn().mockResolvedValue(errorResponse(429, 'quota exceeded'));
    const deps = { fetch, getAccessToken: jest.fn().mockResolvedValue('tok') };

    await expect(
      googleFetch('https://api/', { method: 'GET' }, deps, {
        maxAttempts: 3,
        sleep: noSleep,
        random: zeroRandom,
      }),
    ).rejects.toMatchObject({ status: 429, responseBody: 'quota exceeded' });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  test.each([400, 401, 403, 404])(
    'リトライ対象外のステータス %i は再送せず即 throw する',
    async (status) => {
      const fetch = jest.fn().mockResolvedValue(errorResponse(status, 'client error'));
      const deps = { fetch, getAccessToken: jest.fn().mockResolvedValue('tok') };

      await expect(
        googleFetch('https://api/', { method: 'GET' }, deps, { sleep: noSleep }),
      ).rejects.toMatchObject({ status });
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  test('GOOGLE_RETRYABLE_STATUSES は 429 / 503 のみを含む', () => {
    expect([...GOOGLE_RETRYABLE_STATUSES].sort()).toEqual([429, 503]);
  });

  test('retryOptions を省略しても既定値（maxAttempts=5, baseDelayMs=1000, maxDelayMs=30000, random=Math.random）で動く', async () => {
    // 429 を 4 回返してから成功させる（既定 maxAttempts=5 の範囲内）
    const fetch = jest
      .fn()
      .mockResolvedValueOnce(errorResponse(429))
      .mockResolvedValueOnce(errorResponse(429))
      .mockResolvedValueOnce(errorResponse(429))
      .mockResolvedValueOnce(errorResponse(429))
      .mockResolvedValueOnce(okResponse());
    const deps = { fetch, getAccessToken: jest.fn().mockResolvedValue('tok') };

    // random は既定（Math.random）のまま。sleep だけ差し替えて実待ちを避ける
    const res = await googleFetch('https://api/', { method: 'GET' }, deps, { sleep: noSleep });

    expect(res.ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(5);
  });

  test('sleep を省略すると既定の setTimeout ベース実装で待つ', async () => {
    jest.useFakeTimers();
    try {
      const fetch = jest
        .fn()
        .mockResolvedValueOnce(errorResponse(429))
        .mockResolvedValueOnce(okResponse());
      const deps = { fetch, getAccessToken: jest.fn().mockResolvedValue('tok') };

      const promise = googleFetch('https://api/', { method: 'GET' }, deps, {
        random: zeroRandom,
      });
      // baseDelayMs 既定 1000ms ぶん進めれば再送されるはず
      await jest.advanceTimersByTimeAsync(1_000);
      const res = await promise;

      expect(res.ok).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });
});
