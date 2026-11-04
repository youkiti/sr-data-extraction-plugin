// 検証画面の「要相談」初回案内を表示済みかの記録（issue #425）。
// 端末・ブラウザのプロファイルの chrome.storage.local に、閉じたユーザーのメールアドレスを
// 配列で持つ（プロジェクトをまたいで 1 回だけ出すため、プロジェクトでは分けない）
import { getLocal, setLocal } from './chromeStorage';

export const CONSULT_HINT_STORAGE_KEY = 'consultHintSeenBy';

async function loadSeenBy(): Promise<string[]> {
  const stored = await getLocal<unknown>(CONSULT_HINT_STORAGE_KEY);
  return Array.isArray(stored) ? stored.filter((value): value is string => typeof value === 'string') : [];
}

/** そのユーザーが案内を閉じたことがあるか */
export async function isConsultHintSeen(user: string): Promise<boolean> {
  return (await loadSeenBy()).includes(user);
}

/** そのユーザーが案内を閉じたことを記録する（記録済みなら何もしない） */
export async function markConsultHintSeen(user: string): Promise<void> {
  const seenBy = await loadSeenBy();
  if (seenBy.includes(user)) return;
  await setLocal(CONSULT_HINT_STORAGE_KEY, [...seenBy, user]);
}
