import {
  cancelReviewerChange,
  confirmReviewerChange,
  loadReviewers,
  requestAddReviewer,
  revokeReviewer,
  type ReviewerAdminServiceDeps,
} from '../../../../src/app/services/reviewerAdminService';
import { createInitialState, createStore, type Store } from '../../../../src/app/store';
import {
  appendReviewerAssignment,
  readReviewerAssignments,
} from '../../../../src/features/project/reviewerRepository';

jest.mock('../../../../src/features/project/reviewerRepository', () => ({
  ...jest.requireActual('../../../../src/features/project/reviewerRepository'),
  readReviewerAssignments: jest.fn(),
  appendReviewerAssignment: jest.fn(),
}));

const readReviewerAssignmentsMock = readReviewerAssignments as jest.MockedFunction<
  typeof readReviewerAssignments
>;
const appendReviewerAssignmentMock = appendReviewerAssignment as jest.MockedFunction<
  typeof appendReviewerAssignment
>;

const PROJECT = {
  projectId: 'p1',
  spreadsheetId: 'sheet-1',
  driveFolderId: 'folder-1',
  name: 'テスト SR',
};

const shareProjectWithReviewerMock = jest.fn();

const deps: ReviewerAdminServiceDeps = {
  google: { fetch: jest.fn(), getAccessToken: jest.fn() },
  profile: { getProfileUserInfo: async () => ({ email: 'owner@example.com', id: 'uid' }) },
  now: () => 't-now',
  shareProjectWithReviewer: shareProjectWithReviewerMock,
};

function makeStore(withProject = true): Store {
  const state = createInitialState();
  if (withProject) {
    state.currentProject = PROJECT;
  }
  return createStore(state);
}

beforeEach(() => {
  jest.clearAllMocks();
  appendReviewerAssignmentMock.mockResolvedValue(undefined);
  shareProjectWithReviewerMock.mockResolvedValue(undefined);
});

describe('loadReviewers', () => {
  test('Reviewers タブを読み込み、email ごとに畳み込んで保存する', async () => {
    readReviewerAssignmentsMock.mockResolvedValue([
      { email: 'r1@example.com', role: 'reviewer', reviewMode: 'with_ai', assignedBy: 'o', assignedAt: 't0' },
      { email: 'r1@example.com', role: 'reviewer', reviewMode: 'independent', assignedBy: 'o', assignedAt: 't1' },
    ]);
    const store = makeStore();
    await loadReviewers(store, deps);
    expect(store.getState().reviewers.assignments).toEqual([
      { email: 'r1@example.com', role: 'reviewer', reviewMode: 'independent', assignedBy: 'o', assignedAt: 't1' },
    ]);
    expect(store.getState().reviewers.loading).toBe(false);
  });

  test('プロジェクト未選択なら何もしない', async () => {
    const store = makeStore(false);
    await loadReviewers(store, deps);
    expect(readReviewerAssignmentsMock).not.toHaveBeenCalled();
  });

  test('読込済みなら no-op、force で強制再取得する', async () => {
    readReviewerAssignmentsMock.mockResolvedValue([]);
    const store = makeStore();
    store.setState({ reviewers: { ...store.getState().reviewers, assignments: [] } });
    await loadReviewers(store, deps);
    expect(readReviewerAssignmentsMock).not.toHaveBeenCalled();

    await loadReviewers(store, deps, { force: true });
    expect(readReviewerAssignmentsMock).toHaveBeenCalledTimes(1);
  });

  test('読込中の再入は no-op', async () => {
    const store = makeStore();
    store.setState({ reviewers: { ...store.getState().reviewers, loading: true } });
    await loadReviewers(store, deps);
    expect(readReviewerAssignmentsMock).not.toHaveBeenCalled();
  });

  test('reviewer 系ロールが解決済みなら何もしない（owner 専用カードのため）', async () => {
    const store = makeStore();
    store.setState({ role: { ...store.getState().role, role: 'reviewer_with_ai' } });
    await loadReviewers(store, deps);
    expect(readReviewerAssignmentsMock).not.toHaveBeenCalled();
  });

  test('失敗時は loadError を出す', async () => {
    readReviewerAssignmentsMock.mockRejectedValue(new Error('HTTP 403'));
    const store = makeStore();
    await loadReviewers(store, deps);
    expect(store.getState().reviewers.loadError).toBe('HTTP 403');

    readReviewerAssignmentsMock.mockRejectedValue('boom');
    await loadReviewers(store, deps, { force: true });
    expect(store.getState().reviewers.loadError).toBe('boom');
  });
});

describe('requestAddReviewer', () => {
  test('空 email は保存せずトーストのみ', async () => {
    const store = makeStore();
    await requestAddReviewer(store, deps, { email: '  ', role: 'reviewer', reviewMode: 'with_ai' });
    expect(appendReviewerAssignmentMock).not.toHaveBeenCalled();
  });

  test('新規登録はそのまま追記する（前後空白は trim）', async () => {
    const store = makeStore();
    await requestAddReviewer(store, deps, {
      email: '  r1@example.com  ',
      role: 'reviewer',
      reviewMode: 'with_ai',
    });
    expect(appendReviewerAssignmentMock).toHaveBeenCalledWith(
      'sheet-1',
      {
        email: 'r1@example.com',
        role: 'reviewer',
        reviewMode: 'with_ai',
        assignedBy: 'owner@example.com',
        assignedAt: 't-now',
      },
      deps.google,
    );
    expect(store.getState().reviewers.assignments).toEqual([
      {
        email: 'r1@example.com',
        role: 'reviewer',
        reviewMode: 'with_ai',
        assignedBy: 'owner@example.com',
        assignedAt: 't-now',
      },
    ]);
  });

  test('role=adjudicator は review_mode を null にする', async () => {
    const store = makeStore();
    await requestAddReviewer(store, deps, {
      email: 'r1@example.com',
      role: 'adjudicator',
      reviewMode: 'with_ai',
    });
    expect(appendReviewerAssignmentMock).toHaveBeenCalledWith(
      'sheet-1',
      expect.objectContaining({ role: 'adjudicator', reviewMode: null }),
      deps.google,
    );
  });

  test('role 変更（reviewer → adjudicator）は確認なしでそのまま追記する', async () => {
    const store = makeStore();
    store.setState({
      reviewers: {
        ...store.getState().reviewers,
        assignments: [
          { email: 'r1@example.com', role: 'reviewer', reviewMode: 'with_ai', assignedBy: 'o', assignedAt: 't0' },
        ],
      },
    });
    await requestAddReviewer(store, deps, {
      email: 'r1@example.com',
      role: 'adjudicator',
      reviewMode: 'with_ai',
    });
    expect(appendReviewerAssignmentMock).toHaveBeenCalledTimes(1);
    expect(store.getState().reviewers.confirmingChange).toBeNull();
  });

  test('review_mode だけの変更（既存 reviewer）は確認ダイアログを先に出し、追記しない', async () => {
    const store = makeStore();
    store.setState({
      reviewers: {
        ...store.getState().reviewers,
        assignments: [
          { email: 'r1@example.com', role: 'reviewer', reviewMode: 'with_ai', assignedBy: 'o', assignedAt: 't0' },
        ],
      },
    });
    await requestAddReviewer(store, deps, {
      email: 'r1@example.com',
      role: 'reviewer',
      reviewMode: 'independent',
    });
    expect(appendReviewerAssignmentMock).not.toHaveBeenCalled();
    expect(store.getState().reviewers.confirmingChange).toEqual({
      email: 'r1@example.com',
      role: 'reviewer',
      reviewMode: 'independent',
    });
  });

  test('同一 review_mode の再送信は確認なしで追記する', async () => {
    const store = makeStore();
    store.setState({
      reviewers: {
        ...store.getState().reviewers,
        assignments: [
          { email: 'r1@example.com', role: 'reviewer', reviewMode: 'with_ai', assignedBy: 'o', assignedAt: 't0' },
        ],
      },
    });
    await requestAddReviewer(store, deps, {
      email: 'r1@example.com',
      role: 'reviewer',
      reviewMode: 'with_ai',
    });
    expect(appendReviewerAssignmentMock).toHaveBeenCalledTimes(1);
  });
});

describe('confirmReviewerChange / cancelReviewerChange', () => {
  test('confirmingChange が無ければ confirm は何もしない', async () => {
    const store = makeStore();
    await confirmReviewerChange(store, deps);
    expect(appendReviewerAssignmentMock).not.toHaveBeenCalled();
  });

  test('confirm は保留中の入力を追記して確認ダイアログを閉じる', async () => {
    const store = makeStore();
    store.setState({
      reviewers: {
        ...store.getState().reviewers,
        confirmingChange: { email: 'r1@example.com', role: 'reviewer', reviewMode: 'independent' },
      },
    });
    await confirmReviewerChange(store, deps);
    expect(appendReviewerAssignmentMock).toHaveBeenCalledWith(
      'sheet-1',
      expect.objectContaining({ email: 'r1@example.com', reviewMode: 'independent' }),
      deps.google,
    );
    expect(store.getState().reviewers.confirmingChange).toBeNull();
  });

  test('cancel は確認ダイアログを閉じるだけ', () => {
    const store = makeStore();
    store.setState({
      reviewers: {
        ...store.getState().reviewers,
        confirmingChange: { email: 'r1@example.com', role: 'reviewer', reviewMode: 'independent' },
      },
    });
    cancelReviewerChange(store);
    expect(store.getState().reviewers.confirmingChange).toBeNull();
    expect(appendReviewerAssignmentMock).not.toHaveBeenCalled();
  });
});

describe('revokeReviewer', () => {
  test('role=revoked の行を追記する', async () => {
    const store = makeStore();
    await revokeReviewer(store, deps, 'r1@example.com');
    expect(appendReviewerAssignmentMock).toHaveBeenCalledWith(
      'sheet-1',
      expect.objectContaining({ email: 'r1@example.com', role: 'revoked', reviewMode: null }),
      deps.google,
    );
  });
});

describe('レビュアー追加時の Drive 自動共有', () => {
  const addInput = {
    email: 'r1@example.com',
    role: 'reviewer' as const,
    reviewMode: 'independent' as const,
  };

  test('追加確定でシート（編集可）とフォルダ（閲覧）を対象 email へ共有する', async () => {
    const store = makeStore();
    await requestAddReviewer(store, deps, { ...addInput, email: '  r1@example.com  ' });
    expect(shareProjectWithReviewerMock).toHaveBeenCalledTimes(1);
    expect(shareProjectWithReviewerMock).toHaveBeenCalledWith(
      { spreadsheetId: 'sheet-1', driveFolderId: 'folder-1' },
      'r1@example.com',
      deps.google,
    );
    expect(store.getState().reviewers.assignments).toEqual([
      expect.objectContaining({ email: 'r1@example.com', role: 'reviewer', reviewMode: 'independent' }),
    ]);
    expect(store.getState().reviewers.saveError).toBeNull();
  });

  test('解除（revoked）では自動共有しない', async () => {
    const store = makeStore();
    await revokeReviewer(store, deps, 'r1@example.com');
    expect(shareProjectWithReviewerMock).not.toHaveBeenCalled();
  });

  test('共有が失敗しても登録は残し、saveError は立てない（警告に縮退）', async () => {
    shareProjectWithReviewerMock.mockRejectedValue(new Error('403 cross-domain'));
    const store = makeStore();
    await requestAddReviewer(store, deps, addInput);
    expect(store.getState().reviewers.assignments).toEqual([
      expect.objectContaining({ email: 'r1@example.com' }),
    ]);
    expect(store.getState().reviewers.saveError).toBeNull();
    expect(store.getState().reviewers.saving).toBe(false);
  });

  test('未注入なら既定実装が permissions.create を 2 本（シート=writer / フォルダ=reader）投げる', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'perm' }) } as Response);
    const depsDefault: ReviewerAdminServiceDeps = {
      google: { fetch, getAccessToken: jest.fn().mockResolvedValue('t') },
      profile: deps.profile,
      now: deps.now,
    };
    const store = makeStore();
    await requestAddReviewer(store, depsDefault, addInput);
    expect(fetch).toHaveBeenCalledTimes(2);
    const [sheetUrl, sheetInit] = fetch.mock.calls[0];
    expect(sheetUrl).toContain('/drive/v3/files/sheet-1/permissions');
    expect(sheetUrl).toContain('sendNotificationEmail=true');
    expect(JSON.parse((sheetInit as RequestInit).body as string)).toEqual({
      role: 'writer',
      type: 'user',
      emailAddress: 'r1@example.com',
    });
    const [folderUrl, folderInit] = fetch.mock.calls[1];
    expect(folderUrl).toContain('/drive/v3/files/folder-1/permissions');
    expect(folderUrl).toContain('sendNotificationEmail=false');
    expect(JSON.parse((folderInit as RequestInit).body as string)).toEqual({
      role: 'reader',
      type: 'user',
      emailAddress: 'r1@example.com',
    });
  });
});

describe('submitReviewerAssignment（内部）の異常系', () => {
  test('プロジェクト未選択なら何もしない', async () => {
    const store = makeStore(false);
    await revokeReviewer(store, deps, 'r1@example.com');
    expect(appendReviewerAssignmentMock).not.toHaveBeenCalled();
  });

  test('保存失敗は saveError を出す', async () => {
    appendReviewerAssignmentMock.mockRejectedValue(new Error('HTTP 500'));
    const store = makeStore();
    await revokeReviewer(store, deps, 'r1@example.com');
    expect(store.getState().reviewers.saveError).toBe('HTTP 500');
    expect(store.getState().reviewers.saving).toBe(false);
  });

  test('Error 以外の throw も文字列化する', async () => {
    appendReviewerAssignmentMock.mockRejectedValue('boom');
    const store = makeStore();
    await revokeReviewer(store, deps, 'r1@example.com');
    expect(store.getState().reviewers.saveError).toBe('boom');
  });

  test('getCurrentUserEmail が空/null を返す場合は assignedBy を空文字にする', async () => {
    const store = makeStore();
    const depsWithoutEmail: ReviewerAdminServiceDeps = {
      google: deps.google,
      profile: { getProfileUserInfo: async () => ({ email: '', id: 'uid' }) },
      now: deps.now,
    };
    await revokeReviewer(store, depsWithoutEmail, 'r1@example.com');
    expect(appendReviewerAssignmentMock).toHaveBeenCalledWith(
      'sheet-1',
      expect.objectContaining({ assignedBy: '' }),
      deps.google,
    );
  });

  test('now / getCurrentUserEmail の既定実装（未注入）も動く', async () => {
    const store = makeStore();
    const depsWithoutNow: ReviewerAdminServiceDeps = { google: deps.google, profile: deps.profile };
    await revokeReviewer(store, depsWithoutNow, 'r1@example.com');
    expect(appendReviewerAssignmentMock).toHaveBeenCalled();
    const call = appendReviewerAssignmentMock.mock.calls[0];
    if (call === undefined) {
      throw new Error('appendReviewerAssignment が呼ばれていません');
    }
    const [, input] = call;
    expect(input.assignedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
