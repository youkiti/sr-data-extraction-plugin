// BYOK シークレット（Gemini API キー等）の保存・読み出し。
// 値は chrome.storage.local にのみ置き、ログへ出す場合は utils/sanitizeSecret を通すこと
import { getLocal, removeLocal, setLocal } from './chromeStorage';

const GEMINI_API_KEY_STORAGE_KEY = 'secrets.geminiApiKey';

export async function loadGeminiApiKey(): Promise<string | null> {
  return (await getLocal<string>(GEMINI_API_KEY_STORAGE_KEY)) ?? null;
}

/** trim して保存する。空文字は保存抑止（docs/ui-states.md §2 状態 A） */
export async function saveGeminiApiKey(key: string): Promise<void> {
  const trimmed = key.trim();
  if (trimmed === '') {
    throw new Error('空の API キーは保存できません');
  }
  await setLocal(GEMINI_API_KEY_STORAGE_KEY, trimmed);
}

export async function clearGeminiApiKey(): Promise<void> {
  await removeLocal(GEMINI_API_KEY_STORAGE_KEY);
}
