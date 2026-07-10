// rateLimitPolicy（tier プリセット・ポリシー解決・スロットル間隔・provider 合成）の単体テスト
import {
  LlmProviderError,
  type ChatResponse,
  type LLMProvider,
} from '../../../../src/lib/llm/LLMProvider';
import {
  applyRateLimitPolicy,
  DEFAULT_CUSTOM_RPM,
  DEFAULT_MAX_CONCURRENCY,
  DEFAULT_RATE_LIMIT_TIER_ID,
  getRateLimitTier,
  isRateLimitTierId,
  RATE_LIMIT_TIERS,
  resolvePolicyForTier,
  throttleIntervalMs,
  UNLIMITED_POLICY,
  type RateLimitPolicy,
} from '../../../../src/lib/llm/rateLimitPolicy';

function okResponse(text = 'ok'): ChatResponse {
  return { text, tokensIn: 1, tokensOut: 1, raw: {} };
}

describe('tier カタログ', () => {
  test('既定 tier は gemini_free でカタログに存在する', () => {
    expect(DEFAULT_RATE_LIMIT_TIER_ID).toBe('gemini_free');
    expect(RATE_LIMIT_TIERS.some((t) => t.id === DEFAULT_RATE_LIMIT_TIER_ID)).toBe(true);
  });

  test('カスタム tier だけが editableRpm、制限なし tier は UNLIMITED_POLICY', () => {
    const custom = RATE_LIMIT_TIERS.find((t) => t.id === 'custom');
    expect(custom?.editableRpm).toBe(true);
    expect(custom?.policy.requestsPerMinute).toBe(DEFAULT_CUSTOM_RPM);
    const unlimited = RATE_LIMIT_TIERS.find((t) => t.id === 'unlimited');
    expect(unlimited?.editableRpm).toBe(false);
    expect(unlimited?.policy).toBe(UNLIMITED_POLICY);
  });

  test('editableRpm でない tier はすべて RPM を持つ（無料枠が最小）', () => {
    for (const tier of RATE_LIMIT_TIERS) {
      if (tier.id === 'unlimited') {
        expect(tier.policy.requestsPerMinute).toBeNull();
      } else {
        expect(tier.policy.requestsPerMinute).toBeGreaterThan(0);
      }
    }
  });

  test('全プリセットの既定 maxConcurrency は 1（逐次。回帰の砦）で editableConcurrency は custom のみ', () => {
    for (const tier of RATE_LIMIT_TIERS) {
      expect(tier.policy.maxConcurrency).toBe(DEFAULT_MAX_CONCURRENCY);
      expect(tier.editableConcurrency).toBe(tier.id === 'custom');
    }
  });
});

describe('isRateLimitTierId', () => {
  test('既知 ID のみ true', () => {
    expect(isRateLimitTierId('gemini_free')).toBe(true);
    expect(isRateLimitTierId('custom')).toBe(true);
    expect(isRateLimitTierId('unknown')).toBe(false);
    expect(isRateLimitTierId(undefined)).toBe(false);
    expect(isRateLimitTierId(42)).toBe(false);
  });
});

describe('getRateLimitTier', () => {
  test('ID から tier を引く', () => {
    expect(getRateLimitTier('gemini_tier1').label).toContain('Tier 1');
  });

  test('未知 ID は既定 tier へフォールバック', () => {
    expect(getRateLimitTier('nope' as never).id).toBe(DEFAULT_RATE_LIMIT_TIER_ID);
  });
});

describe('resolvePolicyForTier', () => {
  test('非カスタム tier はプリセットをそのまま返す（customRpm は無視）', () => {
    const free = getRateLimitTier('gemini_free').policy;
    expect(resolvePolicyForTier('gemini_free', 999)).toEqual(free);
  });

  test('customRpm 省略（既定 null）でもプリセットを返す', () => {
    expect(resolvePolicyForTier('gemini_free')).toEqual(getRateLimitTier('gemini_free').policy);
  });

  test('カスタム tier は正の整数 RPM で上書きする', () => {
    expect(resolvePolicyForTier('custom', 45).requestsPerMinute).toBe(45);
    // 小数は切り捨て
    expect(resolvePolicyForTier('custom', 45.9).requestsPerMinute).toBe(45);
  });

  test('カスタム tier で RPM が null / 非正なら プリセット既定のまま', () => {
    expect(resolvePolicyForTier('custom', null).requestsPerMinute).toBe(DEFAULT_CUSTOM_RPM);
    expect(resolvePolicyForTier('custom', 0).requestsPerMinute).toBe(DEFAULT_CUSTOM_RPM);
    expect(resolvePolicyForTier('custom', -3).requestsPerMinute).toBe(DEFAULT_CUSTOM_RPM);
    expect(resolvePolicyForTier('custom', Number.NaN).requestsPerMinute).toBe(DEFAULT_CUSTOM_RPM);
  });

  test('カスタム tier は正の整数 concurrency で上書きする（小数は切り捨て）', () => {
    expect(resolvePolicyForTier('custom', null, 4).maxConcurrency).toBe(4);
    expect(resolvePolicyForTier('custom', null, 4.9).maxConcurrency).toBe(4);
  });

  test('カスタム tier で concurrency が null / 非正なら プリセット既定（1）のまま', () => {
    expect(resolvePolicyForTier('custom', null, null).maxConcurrency).toBe(DEFAULT_MAX_CONCURRENCY);
    expect(resolvePolicyForTier('custom', null, 0).maxConcurrency).toBe(DEFAULT_MAX_CONCURRENCY);
    expect(resolvePolicyForTier('custom', null, -2).maxConcurrency).toBe(DEFAULT_MAX_CONCURRENCY);
    expect(resolvePolicyForTier('custom', null, Number.NaN).maxConcurrency).toBe(
      DEFAULT_MAX_CONCURRENCY,
    );
  });

  test('非カスタム tier は concurrency 指定を無視する', () => {
    expect(resolvePolicyForTier('gemini_tier3', null, 8).maxConcurrency).toBe(
      DEFAULT_MAX_CONCURRENCY,
    );
  });

  test('RPM と concurrency を同時に上書きできる', () => {
    const policy = resolvePolicyForTier('custom', 50, 3);
    expect(policy.requestsPerMinute).toBe(50);
    expect(policy.maxConcurrency).toBe(3);
  });
});

describe('throttleIntervalMs', () => {
  test('RPM から最小間隔（ms）を導く（切り上げ）', () => {
    expect(throttleIntervalMs({ ...UNLIMITED_POLICY, requestsPerMinute: 10 })).toBe(6_000);
    expect(throttleIntervalMs({ ...UNLIMITED_POLICY, requestsPerMinute: 7 })).toBe(Math.ceil(60_000 / 7));
  });

  test('RPM が null / 0 以下は null（スロットルしない）', () => {
    expect(throttleIntervalMs(UNLIMITED_POLICY)).toBeNull();
    expect(throttleIntervalMs({ ...UNLIMITED_POLICY, requestsPerMinute: 0 })).toBeNull();
    expect(throttleIntervalMs({ ...UNLIMITED_POLICY, requestsPerMinute: -1 })).toBeNull();
  });
});

describe('applyRateLimitPolicy', () => {
  function recordingProvider(clock: { now: number }, results: Array<ChatResponse | Error>): {
    provider: LLMProvider;
    callTimes: number[];
  } {
    const callTimes: number[] = [];
    let i = 0;
    return {
      callTimes,
      provider: {
        providerId: 'gemini',
        model: 'm',
        chat: async () => {
          callTimes.push(clock.now);
          const next = results[i];
          i += 1;
          if (next instanceof Error) {
            throw next;
          }
          return next ?? okResponse();
        },
      },
    };
  }

  test('RPM ありポリシーは throttle + retry で包む（スロットル間隔 + 429 バックオフ）', async () => {
    const clock = { now: 0 };
    const sleep = (ms: number): Promise<void> => {
      clock.now += ms;
      return Promise.resolve();
    };
    const now = (): number => clock.now;
    const err = new LlmProviderError('HTTP 429', 'gemini', 429, '', 3_000);
    const { provider, callTimes } = recordingProvider(clock, [okResponse(), err, okResponse()]);
    const policy: RateLimitPolicy = {
      requestsPerMinute: 30, // 2000ms 間隔
      maxAttempts: 3,
      baseDelayMs: 1_000,
      maxDelayMs: 60_000,
      maxConcurrency: 1,
    };
    const wrapped = applyRateLimitPolicy(provider, policy, { sleep, now });

    await wrapped.chat([{ role: 'user', content: 'a' }]); // t=0
    await wrapped.chat([{ role: 'user', content: 'b' }]); // 2 本目: throttle で t=2000 に発火 → 429 → retry(3000) → throttle 再適用
    // 発火時刻: [0（初回）, 2000（2本目・429）, ≥5000（再送）]
    expect(callTimes[0]).toBe(0);
    expect(callTimes[1]).toBe(2_000);
    // 429 後: サーバ提示 3000ms 待ち → t=5000、さらに throttle が次スロット（4000）以降を保証
    expect(callTimes[2]).toBeGreaterThanOrEqual(5_000);
  });

  test('RPM null ポリシーは throttle 無し（同一時刻に連射）だがリトライは効く', async () => {
    const clock = { now: 0 };
    const sleep = (ms: number): Promise<void> => {
      clock.now += ms;
      return Promise.resolve();
    };
    const now = (): number => clock.now;
    const { provider, callTimes } = recordingProvider(clock, [okResponse(), okResponse()]);
    const wrapped = applyRateLimitPolicy(provider, UNLIMITED_POLICY, { sleep, now });
    await wrapped.chat([{ role: 'user', content: 'a' }]);
    await wrapped.chat([{ role: 'user', content: 'b' }]);
    // スロットルしないので両方 t=0
    expect(callTimes).toEqual([0, 0]);
  });

  test('clock 未注入でも動く（実タイマー・成功パス）', async () => {
    const { provider } = recordingProvider({ now: 0 }, [okResponse('done')]);
    const wrapped = applyRateLimitPolicy(provider, UNLIMITED_POLICY);
    const res = await wrapped.chat([{ role: 'user', content: 'a' }]);
    expect(res.text).toBe('done');
  });
});
