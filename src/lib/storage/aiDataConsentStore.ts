// AI へ送る前の告知への同意の記録（issue #381。docs/requirements.md §6.1）。
// 端末・ブラウザのプロファイルごとに chrome.storage.local へ 1 件だけ持つ。
// Google アカウントには紐付かないため、サインアウトでは消さない（API キー等の設定と同じ扱い）
import { getLocal, removeLocal, setLocal } from './chromeStorage';

export const AI_DATA_CONSENT_STORAGE_KEY = 'aiDataConsent';

/**
 * 同意文の版。ダイアログで示す内容（送る内容・送り先・扱い）を実質的に変えたら上げる。
 * 記録の版と一致しないときは同意を取り直す
 */
export const AI_DATA_CONSENT_VERSION = 1;

export interface AiDataConsentRecord {
  version: number;
  /** 同意した日時（ISO 8601） */
  acceptedAt: string;
}

function isAiDataConsentRecord(value: unknown): value is AiDataConsentRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.version === 'number' && typeof record.acceptedAt === 'string';
}

/** 保存済みの記録を返す（未保存・壊れた値は null） */
export async function loadAiDataConsent(): Promise<AiDataConsentRecord | null> {
  const stored = await getLocal<unknown>(AI_DATA_CONSENT_STORAGE_KEY);
  return isAiDataConsentRecord(stored) ? { version: stored.version, acceptedAt: stored.acceptedAt } : null;
}

export async function saveAiDataConsent(record: AiDataConsentRecord): Promise<void> {
  await setLocal(AI_DATA_CONSENT_STORAGE_KEY, record);
}

export async function clearAiDataConsent(): Promise<void> {
  await removeLocal(AI_DATA_CONSENT_STORAGE_KEY);
}

/** 記録が現在の同意文の版に対するものか */
export function isCurrentAiDataConsent(record: AiDataConsentRecord | null): record is AiDataConsentRecord {
  return record !== null && record.version === AI_DATA_CONSENT_VERSION;
}
