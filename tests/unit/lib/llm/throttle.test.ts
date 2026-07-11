// withThrottle（バッチ間スロットル。429 対策 A）の単体テスト
import type { ChatResponse, LLMProvider } from '../../../../src/lib/llm/LLMProvider';
import { withThrottle } from '../../../../src/lib/llm/throttle';

function okResponse(text = 'ok'): ChatResponse {
  return { text, tokensIn: 1, tokensOut: 1, raw: {} };
}

/** 呼び出し時刻（仮想クロック値）を記録する fake provider */
function providerRecording(clock: { now: number }): {
  provider: LLMProvider;
  callTimes: number[];
} {
  const callTimes: number[] = [];
  return {
    callTimes,
    provider: {
      providerId: 'gemini',
      model: 'gemini-test',
      chat: async () => {
        callTimes.push(clock.now);
        return okResponse();
      },
    },
  };
}

/** 仮想クロック + sleep（sleep で時刻を進める） */
function virtualClock(): {
  clock: { now: number };
  sleep: (ms: number) => Promise<void>;
  now: () => number;
} {
  const clock = { now: 0 };
  return {
    clock,
    sleep: (ms) => {
      clock.now += ms;
      return Promise.resolve();
    },
    now: () => clock.now,
  };
}

describe('withThrottle', () => {
  test('providerId / model を引き継ぐ', () => {
    const { clock } = virtualClock();
    const { provider } = providerRecording(clock);
    const wrapped = withThrottle(provider, { minIntervalMs: 100 });
    expect(wrapped.providerId).toBe('gemini');
    expect(wrapped.model).toBe('gemini-test');
  });

  test('初回は待たず、以降は最小間隔を空けて発火する', async () => {
    const { clock, sleep, now } = virtualClock();
    const { provider, callTimes } = providerRecording(clock);
    const wrapped = withThrottle(provider, { minIntervalMs: 1_000, sleep, now });

    await wrapped.chat([{ role: 'user', content: 'a' }]);
    await wrapped.chat([{ role: 'user', content: 'b' }]);
    await wrapped.chat([{ role: 'user', content: 'c' }]);

    // 0ms, 1000ms, 2000ms に発火（連射が平準化される）
    expect(callTimes).toEqual([0, 1_000, 2_000]);
  });

  test('間隔以上に時間が経っていれば待たずに発火する', async () => {
    const { clock, sleep, now } = virtualClock();
    const { provider, callTimes } = providerRecording(clock);
    const wrapped = withThrottle(provider, { minIntervalMs: 1_000, sleep, now });

    await wrapped.chat([{ role: 'user', content: 'a' }]); // t=0
    clock.now = 5_000; // 外部要因で時間が進んだ
    await wrapped.chat([{ role: 'user', content: 'b' }]); // t=5000（待たない）
    expect(callTimes).toEqual([0, 5_000]);
  });

  test('並行呼び出しでも取りこぼさず 1 本ずつ間隔を割り当てる（nextAllowedAt を同期更新）', async () => {
    const clock = { now: 0 };
    const waits: number[] = [];
    const sleep = (ms: number): Promise<void> => {
      waits.push(ms);
      clock.now += ms;
      return Promise.resolve();
    };
    const { provider, callTimes } = providerRecording(clock);
    const wrapped = withThrottle(provider, {
      minIntervalMs: 1_000,
      sleep,
      now: () => clock.now,
    });

    // await せず同時に 3 本発火。同期部で nextAllowedAt を 0→1000→2000→3000 と進めるため、
    // 初回は待たず 2・3 本目はそれぞれ 1 間隔ぶん待つ（＝取りこぼしなく順に割り当て）
    await Promise.all([
      wrapped.chat([{ role: 'user', content: 'a' }]),
      wrapped.chat([{ role: 'user', content: 'b' }]),
      wrapped.chat([{ role: 'user', content: 'c' }]),
    ]);
    expect(callTimes).toHaveLength(3);
    expect(waits).toEqual([1_000, 1_000]);
  });

  test('sleep / now 未注入でも実タイマー（defaultSleep / defaultNow）で間隔を空ける', async () => {
    const { provider, callTimes } = providerRecording({ now: 0 });
    const wrapped = withThrottle(provider, { minIntervalMs: 5 });
    const startedAt = Date.now();
    await wrapped.chat([{ role: 'user', content: 'a' }]); // 初回は待たない
    await wrapped.chat([{ role: 'user', content: 'b' }]); // 2 本目は実タイマーで ~5ms 待つ
    expect(callTimes).toHaveLength(2);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(4);
  });
});
