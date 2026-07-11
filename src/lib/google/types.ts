// sr-query-builder-plugin の lib/google/types.ts をコピー流用（architecture.md §7-3。
// npm 切り出しは 3 拡張が揃ってから判断）
//
// 429/503 リトライ（2026-07-10）: Sheets/Drive API の書き込みクォータ（60 回/分/ユーザー）に
// 短時間で当たると HTTP 429（RESOURCE_EXHAUSTED）が返る。503 も含め一時的なエラーは
// 指数バックオフで自動再送する（docs/handoff-20260710-sheets-write-batching.md）。
// 考え方は lib/llm/retry.ts の withRetry と同じ（サーバ提示の Retry-After を尊重）だが、
// GoogleApiDeps は fetch/getAccessToken のみの薄い依存に留めたいため、リトライ設定は
// googleFetch の第4引数（省略可）として渡す設計にした
import { parseRetryAfterMs } from '../llm/retry';

/**
 * Google API 呼び出しに共通で必要な依存。
 * fetch / OAuth トークン取得を注入することで OAuth 無しでも単体テスト可能。
 */
export interface GoogleApiDeps {
  fetch: typeof fetch;
  /** アクセストークンを取得する関数。失効時は再取得も行う */
  getAccessToken: () => Promise<string>;
}

/** Google API が 4xx/5xx を返したときの型付きエラー */
export class GoogleApiError extends Error {
  readonly status: number;
  readonly endpoint: string;
  readonly responseBody: string;

  constructor(message: string, status: number, endpoint: string, responseBody: string) {
    super(message);
    this.name = 'GoogleApiError';
    this.status = status;
    this.endpoint = endpoint;
    this.responseBody = responseBody;
  }
}

/** googleFetch のリトライ挙動を調整するオプション（すべて省略可・既定値あり） */
export interface GoogleFetchRetryOptions {
  /** 最大試行回数（初回を含む）。既定 5 回 */
  maxAttempts?: number;
  /** バックオフの基準待ち時間（ms）。試行 n 回目の失敗後に baseDelayMs * 2^(n-1) 待つ。既定 1000 */
  baseDelayMs?: number;
  /** バックオフ上限（ms）。指数バックオフ・サーバ提示の Retry-After ともこの上限で頭打ち。既定 30000 */
  maxDelayMs?: number;
  /** テスト時に差し替え可能な sleep 実装（仮想クロックで待たずにテストするため） */
  sleep?: (ms: number) => Promise<void>;
  /** ジッタ用の乱数源（0 以上 1 未満）。既定 Math.random。テストで固定して決定的に検証する */
  random?: () => number;
}

/**
 * リトライ対象の HTTP ステータス。
 * 429 = 書き込み/読み取りクォータ超過、503 = 一時的な過負荷。どちらも待てば通る可能性が高い。
 * 400/401/403/404 等の入力・認可エラーはリトライしても無駄なので対象外（即 throw を維持）
 */
export const GOOGLE_RETRYABLE_STATUSES: ReadonlySet<number> = new Set([429, 503]);

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 再送までの待ち時間（ms）を決める。
 * - 指数バックオフ（baseDelayMs * 2^(attempt-1)）とサーバ提示（Retry-After ヘッダ）の
 *   大きい方を採用する（lib/llm/retry.ts withRetry と同じ考え方: サーバが「n 秒待て」と
 *   言っているなら、それより短い再送は無駄）
 * - 軽いジッタ（baseDelayMs の 0〜20%）を上乗せする。並列実行時に複数バッチが同時に
 *   429 になり、同時に再送してまた 429 になる「サンダリングヘッド」を緩和するため
 * - 最後に maxDelayMs で頭打ちにする
 */
function computeRetryDelayMs(
  attempt: number,
  serverDelayMs: number | null,
  options: { baseDelayMs: number; maxDelayMs: number; random: () => number },
): number {
  const backoff = options.baseDelayMs * 2 ** (attempt - 1);
  const base = Math.max(backoff, serverDelayMs ?? 0);
  const jitter = options.baseDelayMs * 0.2 * options.random();
  return Math.min(options.maxDelayMs, base + jitter);
}

/**
 * 認証ヘッダ付きで fetch し、非 2xx を GoogleApiError に変換する共通ラッパ。
 * 429（クォータ超過）・503（一時的な過負荷）は指数バックオフ（+ サーバ提示の Retry-After
 * を尊重）で再試行し、それ以外（400/401/403/404 等）は即 throw する（従来挙動を維持）。
 */
export async function googleFetch(
  url: string,
  init: RequestInit,
  deps: GoogleApiDeps,
  retryOptions: GoogleFetchRetryOptions = {},
): Promise<Response> {
  const maxAttempts = retryOptions.maxAttempts ?? 5;
  const baseDelayMs = retryOptions.baseDelayMs ?? 1_000;
  const maxDelayMs = retryOptions.maxDelayMs ?? 30_000;
  const sleep = retryOptions.sleep ?? defaultSleep;
  const random = retryOptions.random ?? Math.random;

  const token = await deps.getAccessToken();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);

  for (let attempt = 1; ; attempt += 1) {
    const res = await deps.fetch(url, { ...init, headers });
    if (res.ok) {
      return res;
    }
    const retryable = GOOGLE_RETRYABLE_STATUSES.has(res.status);
    if (!retryable || attempt >= maxAttempts) {
      const body = await res.text().catch(() => '');
      throw new GoogleApiError(
        `Google API failed: HTTP ${res.status}`,
        res.status,
        url,
        body
      );
    }
    const serverDelayMs = parseRetryAfterMs(res.headers.get('Retry-After'));
    const delayMs = computeRetryDelayMs(attempt, serverDelayMs, { baseDelayMs, maxDelayMs, random });
    await sleep(delayMs);
  }
}
