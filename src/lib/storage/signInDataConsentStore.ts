// サインインの前の告知への同意を端末・ブラウザのプロファイルごとに記録する。
// AI の同意と同じく Google アカウントには紐付かず、ログアウトでは消さない。
import { getLocal, removeLocal, setLocal } from './chromeStorage';

export const SIGN_IN_DATA_CONSENT_STORAGE_KEY = 'signInDataConsent';

/** 告知の版。扱うデータや用途・保存先の説明を実質的に変えたら上げる */
export const SIGN_IN_DATA_CONSENT_VERSION = 1;

export interface SignInDataConsentRecord {
  version: number;
  /** 同意した日時（ISO 8601） */
  acceptedAt: string;
}

function isSignInDataConsentRecord(value: unknown): value is SignInDataConsentRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.version === 'number' && typeof record.acceptedAt === 'string';
}

/** 保存済みの記録を返す（未保存・壊れた値は null） */
export async function loadSignInDataConsent(): Promise<SignInDataConsentRecord | null> {
  const stored = await getLocal<unknown>(SIGN_IN_DATA_CONSENT_STORAGE_KEY);
  return isSignInDataConsentRecord(stored) ? { version: stored.version, acceptedAt: stored.acceptedAt } : null;
}

export async function saveSignInDataConsent(record: SignInDataConsentRecord): Promise<void> {
  await setLocal(SIGN_IN_DATA_CONSENT_STORAGE_KEY, record);
}

export async function clearSignInDataConsent(): Promise<void> {
  await removeLocal(SIGN_IN_DATA_CONSENT_STORAGE_KEY);
}

/** 記録が現在の同意文の版に対するものか */
export function isCurrentSignInDataConsent(record: SignInDataConsentRecord | null): record is SignInDataConsentRecord {
  return record !== null && record.version === SIGN_IN_DATA_CONSENT_VERSION;
}
