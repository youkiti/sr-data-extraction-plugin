// レート制限ポリシー（一括抽出の 429 対策。docs/requirements.md §4.3）。
// 対策は 2 本立て:
//   A. バッチ間スロットル（withThrottle）: 1 分あたりリクエスト数（RPM）から最小リクエスト間隔を
//      導き、executeRun のバッチ連射がプロバイダの RPM を超えないようにする
//   B. リトライ強化（withRetry）: 429/5xx を指数バックオフで再試行し、サーバ提示の retryDelay /
//      Retry-After を尊重する。tier ごとに試行回数・バックオフ上限を変える
//
// tier は「利用者のアカウントが属する課金帯」を表す。RPM はモデルによっても変わるため、
// プリセット値は各 tier で常用しうる最も制約の強いモデルを想定した保守的な目安であり、
// 「カスタム」で実際の RPM に合わせて上書きできる（docs/ui-states.md §2「レート制限」）。
import { withRetry } from './retry';
import { withThrottle } from './throttle';
import type { LLMProvider } from './LLMProvider';

/** 抽出・ドラフトの LLM 呼び出しに適用するレート制限ポリシー */
export interface RateLimitPolicy {
  /** 1 分あたりの最大リクエスト数。null / 0 以下 = スロットルしない */
  requestsPerMinute: number | null;
  /** withRetry の最大試行回数（初回を含む） */
  maxAttempts: number;
  /** バックオフの基準待ち時間（ms） */
  baseDelayMs: number;
  /** バックオフ上限（ms）。サーバ提示の retryDelay もこの上限で頭打ちにする */
  maxDelayMs: number;
}

export type RateLimitTierId =
  | 'gemini_free'
  | 'gemini_tier1'
  | 'gemini_tier2'
  | 'gemini_tier3'
  | 'custom'
  | 'unlimited';

/** Options のプルダウン 1 項目 */
export interface RateLimitTier {
  id: RateLimitTierId;
  label: string;
  /** UI の補足説明 */
  description: string;
  policy: RateLimitPolicy;
  /** カスタム tier のみ RPM を手入力させる */
  editableRpm: boolean;
}

/**
 * スロットルしない既定ポリシー。サービス層が resolveRateLimitPolicy 未注入のときの
 * フォールバック（＝従来挙動: リトライのみ・スロットル無し）でもある。
 * 「制限なし」tier の実体でもある
 */
export const UNLIMITED_POLICY: RateLimitPolicy = {
  requestsPerMinute: null,
  maxAttempts: 3,
  baseDelayMs: 1_000,
  maxDelayMs: 15_000,
};

/** 未設定時の既定 tier。多くの利用者が該当する無料枠を安全側の既定にする */
export const DEFAULT_RATE_LIMIT_TIER_ID: RateLimitTierId = 'gemini_free';

/** カスタム tier の RPM 初期値（Options 未入力時のプレースホルダ相当） */
export const DEFAULT_CUSTOM_RPM = 30;

/**
 * tier プリセット（プルダウンの表示順）。RPM は保守的な目安で、実測に合わせて
 * 「カスタム」で上書きできる。無料枠は 429 が出やすいため試行回数・バックオフ上限を厚くする
 */
export const RATE_LIMIT_TIERS: readonly RateLimitTier[] = [
  {
    id: 'gemini_free',
    label: 'Gemini 無料枠（Free）',
    description: '無料枠は 1 分あたりのリクエスト数が少なく 429 が出やすいため、間隔を広めに取ります。',
    policy: { requestsPerMinute: 8, maxAttempts: 5, baseDelayMs: 2_000, maxDelayMs: 60_000 },
    editableRpm: false,
  },
  {
    id: 'gemini_tier1',
    label: 'Gemini Tier 1（従量課金）',
    description: '支払い設定済みの Tier 1。無料枠より大幅に緩い上限を想定します。',
    policy: { requestsPerMinute: 120, maxAttempts: 5, baseDelayMs: 1_000, maxDelayMs: 30_000 },
    editableRpm: false,
  },
  {
    id: 'gemini_tier2',
    label: 'Gemini Tier 2',
    description: '累計課金額の条件を満たした Tier 2。',
    policy: { requestsPerMinute: 900, maxAttempts: 4, baseDelayMs: 1_000, maxDelayMs: 20_000 },
    editableRpm: false,
  },
  {
    id: 'gemini_tier3',
    label: 'Gemini Tier 3',
    description: '最上位 Tier 3。',
    policy: { requestsPerMinute: 1_800, maxAttempts: 4, baseDelayMs: 1_000, maxDelayMs: 20_000 },
    editableRpm: false,
  },
  {
    id: 'custom',
    label: 'カスタム（RPM を手動指定）',
    description: 'OpenRouter や上記に当てはまらない場合に、実際の 1 分あたりリクエスト数を入力します。',
    policy: {
      requestsPerMinute: DEFAULT_CUSTOM_RPM,
      maxAttempts: 5,
      baseDelayMs: 2_000,
      maxDelayMs: 60_000,
    },
    editableRpm: true,
  },
  {
    id: 'unlimited',
    label: '制限なし（スロットルしない）',
    description: 'サーバ側で十分な上限がある場合のみ。バッチ間の待ち時間を入れません。',
    policy: UNLIMITED_POLICY,
    editableRpm: false,
  },
];

const TIER_BY_ID = new Map(RATE_LIMIT_TIERS.map((tier) => [tier.id, tier]));

/** 文字列が既知の tier ID か（storage 復元時のガード） */
export function isRateLimitTierId(value: unknown): value is RateLimitTierId {
  return typeof value === 'string' && TIER_BY_ID.has(value as RateLimitTierId);
}

/** tier 定義を引く（未知 ID は既定 tier へフォールバック） */
export function getRateLimitTier(id: RateLimitTierId): RateLimitTier {
  return TIER_BY_ID.get(id) ?? (TIER_BY_ID.get(DEFAULT_RATE_LIMIT_TIER_ID) as RateLimitTier);
}

/**
 * tier ID（+ カスタム RPM）から実効ポリシーを解決する。
 * カスタム tier のときだけ customRpm でプリセットの RPM を上書きする（正の整数のみ採用）
 */
export function resolvePolicyForTier(
  id: RateLimitTierId,
  customRpm: number | null = null,
): RateLimitPolicy {
  const tier = getRateLimitTier(id);
  if (tier.editableRpm && customRpm !== null && Number.isFinite(customRpm) && customRpm > 0) {
    return { ...tier.policy, requestsPerMinute: Math.floor(customRpm) };
  }
  return tier.policy;
}

/**
 * ポリシーの RPM からバッチ間の最小リクエスト間隔（ms）を導く。
 * RPM 未設定・0 以下なら null（スロットルしない）
 */
export function throttleIntervalMs(policy: RateLimitPolicy): number | null {
  if (policy.requestsPerMinute === null || policy.requestsPerMinute <= 0) {
    return null;
  }
  return Math.ceil(60_000 / policy.requestsPerMinute);
}

/** applyRateLimitPolicy のタイマー注入（テストで仮想クロックへ差し替える） */
export interface RateLimitClockDeps {
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * provider をポリシーに従って包む: `withRetry(withThrottle(provider))`。
 * throttle を retry の内側に置くことで、初回だけでなくリトライの各再送も RPM 間隔で間引く。
 * provider は通常 withLogging 済みのものを渡す（全試行をログに残すため）
 */
export function applyRateLimitPolicy(
  provider: LLMProvider,
  policy: RateLimitPolicy,
  clock: RateLimitClockDeps = {},
): LLMProvider {
  const interval = throttleIntervalMs(policy);
  const throttled =
    interval === null
      ? provider
      : withThrottle(provider, { minIntervalMs: interval, sleep: clock.sleep, now: clock.now });
  return withRetry(throttled, {
    maxAttempts: policy.maxAttempts,
    baseDelayMs: policy.baseDelayMs,
    maxDelayMs: policy.maxDelayMs,
    sleep: clock.sleep,
  });
}
