// BYOK シークレット（Gemini / OpenRouter API キー等）の保存・読み出し。
// 値は chrome.storage.local にのみ置き、ログへ出す場合は utils/sanitizeSecret を通すこと
import { getLocal, removeLocal, setLocal } from './chromeStorage';

const GEMINI_API_KEY_STORAGE_KEY = 'secrets.geminiApiKey';
const OPENROUTER_API_KEY_STORAGE_KEY = 'secrets.openRouterApiKey';

// 既知の API キー プレフィックス（プロバイダの取り違え検出用）。
// 形式変更で正規キーを弾かないよう、確信できる場合だけ判定に使う（取りこぼし優先）
const GEMINI_API_KEY_PREFIX = 'AIza';
const OPENROUTER_API_KEY_PREFIX = 'sk-or-';

/** 明らかに Gemini（Google AI）のキー形式か（`AIza` 始まり）。誤入力検出専用 */
export function looksLikeGeminiApiKey(key: string): boolean {
  return key.startsWith(GEMINI_API_KEY_PREFIX);
}

/** 明らかに OpenRouter のキー形式か（`sk-or-` 始まり）。誤入力検出専用 */
export function looksLikeOpenRouterApiKey(key: string): boolean {
  return key.startsWith(OPENROUTER_API_KEY_PREFIX);
}

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

export async function loadOpenRouterApiKey(): Promise<string | null> {
  return (await getLocal<string>(OPENROUTER_API_KEY_STORAGE_KEY)) ?? null;
}

/** trim して保存する。空文字は保存抑止（Gemini キーと同じ規約） */
export async function saveOpenRouterApiKey(key: string): Promise<void> {
  const trimmed = key.trim();
  if (trimmed === '') {
    throw new Error('空の API キーは保存できません');
  }
  await setLocal(OPENROUTER_API_KEY_STORAGE_KEY, trimmed);
}

export async function clearOpenRouterApiKey(): Promise<void> {
  await removeLocal(OPENROUTER_API_KEY_STORAGE_KEY);
}
