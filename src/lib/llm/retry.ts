// 任意の LLMProvider を「一時的エラー時に指数バックオフで再試行する」ラッパで包む
// （sr-query-builder の lib/llm/retry.ts を流用）。
//
// Gemini API は過負荷時に HTTP 503 / レート制限時に 429 を返すことがあり、
// これらは数秒待って再送すれば成功する可能性が高い。4xx の入力エラー
// （400 / 401 / 403 など）は再試行しても無駄なので即座に投げ直す。
import {
  LlmProviderError,
  type ChatMessage,
  type ChatOptions,
  type ChatResponse,
  type LLMProvider,
} from './LLMProvider';

/** 再試行対象の HTTP ステータス（一時的エラーのみ） */
export const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([429, 500, 502, 503, 504]);

export interface RetryOptions {
  /** 最大試行回数（初回を含む）。既定 3 回 */
  maxAttempts?: number;
  /** バックオフの基準待ち時間（ms）。試行 n 回目の失敗後に baseDelayMs * 2^(n-1) 待つ。既定 1000 */
  baseDelayMs?: number;
  /** バックオフ上限（ms）。指数バックオフもサーバ提示の retryDelay もこの上限で頭打ち。既定 上限なし */
  maxDelayMs?: number;
  /** テスト時に差し替え可能な sleep 実装 */
  sleep?: (ms: number) => Promise<void>;
  /** 再試行可否の判定。既定は LlmProviderError かつ status が RETRYABLE_STATUSES */
  isRetryable?: (err: unknown) => boolean;
}

/**
 * 既定の再試行判定（issue #187 で拡張）:
 * - LlmProviderError: 一時的な HTTP ステータス（429/5xx）、または provider 実装が
 *   `retryable=true` を明示したもの（HTTP 200 なのに応答ボディが途切れている等）
 * - TypeError: fetch のネットワーク断（Chrome の `Failed to fetch`）。実プロジェクトの
 *   LLMApiLog で最多の一時的失敗だったため再試行対象にする
 */
function defaultIsRetryable(err: unknown): boolean {
  if (err instanceof LlmProviderError) {
    return err.retryable || (err.status !== null && RETRYABLE_STATUSES.has(err.status));
  }
  return err instanceof TypeError;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * HTTP `Retry-After` ヘッダを ms へ解釈する（provider が 4xx/5xx 応答から抽出して
 * LlmProviderError.retryAfterMs へ載せるためのユーティリティ）。
 * - 数値は「秒」（RFC 7231）として ms へ換算
 * - HTTP-date は現在時刻との差分（過去日付は 0）
 * - 解釈不能・null は null
 */
export function parseRetryAfterMs(
  headerValue: string | null,
  now: () => number = () => Date.now(),
): number | null {
  if (headerValue === null) {
    return null;
  }
  const trimmed = headerValue.trim();
  if (trimmed === '') {
    return null;
  }
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds)) {
    return Math.max(0, Math.ceil(seconds * 1000));
  }
  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - now());
  }
  return null;
}

/**
 * サーバが提示した再送待ち時間（ms）。Retry-After ヘッダ（retryAfterMs）を最優先し、
 * 無ければ本文の gRPC RetryInfo（`"retryDelay": "42s"`。Gemini の 429 応答が使う）を拾う。
 * 提示が無ければ null
 */
export function parseServerRetryDelayMs(err: unknown): number | null {
  if (!(err instanceof LlmProviderError)) {
    return null;
  }
  if (err.retryAfterMs !== null) {
    return err.retryAfterMs;
  }
  const match = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(err.responseBody);
  if (match) {
    return Math.ceil(Number.parseFloat(match[1] as string) * 1000);
  }
  return null;
}

export function withRetry(provider: LLMProvider, options: RetryOptions = {}): LLMProvider {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 1000;
  const maxDelayMs = options.maxDelayMs ?? Number.POSITIVE_INFINITY;
  const sleep = options.sleep ?? defaultSleep;
  const isRetryable = options.isRetryable ?? defaultIsRetryable;

  return {
    providerId: provider.providerId,
    model: provider.model,
    supportsImageInput: provider.supportsImageInput,
    chat: async (messages: readonly ChatMessage[], opts?: ChatOptions): Promise<ChatResponse> => {
      for (let attempt = 1; ; attempt += 1) {
        try {
          return await provider.chat(messages, opts);
        } catch (err) {
          if (attempt >= maxAttempts || !isRetryable(err)) {
            throw err;
          }
          // 指数バックオフとサーバ提示の retryDelay の大きい方を採用し、上限で頭打ちにする。
          // 429 でサーバが「n 秒待て」と言う場合、それより短い再送は無駄なので尊重する
          const backoff = baseDelayMs * 2 ** (attempt - 1);
          const serverDelay = parseServerRetryDelayMs(err) ?? 0;
          await sleep(Math.min(maxDelayMs, Math.max(backoff, serverDelay)));
        }
      }
    },
  };
}
