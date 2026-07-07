import { renderHomeView } from '../../../../src/app/views/homeView';
import { createInitialState, type AppState } from '../../../../src/app/store';
import type { HomeViewCallbacks, ViewContext } from '../../../../src/app/views/types';

/** homeView は home コールバックしか使わないため、他はダミーで埋める */
function makeCtx(): { ctx: ViewContext; callbacks: jest.Mocked<HomeViewCallbacks> } {
  const callbacks = { onReload: jest.fn() };
  return { ctx: { home: callbacks } as unknown as ViewContext, callbacks };
}

function makeState(patch: Partial<AppState['home']> = {}): AppState {
  const state = createInitialState();
  state.currentProject = {
    projectId: 'p1',
    spreadsheetId: 's1',
    driveFolderId: 'f1',
    name: '肺炎 SR',
  };
  state.home = { ...state.home, ...patch };
  return state;
}

describe('renderHomeView', () => {
  test('通常: プロジェクト名 + 進捗サマリ 5 項目（0 件でも崩れない）', () => {
    const { ctx } = makeCtx();
    const view = renderHomeView(makeState(), ctx);
    expect(view.textContent).toContain('肺炎 SR');
    expect(view.querySelectorAll('dd')).toHaveLength(5);
    expect(view.querySelector('#home-counts-loading')).toBeNull();
    expect(view.querySelector('#home-counts-error')).toBeNull();
  });

  test('プロジェクト未選択は「未選択」を表示する', () => {
    const { ctx } = makeCtx();
    const state = makeState();
    state.currentProject = null;
    expect(renderHomeView(state, ctx).textContent).toContain('プロジェクト: 未選択');
  });

  test('プロジェクト切替リンク: S1 プロジェクト選択ページへ同一タブで遷移するアンカーを常設する', () => {
    const { ctx } = makeCtx();
    const link = renderHomeView(makeState(), ctx).querySelector('#home-switch-project');
    expect(link?.textContent).toBe('別のプロジェクトを開く');
    // 相対 href の通常アンカー = 同一タブ遷移（target/_blank や tabs.create を使わない）
    expect(link?.getAttribute('href')).toBe('../popup/popup.html');
    expect(link?.getAttribute('target')).toBeNull();
  });

  test('読み込み中: #home-counts-loading を出し、サマリは出さない', () => {
    const { ctx } = makeCtx();
    const view = renderHomeView(makeState({ countsLoading: true }), ctx);
    expect(view.querySelector('#home-counts-loading')?.textContent).toBe(
      '進捗を読み込んでいます…',
    );
    expect(view.querySelector('.home__summary')).toBeNull();
  });

  test('読み込み失敗: #home-counts-error（role=alert）+ 再読み込みが onReload へ配線される', () => {
    const { ctx, callbacks } = makeCtx();
    const view = renderHomeView(makeState({ countsError: 'HTTP 403' }), ctx);
    const error = view.querySelector('#home-counts-error');
    expect(error?.textContent).toBe('進捗を読み込めませんでした: HTTP 403');
    expect(error?.getAttribute('role')).toBe('alert');
    expect(view.querySelector('.home__summary')).toBeNull();

    (view.querySelector('#home-counts-reload') as HTMLButtonElement).click();
    expect(callbacks.onReload).toHaveBeenCalledTimes(1);
  });
});
