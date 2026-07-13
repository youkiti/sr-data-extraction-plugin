// UI 表示言語の i18n 基盤（issue #93）。自前辞書方式（chrome.i18n はブラウザ言語に固定され
// ランタイム切替ができないため不採用）。
// - t(key): 現在言語の辞書から文言を引く。未定義キーは ja へフォールバックし、
//   ja にも無ければキー文字列をそのまま返す（表示が空になるのを防ぐフェイルセーフ）
// - 言語のモジュール内状態は setUiLanguage で切り替え、onUiLanguageChange の購読者
//   （アプリのストア再描画・options.html の本文再構築）が即時反映する
// - 永続化（settings.uiLanguage）は lib/storage/settingsStore が担う（本モジュールは
//   storage に依存しない一方向依存）
import { en } from './en';
import { ja, type MessageKey } from './ja';

export type { MessageKey };

/** UI 表示言語。既定は 'ja'（既存挙動の維持。docs/ui-states.md §2「表示言語」） */
export type UiLanguage = 'ja' | 'en';

export function isUiLanguage(value: unknown): value is UiLanguage {
  return value === 'ja' || value === 'en';
}

let currentLanguage: UiLanguage = 'ja';

const listeners = new Set<(language: UiLanguage) => void>();

/** 現在の表示言語（同期。辞書引き・セレクタ初期値に使う） */
export function getUiLanguage(): UiLanguage {
  return currentLanguage;
}

/** 表示言語を切り替え、変化があれば購読者へ同期通知する（同値なら何もしない） */
export function setUiLanguage(language: UiLanguage): void {
  if (language === currentLanguage) {
    return;
  }
  currentLanguage = language;
  for (const listener of listeners) {
    listener(language);
  }
}

/** 言語切替の購読（戻り値で解除）。アプリはここでストア再描画を発火する */
export function onUiLanguageChange(listener: (language: UiLanguage) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * 現在言語の文言を返す。params は `{name}` 形式のプレースホルダを全置換する
 * （例: t('app.statusProject', { name }) → 'プロジェクト: {name}' の {name} を充填）
 */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  // en は ja と同一キー集合を型強制しているが、DOM 属性経由（localizeDom）の
  // 未知キーに備えて実行時は Partial として扱い、ja → キー文字列の順で倒す
  const dict: Partial<Record<MessageKey, string>> = currentLanguage === 'en' ? en : ja;
  let text = dict[key] ?? ja[key] ?? key;
  if (params !== undefined) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}

/** data-i18n-* 属性 → 反映先属性の対応（textContent は data-i18n が担う） */
const I18N_ATTRIBUTE_TARGETS = [
  { source: 'data-i18n-placeholder', target: 'placeholder' },
  { source: 'data-i18n-title', target: 'title' },
  { source: 'data-i18n-aria-label', target: 'aria-label' },
] as const;

/**
 * 静的 HTML（popup.html / options.html / app.html）の data-i18n 系属性を現在言語で解決する。
 * - data-i18n="key" → textContent
 * - data-i18n-placeholder / data-i18n-title / data-i18n-aria-label → 各属性
 * HTML 上の初期文言は ja（既定言語と一致）のため、ja では同文言の上書きになる
 */
export function localizeDom(root: ParentNode): void {
  for (const node of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    node.textContent = t(node.getAttribute('data-i18n') as MessageKey);
  }
  for (const { source, target } of I18N_ATTRIBUTE_TARGETS) {
    for (const node of root.querySelectorAll<HTMLElement>(`[${source}]`)) {
      node.setAttribute(target, t(node.getAttribute(source) as MessageKey));
    }
  }
}
