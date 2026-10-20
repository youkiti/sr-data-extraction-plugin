// AI へ送る前の告知と同意のゲート（issue #381。docs/requirements.md §6.1・ui-states.md §3）。
// LLM API を呼ぶ各サービスは、API キー・接続方式の検証の後、画面を「実行中」にする前に
// confirmAiDataConsent を await し、false なら何もせずに戻る。
// 同意の記録が現在の版なら何も出さず true。無ければダイアログを開き、同意なら記録して true
import type { LlmProviderId } from '../../domain/llmApiLog';
import {
  AI_DATA_CONSENT_VERSION,
  isCurrentAiDataConsent,
  type AiDataConsentRecord,
} from '../storage/aiDataConsentStore';

/** 同意を確かめる関数。true = 実行してよい / false = 利用者がキャンセルした */
export type EnsureAiDataConsent = (provider: LlmProviderId) => Promise<boolean>;

export interface AiDataConsentGateDeps {
  loadConsent: () => Promise<AiDataConsentRecord | null>;
  saveConsent: (record: AiDataConsentRecord) => Promise<void>;
  /** 同意ダイアログを開き、「同意して続行」なら true・キャンセルなら false で解決する */
  openDialog: (provider: LlmProviderId) => Promise<boolean>;
  now?: () => string;
}

/**
 * 同意ゲートを作る。並行した呼び出し（ダイアログ表示中の別操作）は同じダイアログの結果を待ち、
 * ダイアログを 2 つ以上出さない
 */
export function createAiDataConsentGate(deps: AiDataConsentGateDeps): EnsureAiDataConsent {
  let pending: Promise<boolean> | null = null;
  const check = async (provider: LlmProviderId): Promise<boolean> => {
    let record: AiDataConsentRecord | null = null;
    try {
      record = await deps.loadConsent();
    } catch (error) {
      // 読めないときは未同意として扱う（確認を飛ばす方向へは倒さない）
      console.warn('[consent] 同意の記録の読み込みに失敗:', error);
    }
    if (isCurrentAiDataConsent(record)) {
      return true;
    }
    if (!(await deps.openDialog(provider))) {
      return false;
    }
    const acceptedAt = (deps.now ?? (() => new Date().toISOString()))();
    try {
      await deps.saveConsent({ version: AI_DATA_CONSENT_VERSION, acceptedAt });
    } catch (error) {
      // 今回の操作は利用者の同意に基づいて続ける。記録できなかったので次回また確認する
      console.warn('[consent] 同意の記録の保存に失敗:', error);
    }
    return true;
  };
  return (provider) => {
    if (pending === null) {
      pending = check(provider).finally(() => {
        pending = null;
      });
    }
    return pending;
  };
}

/**
 * サービスの入り口で呼ぶ。deps に同意ゲートが無い（unit テスト・接続テスト等）ときは true。
 * 本番の依存（app/bootstrap.ts の createChromeAppDeps）は必ずゲートを注入する
 */
export async function confirmAiDataConsent(
  deps: { ensureAiDataConsent?: EnsureAiDataConsent },
  provider: LlmProviderId,
): Promise<boolean> {
  return deps.ensureAiDataConsent ? deps.ensureAiDataConsent(provider) : true;
}
