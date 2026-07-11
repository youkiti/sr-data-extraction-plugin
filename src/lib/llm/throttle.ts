// 対策 A: バッチ間スロットル。任意の LLMProvider を「直近リクエストから最小間隔を空ける」
// ラッパで包む（一括抽出の 429 対策。docs/requirements.md §4.3）。
//
// executeRun はバッチ（= 1 study）を逐次 await で回すが、バッチ間に待ち時間が無いため
// N 本のリクエストが実質ゼロ間隔で連射され、プロバイダの RPM（requests per minute）を
// 即座に超えて 429 を招く。ここで各 chat の前に一定間隔を確保し、連射を平準化する。
//
// スケジューリングは nextAllowedAt 方式: 各呼び出しは max(now, nextAllowedAt) の時刻に発火し、
// nextAllowedAt を minIntervalMs だけ進める。同期部（時刻計算と nextAllowedAt 更新）は
// 最初の await より前に完了するため、並行呼び出しでも取りこぼしなく間引ける。
import type { ChatMessage, ChatOptions, ChatResponse, LLMProvider } from './LLMProvider';

export interface ThrottleOptions {
  /** 直近リクエストから空ける最小間隔（ms）。RPM から throttleIntervalMs で導く */
  minIntervalMs: number;
  /** テスト時に差し替え可能な sleep 実装 */
  sleep?: (ms: number) => Promise<void>;
  /** テスト時に差し替え可能な現在時刻（ms） */
  now?: () => number;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultNow(): number {
  return Date.now();
}

export function withThrottle(provider: LLMProvider, options: ThrottleOptions): LLMProvider {
  const minIntervalMs = options.minIntervalMs;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? defaultNow;
  let nextAllowedAt = 0;

  return {
    providerId: provider.providerId,
    model: provider.model,
    supportsImageInput: provider.supportsImageInput,
    chat: async (messages: readonly ChatMessage[], opts?: ChatOptions): Promise<ChatResponse> => {
      const current = now();
      const scheduledAt = Math.max(current, nextAllowedAt);
      nextAllowedAt = scheduledAt + minIntervalMs;
      const wait = scheduledAt - current;
      if (wait > 0) {
        await sleep(wait);
      }
      return provider.chat(messages, opts);
    },
  };
}
