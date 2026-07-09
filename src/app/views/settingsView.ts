// #/options: 設定画面をアプリ内（同一タブ・サイドバー付き）で表示する。
// 本文は options.html と共通の settingsSections.ts を使い、配線は bootstrapOptions に委譲する。
// これにより「設定 ⇄ 各作業画面」を 1 タブ内のハッシュ遷移で行き来できる（別タブを開かない）。
import { bootstrapOptions } from '../../options/bootstrap';
import { buildSettingsSections } from '../../options/settingsSections';
import { el } from '../ui/dom';
import type { AppState } from '../store';
import type { ViewContext } from './types';

export function renderSettingsView(_state: AppState, _ctx: ViewContext): HTMLElement {
  const container = el('section', { className: 'view view--settings' });

  const header = el('div', { className: 'settings__header' }, [
    el('h2', { text: '設定' }),
    // 戻る導線（サイドバーからも各画面へ行けるが、明示的な「戻る」を置く）。
    // ハッシュリンクなので同一タブ内で #/home へ遷移する
    el('a', {
      className: 'settings__back',
      text: '← ホームへ戻る',
      attributes: { href: '#/home' },
    }),
  ]);
  container.append(header);

  const body = buildSettingsSections();
  container.append(body);

  // 配線は非同期（storage 読み出し）。querySelector で解決するため未 attach でよい。
  // ストア再描画のたびに本 view は作り直され、そのつど新しいコンテナへ再配線される
  void bootstrapOptions(container);

  return container;
}
