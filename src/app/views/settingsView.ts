// #/options: 設定画面をアプリ内（同一タブ・サイドバー付き）で表示する。
// 本文は options.html と共通の settingsSections.ts を使い、配線は bootstrapOptions に委譲する。
// これにより「設定 ⇄ 各作業画面」を 1 タブ内のハッシュ遷移で行き来できる（別タブを開かない）。
import { bootstrapOptions } from '../../options/bootstrap';
import { buildSettingsSections } from '../../options/settingsSections';
import { getUiLanguage, t, type UiLanguage } from '../../lib/i18n';
import { el } from '../ui/dom';
import { headingWithHelp } from '../ui/helpButton';
import type { AppState } from '../store';
import type { ViewContext } from './types';

let cachedView: {
  container: HTMLElement;
  returnHash: AppState['settingsReturnHash'];
  language: UiLanguage;
} | null = null;

/** テスト間で設定画面のキャッシュを初期化する。 */
export function resetSettingsViewCache(): void {
  cachedView = null;
}

export function renderSettingsView(state: AppState, _ctx: ViewContext): HTMLElement {
  const language = getUiLanguage();
  // 表示中（isConnected）の再描画だけ使い回す。別の画面へ移った後に戻ったときは作り直し、
  // その間に他のタブで保存された設定も読み直す
  if (
    cachedView !== null &&
    cachedView.container.isConnected &&
    cachedView.returnHash === state.settingsReturnHash &&
    cachedView.language === language
  ) {
    return cachedView.container;
  }
  const container = el('section', { className: 'view view--settings' });

  // 戻る導線（サイドバーからも各画面へ行けるが、明示的な「戻る」を置く）。
  // #/options へ入る直前のルート（bootstrap が記録）があればそこへ、無ければ #/home へ
  // 戻る（直接 #/options を開いた場合など。ハッシュリンクなので同一タブ内で遷移する）
  const returnHash = state.settingsReturnHash ?? '#/home';
  const header = el('div', { className: 'settings__header' }, [
    headingWithHelp('h2', t('settings.title'), 'options'),
    el('a', {
      className: 'settings__back',
      text: t('settings.back'),
      attributes: { href: returnHash },
    }),
  ]);
  container.append(header);

  const body = buildSettingsSections();
  container.append(body);

  // 配線は非同期（storage 読み出し）。querySelector で解決するため未 attach でよい。
  // 保存通知による再描画でも同じ DOM を使い、処理中の状態と最終結果を保持する。
  cachedView = { container, returnHash: state.settingsReturnHash, language };
  void bootstrapOptions(container);

  return container;
}
