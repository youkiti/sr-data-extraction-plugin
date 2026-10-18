// 429 の再試行方針（純粋関数）。
//
// 旧 runner.ts の chatWithRetry は `error instanceof LlmProviderError` で status を読んでいたが、
// tsx のモジュール同一性の都合で instanceof が不安定になることがある（改修前の runner.ts が
// AiOutputFormatError について注意書きしていたのと同じ現象。archive/src-pre-v9-20260921/runner.ts
// 参照）。instanceof が偽になると status が読めず null 扱いに
// なり、本来は再試行すべき 429（Google プロジェクトの月間利用上限を除く）まで即 throw していた
// （2026-09-21 の本実行で実測: gemini-3.5-flash-lite の最後 3 run が 250〜270ms で即失敗）。
//
// この対策として、失敗の分類は instanceof を一切使わず、エラーオブジェクトのプロパティを
// duck-typing で読む（型が合うときだけ採用。any にはしない）。
import { redactSecret } from './costGuard';

export interface ErrorInfo {
  status: number | null;
  retryAfterMs: number | null;
  responseBody: string | null;
  message: string;
}

/**
 * エラーオブジェクトから status / retryAfterMs / responseBody / message を duck-typing で読む。
 * `instanceof LlmProviderError` は使わない（モジュール同一性の都合で不安定なため）。
 * プロパティの型が期待どおりのときだけ採用し、合わなければ null（message だけは必ず文字列を返す）。
 */
export function errorInfo(error: unknown): ErrorInfo {
  if (typeof error !== 'object' || error === null) {
    return { status: null, retryAfterMs: null, responseBody: null, message: String(error) };
  }
  const obj = error as Record<string, unknown>;
  const status = typeof obj.status === 'number' ? obj.status : null;
  const retryAfterMs = typeof obj.retryAfterMs === 'number' ? obj.retryAfterMs : null;
  const responseBody = typeof obj.responseBody === 'string' ? obj.responseBody : null;
  const message = typeof obj.message === 'string' ? obj.message : String(error);
  return { status, retryAfterMs, responseBody, message };
}

export type FailureClassification = 'spend_cap' | 'rate_limit' | 'server_error' | 'auth' | 'other';

/**
 * 失敗の分類。状態を先に列挙する:
 * - status 429 かつ responseBody に "spending cap" を含む（大文字小文字無視）→ spend_cap
 *   （Google プロジェクトの月間利用上限。再試行しても通らず、人が上限を変えるまで全 run が
 *   同じ理由で落ちる。レート制限とは別に扱う）
 * - それ以外の status 429 → rate_limit
 * - status 500 以上 → server_error
 * - status 401 / 403 → auth
 * - status が null（fetch 自体の失敗・タイムアウト）や他の 4xx、finishReason による打ち切り等 → other
 */
export function classifyFailure(info: ErrorInfo): FailureClassification {
  const { status, responseBody } = info;
  if (status === 429) {
    if (responseBody !== null && /spending cap/i.test(responseBody)) {
      return 'spend_cap';
    }
    return 'rate_limit';
  }
  if (status !== null && status >= 500) {
    return 'server_error';
  }
  if (status === 401 || status === 403) {
    return 'auth';
  }
  return 'other';
}

/** バックオフ（ms）。attempt（1始まり）が引くインデックス。4 回目以降は最後の値を使い回す */
const RETRY_BACKOFF_MS = [15_000, 45_000, 90_000] as const;
/** 待機の頭打ち */
const RETRY_MAX_WAIT_MS = 120_000;
/** 1 コールの中の試行の最大回数 */
export const RETRY_MAX_ATTEMPTS = 4;

export interface RetryDecision {
  retry: boolean;
  waitMs: number;
}

/**
 * 再試行するか・待つか。rate_limit と server_error だけ再試行する（spend_cap・auth・other は
 * 再試行しない）。待機は `max(retryAfterMs ?? 0, バックオフ[attempt-1])` を 120000ms で頭打ちにする。
 * attempt は「いま失敗した試行」の番号（1 始まり）。RETRY_MAX_ATTEMPTS 回目の失敗はもう再試行しない
 * （4 回使い切っている）。
 */
export function retryDecision(kind: FailureClassification, attempt: number, retryAfterMs: number | null): RetryDecision {
  const retryable = kind === 'rate_limit' || kind === 'server_error';
  if (!retryable || attempt >= RETRY_MAX_ATTEMPTS) {
    return { retry: false, waitMs: 0 };
  }
  // attempt はここまでで 1..RETRY_MAX_ATTEMPTS-1（= 1..3）なので添字は必ず範囲内だが、
  // noUncheckedIndexedAccess の型上は number | undefined になるため、最後の要素をフォールバックにする
  const backoffIndex = Math.min(attempt - 1, RETRY_BACKOFF_MS.length - 1);
  const backoff = RETRY_BACKOFF_MS[backoffIndex] ?? RETRY_MAX_WAIT_MS;
  const waitMs = Math.min(Math.max(retryAfterMs ?? 0, backoff), RETRY_MAX_WAIT_MS);
  return { retry: true, waitMs };
}

/** コンソール向けの中断メッセージ（本文の先頭 300 文字を redactSecret して返す） */
export function fatalAbortExcerpt(info: ErrorInfo, secret: string): string {
  const source = info.responseBody ?? info.message;
  return redactSecret(source.slice(0, 300), secret);
}
