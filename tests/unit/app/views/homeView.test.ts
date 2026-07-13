import { renderHomeView } from '../../../../src/app/views/homeView';
import { createInitialState, type AppState } from '../../../../src/app/store';
import type { HomeViewCallbacks, ViewContext } from '../../../../src/app/views/types';
import { setUiLanguage } from '../../../../src/lib/i18n';

/** homeView は home コールバックしか使わないため、他はダミーで埋める */
function makeCtx(): { ctx: ViewContext; callbacks: jest.Mocked<HomeViewCallbacks> } {
  const callbacks: jest.Mocked<HomeViewCallbacks> = {
    onReload: jest.fn(),
    onGrantFolderAccess: jest.fn(),
    onReloadReviewers: jest.fn(),
    onAddReviewer: jest.fn(),
    onConfirmReviewerChange: jest.fn(),
    onCancelReviewerChange: jest.fn(),
    onRevokeReviewer: jest.fn(),
    onCopyInvite: jest.fn(),
  };
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

describe('renderHomeView（owner）', () => {
  test('通常: プロジェクト名 + 進捗サマリ 5 項目（0 件でも崩れない）', () => {
    const { ctx } = makeCtx();
    const view = renderHomeView(makeState(), ctx);
    expect(view.textContent).toContain('肺炎 SR');
    expect(view.querySelectorAll('dd')).toHaveLength(5);
    expect(view.querySelector('#home-counts-loading')).toBeNull();
    expect(view.querySelector('#home-counts-error')).toBeNull();
  });

  test('プロジェクト未選択は「未選択」を表示し、レビュアー管理カードは出さない', () => {
    const { ctx } = makeCtx();
    const state = makeState();
    state.currentProject = null;
    const view = renderHomeView(state, ctx);
    expect(view.textContent).toContain('プロジェクト: 未選択');
    expect(view.querySelector('#home-reviewers')).toBeNull();
  });

  test('プロジェクト切替リンク: S1 プロジェクト選択ページへ同一タブで遷移するアンカーを常設する', () => {
    const { ctx } = makeCtx();
    const link = renderHomeView(makeState(), ctx).querySelector('#home-switch-project');
    expect(link?.textContent).toBe('別のプロジェクトを開く');
    // 相対 href の通常アンカー = 同一タブ遷移(target/_blank や tabs.create を使わない)
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

describe('renderHomeView（owner のレビュアー管理カード。docs/design-independent-dual-review.md §7.1・§8.1）', () => {
  function stateWithReviewers(patch: Partial<AppState['reviewers']> = {}): AppState {
    const state = makeState();
    state.reviewers = { ...state.reviewers, ...patch };
    return state;
  }

  test('読み込み中は #home-reviewers-loading を出す', () => {
    const { ctx } = makeCtx();
    const view = renderHomeView(stateWithReviewers({ loading: true }), ctx);
    expect(view.querySelector('#home-reviewers-loading')).not.toBeNull();
  });

  test('読み込み失敗は #home-reviewers-error（role=alert）+ 再読み込みが onReloadReviewers へ配線される', () => {
    const { ctx, callbacks } = makeCtx();
    const view = renderHomeView(stateWithReviewers({ loadError: '権限がありません' }), ctx);
    const error = view.querySelector('#home-reviewers-error');
    expect(error?.textContent).toContain('権限がありません');
    expect(error?.getAttribute('role')).toBe('alert');
    (view.querySelector('#home-reviewers-reload') as HTMLButtonElement).click();
    expect(callbacks.onReloadReviewers).toHaveBeenCalledTimes(1);
  });

  test('0 件は #home-reviewers-empty を出す', () => {
    const { ctx } = makeCtx();
    const view = renderHomeView(stateWithReviewers({ assignments: [] }), ctx);
    expect(view.querySelector('#home-reviewers-empty')).not.toBeNull();
    expect(view.querySelector('#home-reviewers-list')).toBeNull();
  });

  test('一覧は email / role / review_mode を表示し、解除ボタンが onRevokeReviewer へ配線される', () => {
    const { ctx, callbacks } = makeCtx();
    const view = renderHomeView(
      stateWithReviewers({
        assignments: [
          {
            email: 'r1@example.com',
            role: 'reviewer',
            reviewMode: 'with_ai',
            assignedBy: 'owner@example.com',
            assignedAt: 't0',
          },
          {
            email: 'r2@example.com',
            role: 'adjudicator',
            reviewMode: null,
            assignedBy: 'owner@example.com',
            assignedAt: 't1',
          },
        ],
      }),
      ctx,
    );
    const rows = view.querySelectorAll('#home-reviewers-list tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('r1@example.com');
    expect(rows[0]?.textContent).toContain('レビュアー');
    expect(rows[0]?.textContent).toContain('① AI の結果をレビュー');
    expect(rows[1]?.textContent).toContain('裁定者');
    expect(rows[1]?.textContent).toContain('–'); // adjudicator に review_mode 表示なし

    // 操作列: 解除（ごみ箱アイコン）+ 依頼文コピー（コピーアイコン）。いずれも SVG アイコン
    const revokeBtn = rows[0]?.querySelector('.reviewers__revoke') as HTMLButtonElement;
    expect(revokeBtn.getAttribute('aria-label')).toBe('r1@example.com を解除');
    expect(revokeBtn.querySelector('svg')).not.toBeNull();
    revokeBtn.click();
    expect(callbacks.onRevokeReviewer).toHaveBeenCalledWith('r1@example.com');

    const copyBtn = rows[0]?.querySelector('.reviewers__invite') as HTMLButtonElement;
    expect(copyBtn.getAttribute('aria-label')).toBe('r1@example.com へのレビュー依頼文をコピー');
    expect(copyBtn.querySelector('svg')).not.toBeNull();
    copyBtn.click();
    expect(callbacks.onCopyInvite).toHaveBeenCalledWith('r1@example.com');
  });

  test('解除済み行は解除ボタンを無効化する', () => {
    const { ctx } = makeCtx();
    const view = renderHomeView(
      stateWithReviewers({
        assignments: [
          { email: 'r1@example.com', role: 'revoked', reviewMode: null, assignedBy: 'o', assignedAt: 't' },
        ],
      }),
      ctx,
    );
    const button = view.querySelector('.reviewers__revoke') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  test('保存失敗は #home-reviewers-save-error（role=alert）を出す', () => {
    const { ctx } = makeCtx();
    const view = renderHomeView(stateWithReviewers({ assignments: [], saveError: '保存に失敗' }), ctx);
    const error = view.querySelector('#home-reviewers-save-error');
    expect(error?.textContent).toBe('保存に失敗');
    expect(error?.getAttribute('role')).toBe('alert');
  });

  test('追加フォームの送信が onAddReviewer へ配線される（role 変更で review_mode select の有効/無効が切替わる）', () => {
    const { ctx, callbacks } = makeCtx();
    const view = renderHomeView(stateWithReviewers({ assignments: [] }), ctx);
    const email = view.querySelector('#reviewer-email') as HTMLInputElement;
    const role = view.querySelector('#reviewer-role') as HTMLSelectElement;
    const mode = view.querySelector('#reviewer-mode') as HTMLSelectElement;
    expect(mode.disabled).toBe(false);

    role.value = 'adjudicator';
    role.dispatchEvent(new Event('change'));
    expect(mode.disabled).toBe(true);

    role.value = 'reviewer';
    role.dispatchEvent(new Event('change'));
    expect(mode.disabled).toBe(false);

    email.value = 'new@example.com';
    mode.value = 'independent';
    (view.querySelector('#reviewer-add-form') as HTMLFormElement).dispatchEvent(
      new Event('submit', { cancelable: true }),
    );
    expect(callbacks.onAddReviewer).toHaveBeenCalledWith({
      email: 'new@example.com',
      role: 'reviewer',
      reviewMode: 'independent',
    });
  });

  test('モード変更確認ダイアログ（role=alertdialog）が続行/キャンセルへ配線される', () => {
    const { ctx, callbacks } = makeCtx();
    const view = renderHomeView(
      stateWithReviewers({
        assignments: [],
        confirmingChange: { email: 'r1@example.com', role: 'reviewer', reviewMode: 'independent' },
      }),
      ctx,
    );
    const dialog = view.querySelector('#reviewer-mode-confirm');
    expect(dialog?.getAttribute('role')).toBe('alertdialog');
    expect(dialog?.textContent).toContain('r1@example.com');

    (view.querySelector('#reviewer-mode-confirm-ok') as HTMLButtonElement).click();
    expect(callbacks.onConfirmReviewerChange).toHaveBeenCalledTimes(1);
    (view.querySelector('#reviewer-mode-confirm-cancel') as HTMLButtonElement).click();
    expect(callbacks.onCancelReviewerChange).toHaveBeenCalledTimes(1);
  });
});

describe('renderHomeView（reviewer 系ロールの縮退版 Home。§3・§7.2）', () => {
  function reviewerState(roleValue: AppState['role']['role'], patch: Partial<AppState['role']> = {}): AppState {
    const state = makeState();
    state.role = { ...state.role, role: roleValue, ...patch };
    // 進捗カウントが読み込まれていても reviewer には出さない
    state.counts = { ...state.counts, documents: 9 };
    return state;
  }

  test.each(['reviewer_with_ai', 'reviewer_independent', 'adjudicator'] as const)(
    '%s: 進捗サマリ・レビュアー管理カードを出さない',
    (roleValue) => {
      const { ctx } = makeCtx();
      const view = renderHomeView(reviewerState(roleValue, { folderAccessGranted: true }), ctx);
      expect(view.querySelector('.home__summary')).toBeNull();
      expect(view.querySelector('#home-reviewers')).toBeNull();
      expect(view.textContent).toContain('肺炎 SR');
    },
  );

  test('フォルダアクセス未付与: 付与ボタンが onGrantFolderAccess へ配線され、検証導線は出さない', () => {
    const { ctx, callbacks } = makeCtx();
    const view = renderHomeView(reviewerState('reviewer_with_ai'), ctx);
    expect(view.querySelector('#home-go-verify')).toBeNull();
    const button = view.querySelector('#home-grant-folder-access') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    button.click();
    expect(callbacks.onGrantFolderAccess).toHaveBeenCalledTimes(1);
  });

  test('フォルダアクセス確認中はボタンを無効化し、確認中メッセージを出す', () => {
    const { ctx } = makeCtx();
    const view = renderHomeView(
      reviewerState('reviewer_with_ai', { folderAccessChecking: true }),
      ctx,
    );
    expect((view.querySelector('#home-grant-folder-access') as HTMLButtonElement).disabled).toBe(true);
    expect(view.querySelector('#home-folder-access-checking')).not.toBeNull();
  });

  test('フォルダアクセス確認失敗は #home-folder-access-error（role=alert）を出す', () => {
    const { ctx } = makeCtx();
    const view = renderHomeView(
      reviewerState('reviewer_with_ai', { folderAccessError: 'アクセス権がありません' }),
      ctx,
    );
    const error = view.querySelector('#home-folder-access-error');
    expect(error?.textContent).toContain('アクセス権がありません');
    expect(error?.getAttribute('role')).toBe('alert');
  });

  test('フォルダアクセス付与済み: 検証への導線を出し、付与ステップは出さない', () => {
    const { ctx } = makeCtx();
    const view = renderHomeView(reviewerState('reviewer_with_ai', { folderAccessGranted: true }), ctx);
    expect(view.querySelector('#home-folder-access')).toBeNull();
    expect(view.querySelector('#home-go-verify')?.getAttribute('href')).toBe('#/verify');
  });

  test('プロジェクト未選択（防御的な分岐）は「未選択」を表示する', () => {
    const { ctx } = makeCtx();
    const state = reviewerState('reviewer_with_ai', { folderAccessGranted: true });
    state.currentProject = null;
    expect(renderHomeView(state, ctx).textContent).toContain('プロジェクト: 未選択');
  });
});

describe('renderHomeView（表示言語 en。issue #93）', () => {
  afterEach(() => {
    setUiLanguage('ja');
  });

  test('owner: 見出し・サマリラベル・エラー文言が en で描画される', () => {
    setUiLanguage('en');
    const { ctx } = makeCtx();
    const view = renderHomeView(makeState(), ctx);
    expect(view.querySelector('h2')?.textContent).toBe('Project overview');
    expect(view.textContent).toContain('Project: 肺炎 SR');
    expect(view.textContent).toContain('Confirmed table design versions');
    expect(view.querySelector('#home-switch-project')?.textContent).toBe('Open another project');

    const errorView = renderHomeView(makeState({ countsError: 'HTTP 403' }), ctx);
    expect(errorView.querySelector('#home-counts-error')?.textContent).toBe(
      'Failed to load progress: HTTP 403',
    );
    expect(errorView.querySelector('#home-counts-reload')?.textContent).toBe('Reload');
  });

  test('reviewer: フォルダアクセス付与ステップも en で描画される', () => {
    setUiLanguage('en');
    const { ctx } = makeCtx();
    const state = makeState();
    state.role = { ...state.role, role: 'reviewer_with_ai' };
    const view = renderHomeView(state, ctx);
    expect(view.querySelector('#home-grant-folder-access')?.textContent).toBe(
      'Grant access to the project folder',
    );
  });
});
