// #/options: 設定画面をアプリ内（同一タブ・サイドバー付き）で表示する。
// 本文は options.html と共通の settingsSections.ts を使い、配線は bootstrapOptions に委譲する。
// これにより「設定 ⇄ 各作業画面」を 1 タブ内のハッシュ遷移で行き来できる（別タブを開かない）。
import { bootstrapOptions } from '../../options/bootstrap';
import { buildSettingsSections } from '../../options/settingsSections';
import { el } from '../ui/dom';
import type { AppState } from '../store';
import type { ViewContext } from './types';

export function renderSettingsView(state: AppState, _ctx: ViewContext): HTMLElement {
  const container = el('section', { className: 'view view--settings' });

  // 戻る導線（サイドバーからも各画面へ行けるが、明示的な「戻る」を置く）。
  // #/options へ入る直前のルート（bootstrap が記録）があればそこへ、無ければ #/home へ
  // 戻る（直接 #/options を開いた場合など。ハッシュリンクなので同一タブ内で遷移する）
  const returnHash = state.settingsReturnHash ?? '#/home';
  const header = el('div', { className: 'settings__header' }, [
    el('h2', { text: '設定' }),
    el('a', {
      className: 'settings__back',
      text: '← 前の画面へ戻る',
      attributes: { href: returnHash },
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
