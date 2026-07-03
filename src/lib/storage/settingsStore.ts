// アプリ設定（秘密情報でない値）の保存・読み出し。
// 秘密情報（API キー等）は lib/storage/secretsStore に置き、こちらへは足さない
import { getLocal, removeLocal, setLocal } from './chromeStorage';

const DEFAULT_MODEL_STORAGE_KEY = 'settings.defaultModel';

/** 既定モデル設定を読み出す（未設定は null） */
export async function loadDefaultModel(): Promise<string | null> {
  return (await getLocal<string>(DEFAULT_MODEL_STORAGE_KEY)) ?? null;
}

/**
 * trim して保存する。空文字は「未設定に戻す」として削除する
 * （API キーと違い空での解除を許す。docs/ui-states.md §2「既定モデル」）
 */
export async function saveDefaultModel(model: string): Promise<void> {
  const trimmed = model.trim();
  if (trimmed === '') {
    await removeLocal(DEFAULT_MODEL_STORAGE_KEY);
    return;
  }
  await setLocal(DEFAULT_MODEL_STORAGE_KEY, trimmed);
}
