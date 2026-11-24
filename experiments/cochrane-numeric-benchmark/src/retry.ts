// extraction-benchmark-real/src/retryPolicy.ts の errorInfo とバックオフ定数を移植・拡張。
export interface ErrorInfo {
  status: number | null;
  retryAfterMs: number | null;
  responseBody: string | null;
  message: string;
  failureKind: string | null;
  retryable: boolean | null;
}
export function errorInfo(error: unknown): ErrorInfo {
  const obj = typeof error === 'object' && error !== null ? error as Record<string, unknown> : {};
  const status = typeof obj.status === 'number' ? obj.status : null;
  const retryAfterMs = typeof obj.retryAfterMs === 'number' ? obj.retryAfterMs : null;
  const responseBody = typeof obj.responseBody === 'string' ? obj.responseBody : null;
  const message = typeof obj.message === 'string' ? obj.message : String(error);
  const failureKind = typeof obj.failureKind === 'string' ? obj.failureKind : null;
  const retryable = typeof obj.retryable === 'boolean' ? obj.retryable : null;
  return { status, retryAfterMs, responseBody, message, failureKind, retryable };
}
export type FailureKind = 'spend_cap' | 'auth' | 'retryable' | 'other';
export function classifyFailure(info: ErrorInfo): FailureKind {
  if (info.status === 429 && /spending cap/i.test(info.responseBody ?? '')) return 'spend_cap';
  if (info.status === 401 || info.status === 403) return 'auth';
  if (info.failureKind === 'content_filter' || info.failureKind === 'malformed') return 'other';
  if (info.status === 429 || (info.status !== null && info.status >= 500) || info.failureKind === 'timeout' ||
      info.failureKind === 'output_limit' || info.retryable === true || info.status === null) return 'retryable';
  return 'other';
}
const RETRY_BACKOFF_MS = [15_000, 45_000, 90_000] as const;
const RETRY_MAX_WAIT_MS = 120_000;
export const RETRY_MAX_ATTEMPTS = 4;
export function retryDecision(kind: FailureKind, attempt: number, retryAfterMs: number | null) {
  if (kind !== 'retryable' || attempt >= RETRY_MAX_ATTEMPTS) return { retry: false, waitMs: 0 };
  return { retry: true, waitMs: Math.min(Math.max(retryAfterMs ?? 0, RETRY_BACKOFF_MS[attempt - 1] ?? RETRY_MAX_WAIT_MS), RETRY_MAX_WAIT_MS) };
}
