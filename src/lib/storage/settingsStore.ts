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
import type { LlmProviderId } from '../../domain/llmApiLog';
import { isUiLanguage, type UiLanguage } from '../i18n';

const DEFAULT_MODEL_STORAGE_KEY = 'settings.defaultModel';
const UI_LANGUAGE_STORAGE_KEY = 'settings.uiLanguage';
const LLM_PROVIDER_STORAGE_KEY = 'settings.llmProvider';
const OPENAI_COMPATIBLE_ENDPOINT_STORAGE_KEY = 'settings.openAiCompatibleEndpoint';
const HTTP_LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);
const RATE_LIMIT_TIER_STORAGE_KEY = 'settings.rateLimitTier';
const RATE_LIMIT_CUSTOM_RPM_STORAGE_KEY = 'settings.rateLimitCustomRpm';
const RATE_LIMIT_CUSTOM_CONCURRENCY_STORAGE_KEY = 'settings.rateLimitCustomConcurrency';
const VERIFY_LAYOUT_MODE_STORAGE_KEY = 'settings.verifyLayoutMode';
const VERIFY_PANE_LAYOUT_STORAGE_KEY = 'settings.verifyPaneLayout';

/** 検証パネル（S6 埋め込み / S8 単独）のレイアウトモード（issue #38）。既定はフォーカス */
export type VerifyLayoutMode = 'focus' | 'list';

function isVerifyLayoutMode(value: unknown): value is VerifyLayoutMode {
  return value === 'focus' || value === 'list';
}

/**
 * 検証パネル（S6 埋め込み / S8 単独）の 2 ペインのサイズ調整（issue #193）。
 * 2 値を 1 オブジェクトにまとめ、下流（verificationService / store / bootstrap）への
 * プランビングを 1 本で済ませる。いずれも null = 未設定 = 既定の見た目のまま
 */
export interface VerifyPaneLayout {
  /** 右ペイン（判定項目枠 `.verify__pane--form`）の高さ。単位は px。null = 既定（CSS の 75vh 上限） */
  formPaneHeight: number | null;
  /**
   * 左右比率: `.verify__panes` 内で PDF ペインが占める割合（0〜1 の小数。例 0.6 = PDF 60% /
   * 判定項目枠 40%）。null = 既定（`flex: 1 1 600px` / `flex: 1 1 480px` 相当の自然な比率）
   */
  pdfPaneRatio: number | null;
}

/** 未設定を表す既定値（load 前の初期状態・store の初期値で使う） */
export const DEFAULT_VERIFY_PANE_LAYOUT: VerifyPaneLayout = {
  formPaneHeight: null,
  pdfPaneRatio: null,
};

// UI 操作としてこれ以上小さく/大きくしても実用にならない範囲（ui-flow.md §8 の min-width とは別に、
// 高さ側の実用下限・暴走防止の上限を設ける）
const MIN_FORM_PANE_HEIGHT = 240;
const MAX_FORM_PANE_HEIGHT = 4000;
// PDF ペインの比率の実用範囲（両ペインとも 0 に近づくと min-width で無意味な UI になるため、
// クランプの余地としてこの範囲に収める。実際の min-width 遵守はパネル側のドラッグ処理が担う）
const MIN_PDF_PANE_RATIO = 0.1;
const MAX_PDF_PANE_RATIO = 0.9;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * 型違い・NaN・非正値は「不正」として null（既定へフォールバック）。
 * 数値として妥当だが実用範囲を外れる値は範囲内へクランプする（保存側・読込側の双方で通す）
 */
function normalizeFormPaneHeight(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return clamp(value, MIN_FORM_PANE_HEIGHT, MAX_FORM_PANE_HEIGHT);
}

/** 比率は (0, 1) の開区間のみ有効値として受け付ける（0 / 1 / それ以外は「未設定」扱い） */
function normalizePdfPaneRatio(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value >= 1) {
    return null;
  }
  return clamp(value, MIN_PDF_PANE_RATIO, MAX_PDF_PANE_RATIO);
}

export interface LlmConnectionSettings {
  /** null は既存環境。モデル ID による従来判定へフォールバックする */
  provider: LlmProviderId | null;
  openAiCompatibleEndpoint: string | null;
}

const LLM_PROVIDERS: ReadonlySet<string> = new Set([
  'gemini',
  'openrouter',
  'openai_compatible',
]);

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

/** OpenAI 互換 Chat Completions の完全 URL を検証・正規化する */
export function normalizeOpenAiCompatibleEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('有効な API エンドポイント URL を入力してください');
  }
  const isLoopbackHttp = url.protocol === 'http:' && HTTP_LOOPBACK_HOSTNAMES.has(url.hostname);
  if (url.protocol !== 'https:' && !isLoopbackHttp) {
    throw new Error(
      'API エンドポイントは HTTPS、または localhost / 127.0.0.1 / [::1] の HTTP で指定してください',
    );
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error('API エンドポイントに認証情報を含めないでください');
  }
  if (url.search !== '' || url.hash !== '') {
    throw new Error('API エンドポイントにクエリ文字列やフラグメントを含めないでください');
  }
  return url.toString();
}

/** 認証なし HTTP を許可できる、完全一致の loopback URL か */
export function isLoopbackEndpoint(endpoint: string): boolean {
  const url = new URL(normalizeOpenAiCompatibleEndpoint(endpoint));
  return url.protocol === 'http:' && HTTP_LOOPBACK_HOSTNAMES.has(url.hostname);
}

/** 接続方式と OpenAI 互換 API の URL を読み出す */
export async function loadLlmConnectionSettings(): Promise<LlmConnectionSettings> {
  const rawProvider = await getLocal<string>(LLM_PROVIDER_STORAGE_KEY);
  const provider =
    rawProvider !== undefined && LLM_PROVIDERS.has(rawProvider)
      ? (rawProvider as LlmProviderId)
      : null;
  const endpoint = await getLocal<string>(OPENAI_COMPATIBLE_ENDPOINT_STORAGE_KEY);
  return {
    provider,
    openAiCompatibleEndpoint: endpoint?.trim() ? endpoint : null,
  };
}

/** 接続方式を保存する。OpenAI 互換 API では検証済みの完全 URL も必須 */
export async function saveLlmConnectionSettings(settings: {
  provider: LlmProviderId;
  openAiCompatibleEndpoint?: string | null;
}): Promise<void> {
  if (!LLM_PROVIDERS.has(settings.provider)) {
    throw new Error('未対応の LLM 接続方式です');
  }
  const endpoint =
    settings.provider === 'openai_compatible'
      ? normalizeOpenAiCompatibleEndpoint(settings.openAiCompatibleEndpoint ?? '')
      : null;
  await setLocal(LLM_PROVIDER_STORAGE_KEY, settings.provider);
  if (endpoint !== null) {
    await setLocal(OPENAI_COMPATIBLE_ENDPOINT_STORAGE_KEY, endpoint);
  } else {
    await removeLocal(OPENAI_COMPATIBLE_ENDPOINT_STORAGE_KEY);
  }
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
 * 検証パネルのレイアウトモードを読み出す（未設定・不正値は既定 = focus）。
 * issue #38: マトリクスカード型フォーカスモードを既定化。S6 / S8 で設定を共有する
 * （verificationService.loadVerificationBundle が「検証データ束の読込時」に読む）
 */
export async function loadVerifyLayoutMode(): Promise<VerifyLayoutMode> {
  const stored = await getLocal<string>(VERIFY_LAYOUT_MODE_STORAGE_KEY);
  return isVerifyLayoutMode(stored) ? stored : 'focus';
}

/** 検証パネルのレイアウトモードを保存する（トグル操作のたびに即時永続化） */
export async function saveVerifyLayoutMode(mode: VerifyLayoutMode): Promise<void> {
  await setLocal(VERIFY_LAYOUT_MODE_STORAGE_KEY, mode);
}

/**
 * 検証パネルの 2 ペインのサイズ調整（issue #193）を読み出す。未設定・不正値は null
 * （＝既定の見た目のまま）。verificationService.loadVerificationBundle が検証データ束の
 * 読込時に読む（layoutMode と同じ経路。S6 / S8 で設定を共有する）
 */
export async function loadVerifyPaneLayout(): Promise<VerifyPaneLayout> {
  const stored = await getLocal<Partial<VerifyPaneLayout>>(VERIFY_PANE_LAYOUT_STORAGE_KEY);
  return {
    formPaneHeight: normalizeFormPaneHeight(stored?.formPaneHeight),
    pdfPaneRatio: normalizePdfPaneRatio(stored?.pdfPaneRatio),
  };
}

/**
 * 検証パネルの 2 ペインのサイズ調整を保存する。スプリッタのドラッグ終了時（pointerup）に
 * 1 回だけ呼ぶ（ドラッグ中の毎フレーム保存は行わない。パネル側のコメント参照）
 */
export async function saveVerifyPaneLayout(layout: VerifyPaneLayout): Promise<void> {
  await setLocal(VERIFY_PANE_LAYOUT_STORAGE_KEY, {
    formPaneHeight: normalizeFormPaneHeight(layout.formPaneHeight),
    pdfPaneRatio: normalizePdfPaneRatio(layout.pdfPaneRatio),
  });
}

/**
 * UI 表示言語を読み出す（未設定・不正値は既定 'ja'。issue #93・docs/ui-states.md §2「表示言語」）。
 * 各エントリの bootstrap が起動時に読み、lib/i18n の setUiLanguage へ反映する
 */
export async function loadUiLanguage(): Promise<UiLanguage> {
  const stored = await getLocal<string>(UI_LANGUAGE_STORAGE_KEY);
  return isUiLanguage(stored) ? stored : 'ja';
}

/** UI 表示言語を保存する（言語セレクタの change のたびに即時永続化） */
export async function saveUiLanguage(language: UiLanguage): Promise<void> {
  await setLocal(UI_LANGUAGE_STORAGE_KEY, language);
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
