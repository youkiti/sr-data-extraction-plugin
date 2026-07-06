// アプリ設定（秘密情報でない値）の保存・読み出し。
// 秘密情報（API キー等）は lib/storage/secretsStore に置き、こちらへは足さない
import { getLocal, removeLocal, setLocal } from './chromeStorage';

const DEFAULT_MODEL_STORAGE_KEY = 'settings.defaultModel';

/**
 * 工場出荷の既定モデル。ユーザーが Options で既定モデルを未設定のとき、S5 スキーマ画面の
 * 初期値として使う（下流の S6 パイロット / S7 一括抽出も S5 のモデルを引き継ぐ）。
 * 実データ抽出ベンチマーク（experiments/extraction-benchmark-real/REPORT.md, 2026-07-06）で
 * gemini-3.5-flash が最良の項目正確度（成功 run 72%）だったため採用。
 * これは注入側（schemaService）で使う定数で、loadDefaultModel は未設定時 null のまま
 * （Options UI が「保存済み / 未設定」を区別できるようにするため）。
 */
export const FACTORY_DEFAULT_MODEL = 'gemini-3.5-flash';

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
