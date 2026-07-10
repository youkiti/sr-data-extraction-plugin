// アプリ設定（秘密情報でない値）の保存・読み出し。
// 秘密情報（API キー等）は lib/storage/secretsStore に置き、こちらへは足さない
import {
  DEFAULT_RATE_LIMIT_TIER_ID,
  isRateLimitTierId,
  resolvePolicyForTier,
  type RateLimitPolicy,
  type RateLimitTierId,
} from '../llm/rateLimitPolicy';
import { getLocal, removeLocal, setLocal } from './chromeStorage';

const DEFAULT_MODEL_STORAGE_KEY = 'settings.defaultModel';
const RATE_LIMIT_TIER_STORAGE_KEY = 'settings.rateLimitTier';
const RATE_LIMIT_CUSTOM_RPM_STORAGE_KEY = 'settings.rateLimitCustomRpm';
const RATE_LIMIT_CUSTOM_CONCURRENCY_STORAGE_KEY = 'settings.rateLimitCustomConcurrency';

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

/**
 * レート制限 tier を読み出す（未設定・不正値は既定 = gemini_free）。
 * 一括抽出の 429 対策（スロットル + リトライ）のポリシーを決める（docs/ui-states.md §2「レート制限」）
 */
export async function loadRateLimitTier(): Promise<RateLimitTierId> {
  const stored = await getLocal<string>(RATE_LIMIT_TIER_STORAGE_KEY);
  return isRateLimitTierId(stored) ? stored : DEFAULT_RATE_LIMIT_TIER_ID;
}

/** レート制限 tier を保存する */
export async function saveRateLimitTier(tier: RateLimitTierId): Promise<void> {
  await setLocal(RATE_LIMIT_TIER_STORAGE_KEY, tier);
}

/** カスタム tier の RPM を読み出す（未設定・不正値は null） */
export async function loadRateLimitCustomRpm(): Promise<number | null> {
  const stored = await getLocal<number>(RATE_LIMIT_CUSTOM_RPM_STORAGE_KEY);
  return typeof stored === 'number' && Number.isFinite(stored) && stored > 0 ? stored : null;
}

/**
 * カスタム tier の RPM を保存する。正の整数のみ採用し、それ以外は保存キーを削除する
 * （＝カスタム tier でも RPM 未設定 → プリセット既定へフォールバック）
 */
export async function saveRateLimitCustomRpm(rpm: number): Promise<void> {
  if (!Number.isFinite(rpm) || rpm <= 0) {
    await removeLocal(RATE_LIMIT_CUSTOM_RPM_STORAGE_KEY);
    return;
  }
  await setLocal(RATE_LIMIT_CUSTOM_RPM_STORAGE_KEY, Math.floor(rpm));
}

/** カスタム tier の同時実行数を読み出す（未設定・不正値は null = 逐次） */
export async function loadRateLimitCustomConcurrency(): Promise<number | null> {
  const stored = await getLocal<number>(RATE_LIMIT_CUSTOM_CONCURRENCY_STORAGE_KEY);
  return typeof stored === 'number' && Number.isFinite(stored) && stored > 0 ? stored : null;
}

/**
 * カスタム tier の同時実行数を保存する。正の整数のみ採用し、それ以外は保存キーを削除する
 * （＝未設定 → プリセット既定 = 逐次へフォールバック）。並列化のスループット実験用
 * （docs/handoff-20260710-throughput.md）
 */
export async function saveRateLimitCustomConcurrency(concurrency: number): Promise<void> {
  if (!Number.isFinite(concurrency) || concurrency <= 0) {
    await removeLocal(RATE_LIMIT_CUSTOM_CONCURRENCY_STORAGE_KEY);
    return;
  }
  await setLocal(RATE_LIMIT_CUSTOM_CONCURRENCY_STORAGE_KEY, Math.floor(concurrency));
}

/**
 * 保存済みの tier + カスタム RPM + カスタム同時実行数から実効レート制限ポリシーを解決する
 * （サービス層が注入して使う）
 */
export async function resolveRateLimitPolicy(): Promise<RateLimitPolicy> {
  const [tier, customRpm, customConcurrency] = await Promise.all([
    loadRateLimitTier(),
    loadRateLimitCustomRpm(),
    loadRateLimitCustomConcurrency(),
  ]);
  return resolvePolicyForTier(tier, customRpm, customConcurrency);
}
