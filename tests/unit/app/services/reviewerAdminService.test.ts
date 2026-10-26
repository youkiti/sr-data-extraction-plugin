import { setUiLanguage, t } from '../../../../src/lib/i18n';
import type { DocumentRecord } from '../../../../src/domain/document';
import { readDocuments } from '../../../../src/features/documents/documentRepository';
jest.mock('../../../../src/features/documents/documentRepository', () => ({ readDocuments: jest.fn() }));
import {
  buildReviewInvite,
  cancelReviewerChange,
  dismissReviewerBlocked,
  confirmReviewerChange,
  copyReviewInvite,
  loadReviewers,
  requestAddReviewer,
  revokeReviewer,
  reshareReviewer,
  type ReviewerAdminServiceDeps,
} from '../../../../src/app/services/reviewerAdminService';
import { listFilePermissions } from '../../../../src/lib/google/drive';
jest.mock('../../../../src/lib/google/drive', () => ({
  ...jest.requireActual('../../../../src/lib/google/drive'),
  listFilePermissions: jest.fn(),
}));
import { createInitialState, createStore, type Store } from '../../../../src/app/store';
import type { ReviewerAssignment } from '../../../../src/domain/reviewer';
import {
  appendReviewerAssignment,
  readReviewerAssignments,
} from '../../../../src/features/project/reviewerRepository';

import { readQuoteSetRows } from '../../../../src/features/verification/quoteSetRepository';
jest.mock('../../../../src/features/verification/quoteSetRepository');
import { readAllDecisions } from '../../../../src/features/verification/decisionRepository';
import { readAllStudyDataRows, readAllResultsDataRows } from '../../../../src/features/extraction/annotationRepository';
import { readAllArmStructures } from '../../../../src/features/verification/armStructureRepository';

jest.mock('../../../../src/features/verification/decisionRepository');
jest.mock('../../../../src/features/extraction/annotationRepository');
jest.mock('../../../../src/features/verification/armStructureRepository');

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
  readAnnotatorTypesForEmail: async () => new Set(),
};

function makeStore(withProject = true): Store {
  const state = createInitialState();
  state.documents.records = [];
  if (withProject) {
    state.currentProject = PROJECT;
  }
  return createStore(state);
}

beforeEach(() => {
  jest.mocked(readQuoteSetRows).mockResolvedValue([]);
  jest.clearAllMocks();
  jest.mocked(readDocuments).mockResolvedValue([]);
  appendReviewerAssignmentMock.mockResolvedValue(undefined);
  shareProjectWithReviewerMock.mockResolvedValue(undefined);
  jest.mocked(listFilePermissions).mockResolvedValue({ emails: new Set(), hasBroadAccess: false });
});

function shareDoc(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    documentId: 'd', studyId: 's', documentRole: 'article', driveFileId: 'pdf',
    sourceFileId: null, filename: '研究.pdf', pmid: null, doi: null, textRef: 'text',
    textStatus: 'ok', pageCount: null, charCount: null, importedAt: '2026-10-01',
    importedBy: 'owner', note: null, excluded: false, exclusionReason: null,
    exclusionNote: null, excludedAt: null, ...overrides,
  };
}

describe('文書ファイルへの共有フォールバック', () => {
  test.each(['add', 'reshare'] as const)('%s は順番に重複なく共有し、全件を試して結果を通知する', async (action) => {
    for (const failFile of [false, true]) {
      const store = makeStore();
      const documents = [shareDoc(), shareDoc({ driveFileId: 'pdf2', textRef: '' }),
        shareDoc({ driveFileId: 'pdf', textRef: null }),
        shareDoc({ driveFileId: 'excluded', excluded: true })];
      store.setState({ documents: { ...store.getState().documents, records: documents } });
      const calls: string[] = [];
      let active = false;
      const fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        expect(active).toBe(false);
        active = true;
        await Promise.resolve();
        active = false;
        const id = url.split('/files/')[1]!.split('/')[0]!;
        calls.push(id);
        expect(init?.method).toBe('POST');
        if (id !== 'sheet-1') expect(url).toContain('sendNotificationEmail=false');
        const fail = id === 'folder-1' || (failFile && id === 'text');
        return { ok: !fail, status: fail ? 403 : 200, text: async () => '' } as Response;
      });
      const localDeps = { ...deps, shareProjectWithReviewer: undefined,
        google: { fetch, getAccessToken: async () => 't' } };
      if (action === 'add') await requestAddReviewer(store, localDeps,
        { email: 'r@example.com', role: 'reviewer', reviewMode: 'with_ai' });
      else await reshareReviewer(store, localDeps, 'r@example.com');
      expect(calls).toEqual(['sheet-1', 'folder-1', 'pdf', 'text', 'pdf2']);
      if (failFile) {
        expect(store.getState().reviewers.shareErrors[0]?.reason).toBe('3 件中 1 件のファイルを共有できませんでした');
      } else {
        expect(store.getState().reviewers.shareErrors).toEqual([]);
        expect(document.body.textContent).toContain(action === 'add'
          ? 'r@example.com を登録し、シートと文書ファイル 3 件を共有して、参加手順をメールで送りました'
          : 'r@example.com にシートと文書ファイル 3 件を共有し直しました');
      }
    }
  });

  test.each(['add', 'reshare'] as const)('%s はシート失敗で以降を呼ばない', async (action) => {
    const store = makeStore();
    const fetch = jest.fn().mockResolvedValue({ ok: false, status: 403, text: async () => '' });
    const read = jest.fn();
    const localDeps = { ...deps, shareProjectWithReviewer: undefined, readDocuments: read,
      google: { fetch, getAccessToken: async () => 't' } };
    if (action === 'add') await requestAddReviewer(store, localDeps,
      { email: 'r@example.com', role: 'reviewer', reviewMode: 'with_ai' });
    else await reshareReviewer(store, localDeps, 'r@example.com');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(read).not.toHaveBeenCalled();
  });

  test.each([true, false])('ストア未読込なら Documents を取得し、0 件なら個別共有は不要（注入=%s）', async (inject) => {
    const store = makeStore();
    store.setState({ documents: { ...store.getState().documents, records: null } });
    const read = jest.fn().mockResolvedValue([]);
    const fetch = jest.fn().mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, status: 400, text: async () => '' });
    await reshareReviewer(store, { ...deps, shareProjectWithReviewer: undefined,
      readDocuments: inject ? read : undefined, google: { fetch, getAccessToken: async () => 't' } }, 'r@example.com');
    expect(inject ? read : readDocuments).toHaveBeenCalledWith('sheet-1', expect.anything());
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).toContain('文書ファイル 0 件');
  });

  test.each([true, false])('フォルダ未共有時は最新の有効 PDF で確認する（共有=%s）', async (shared) => {
    const store = makeStore();
    store.setState({ documents: { ...store.getState().documents, records: [
      shareDoc(), shareDoc({ driveFileId: 'latest', importedAt: '2026-10-20' }),
      shareDoc({ driveFileId: 'excluded', importedAt: '2026-10-25', excluded: true }),
    ] } });
    readReviewerAssignmentsMock.mockResolvedValue([
      { email: 'R@example.com', role: 'reviewer', reviewMode: 'with_ai', assignedBy: 'o', assignedAt: 't' },
    ]);
    jest.mocked(listFilePermissions).mockResolvedValueOnce({ emails: new Set(), hasBroadAccess: false })
      .mockResolvedValueOnce({ emails: new Set(shared ? ['r@example.com'] : []), hasBroadAccess: false });
    await loadReviewers(store, deps);
    expect(jest.mocked(listFilePermissions).mock.calls.map(([id]) => id)).toEqual(['folder-1', 'latest']);
    const sharing = store.getState().reviewers.folderSharing;
    expect(sharing.status === 'checked' && sharing.emails.has('r@example.com')).toBe(shared);
  });

  test('フォルダに共有済みなら PDF を読まず、PDF 権限の取得失敗は unknown とする', async () => {
    const store = makeStore();
    store.setState({ documents: { ...store.getState().documents, records: [shareDoc()] } });
    readReviewerAssignmentsMock.mockResolvedValue([
      { email: 'r@example.com', role: 'reviewer', reviewMode: 'with_ai', assignedBy: 'o', assignedAt: 't' },
    ]);
    jest.mocked(listFilePermissions).mockResolvedValueOnce({ emails: new Set(['r@example.com']), hasBroadAccess: false });
    await loadReviewers(store, deps);
    expect(listFilePermissions).toHaveBeenCalledTimes(1);
    jest.mocked(listFilePermissions).mockResolvedValueOnce({ emails: new Set(), hasBroadAccess: false })
      .mockRejectedValueOnce(new Error('PDF denied'));
    await loadReviewers(store, deps, { force: true });
    expect(store.getState().reviewers.folderSharing).toEqual({ status: 'unknown' });
    expect(readReviewerAssignmentsMock).toHaveBeenCalledTimes(2);
    expect(jest.mocked(listFilePermissions).mock.calls.map(([id]) => id))
      .toEqual(['folder-1', 'folder-1', 'pdf']);
  });
});

describe('フォルダ共有状況と再共有', () => {
  test('一覧の後にフォルダの権限を読み込む', async () => {
    readReviewerAssignmentsMock.mockResolvedValue([]);
    const sharing = { emails: new Set(['r@example.com']), hasBroadAccess: true };
    jest.mocked(listFilePermissions).mockResolvedValue(sharing);
    const store = makeStore();
    expect(store.getState().reviewers.folderSharing).toEqual({ status: 'unchecked' });
    await loadReviewers(store, deps);
    expect(listFilePermissions).toHaveBeenCalledWith('folder-1', deps.google);
    expect(store.getState().reviewers.folderSharing).toEqual({ status: 'checked', ...sharing });
  });

  test('権限取得失敗でも一覧を残し loadError は立てない', async () => {
    const rows: ReviewerAssignment[] = [{ email: 'r@example.com', role: 'reviewer', reviewMode: 'with_ai', assignedBy: 'o', assignedAt: 't' }];
    readReviewerAssignmentsMock.mockResolvedValue(rows);
    jest.mocked(listFilePermissions).mockRejectedValue(new Error('403'));
    const store = makeStore();
    await loadReviewers(store, deps);
    expect(store.getState().reviewers.assignments).toEqual(rows);
    expect(store.getState().reviewers.loadError).toBeNull();
    expect(store.getState().reviewers.folderSharing).toEqual({ status: 'unknown' });
  });

  test('再共有成功で対象 email の警告だけ消し、権限を再取得する', async () => {
    const store = makeStore();
    store.setState({ reviewers: { ...store.getState().reviewers, shareErrors: [
      { email: 'R@example.com', reason: '403' },
      { email: 'other@example.com', reason: '404' },
    ] } });
    let complete!: () => void;
    shareProjectWithReviewerMock.mockImplementationOnce(() => new Promise<void>((resolve) => { complete = resolve; }));
    const pending = reshareReviewer(store, deps, 'r@example.com');
    expect(store.getState().reviewers.resharing).toBe(true);
    await reshareReviewer(store, deps, 'other@example.com');
    expect(shareProjectWithReviewerMock).toHaveBeenCalledTimes(1);
    complete();
    await pending;
    expect(shareProjectWithReviewerMock).toHaveBeenCalledWith(PROJECT, 'r@example.com', deps.google, expect.any(String));
    expect(store.getState().reviewers.shareErrors).toEqual([{ email: 'other@example.com', reason: '404' }]);
    expect(store.getState().reviewers.folderSharing.status).toBe('checked');
    expect(store.getState().reviewers.resharing).toBe(false);
    expect(document.body.textContent).toContain('r@example.com にシートとフォルダを共有し直しました');
    expect(appendReviewerAssignmentMock).not.toHaveBeenCalled();
  });

  test('再共有失敗は理由つきの警告を残す', async () => {
    const store = makeStore();
    shareProjectWithReviewerMock.mockRejectedValueOnce(new Error('folder denied'));
    await reshareReviewer(store, deps, 'r@example.com');
    expect(store.getState().reviewers.shareErrors).toEqual([{ email: 'r@example.com', reason: 'folder denied' }]);
    expect(store.getState().reviewers.resharing).toBe(false);
    expect(listFilePermissions).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('r@example.com への共有に失敗しました: folder denied');
  });

  test('未選択・保存中は再共有しない', async () => {
    await reshareReviewer(makeStore(false), deps, 'r@example.com');
    const store = makeStore();
    store.setState({ reviewers: { ...store.getState().reviewers, saving: true } });
    await reshareReviewer(store, deps, 'r@example.com');
    expect(shareProjectWithReviewerMock).not.toHaveBeenCalled();
  });

  test('未注入の再共有もシート writer とフォルダ reader を送る', async () => {
    const fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as Response);
    await reshareReviewer(makeStore(), {
      google: { fetch, getAccessToken: async () => 't' }, profile: deps.profile,
    }, 'r@example.com');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][0]).toContain('/sheet-1/permissions?sendNotificationEmail=true');
    expect(JSON.parse((fetch.mock.calls[0][1] as RequestInit).body as string)).toMatchObject({ role: 'writer', emailAddress: 'r@example.com' });
    expect(fetch.mock.calls[1][0]).toContain('/folder-1/permissions?sendNotificationEmail=false');
    expect(JSON.parse((fetch.mock.calls[1][1] as RequestInit).body as string)).toMatchObject({ role: 'reader' });
  });

  test('追加失敗の警告を残し、追加の再試行成功で消す', async () => {
    const store = makeStore();
    const input = { email: 'r@example.com', role: 'reviewer' as const, reviewMode: 'with_ai' as const };
    shareProjectWithReviewerMock.mockRejectedValueOnce('folder error');
    await requestAddReviewer(store, deps, input);
    expect(store.getState().reviewers.shareErrors).toEqual([{ email: input.email, reason: 'folder error' }]);
    expect(store.getState().reviewers.assignments).toHaveLength(1);
    await requestAddReviewer(store, deps, input);
    expect(store.getState().reviewers.shareErrors).toEqual([]);
    expect(listFilePermissions).toHaveBeenCalledTimes(1);
  });
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

  test('読込済みなら何も読まず、force で一覧と共有状況を再取得する', async () => {
    readReviewerAssignmentsMock.mockResolvedValue([]);
    const store = makeStore();
    store.setState({ reviewers: { ...store.getState().reviewers, assignments: [] } });
    const loadedState = store.getState();
    await loadReviewers(store, deps);
    expect(readReviewerAssignmentsMock).not.toHaveBeenCalled();
    expect(listFilePermissions).not.toHaveBeenCalled();
    expect(readDocuments).not.toHaveBeenCalled();
    expect(store.getState()).toBe(loadedState);

    await loadReviewers(store, deps, { force: true });
    expect(readReviewerAssignmentsMock).toHaveBeenCalledTimes(1);
    expect(listFilePermissions).toHaveBeenCalledTimes(1);
    expect(listFilePermissions).toHaveBeenCalledWith('folder-1', deps.google);
    expect(store.getState().reviewers.folderSharing).toEqual({
      status: 'checked', emails: new Set(), hasBroadAccess: false,
    });
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
      expect.any(String),
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
      readAnnotatorTypesForEmail: async () => new Set(),
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

describe('buildReviewInvite', () => {
  test('with_ai は URL・参加手順・AI 結果レビューの案内を含む', () => {
    const text = buildReviewInvite({
      projectName: 'テスト SR',
      spreadsheetId: 'sheet-1',
      reviewerEmail: 'r1@example.com',
      role: null,
      reviewMode: 'with_ai',
    });
    expect(text).toContain('r1@example.com さん');
    expect(text).toContain('テスト SR');
    expect(text).toContain('https://docs.google.com/spreadsheets/d/sheet-1/edit');
    expect(text).toContain('AI の結果をレビュー');
  });

  test('independent は AI 抜きの独立入力を案内する', () => {
    const text = buildReviewInvite({
      projectName: 'テスト SR',
      spreadsheetId: 'sheet-1',
      reviewerEmail: 'r1@example.com',
      role: null,
      reviewMode: 'independent',
    });
    expect(text).toContain('AI 抜きの独立入力');
  });

  test('reviewMode が null なら AI 結果レビュー扱いで案内する', () => {
    const text = buildReviewInvite({
      projectName: 'テスト SR',
      spreadsheetId: 'sheet-1',
      reviewerEmail: 'r1@example.com',
      role: null,
      reviewMode: null,
    });
    expect(text).toContain('AI の結果をレビュー');
  });
});

describe('copyReviewInvite', () => {
  function storeWith(assignments: ReviewerAssignment[]): Store {
    const state = createInitialState();
    state.currentProject = PROJECT;
    state.reviewers.assignments = assignments;
    return createStore(state);
  }

  test('依頼文を組み立ててクリップボードへ書き込む（登録モードを反映）', async () => {
    const writeClipboard = jest.fn().mockResolvedValue(undefined);
    const store = storeWith([
      { email: 'r1@example.com', role: 'reviewer', reviewMode: 'independent', assignedBy: 'o', assignedAt: 't' },
    ]);
    await copyReviewInvite(store, { ...deps, writeClipboard }, 'r1@example.com');
    expect(writeClipboard).toHaveBeenCalledTimes(1);
    const text = writeClipboard.mock.calls[0][0] as string;
    expect(text).toContain('https://docs.google.com/spreadsheets/d/sheet-1/edit');
    expect(text).toContain('AI 抜きの独立入力');
  });

  test('プロジェクト未選択なら何もしない', async () => {
    const writeClipboard = jest.fn().mockResolvedValue(undefined);
    const store = makeStore(false);
    await copyReviewInvite(store, { ...deps, writeClipboard }, 'r1@example.com');
    expect(writeClipboard).not.toHaveBeenCalled();
  });

  test('assignments 未初期化（null）でもコピーできる（モードは null 扱い）', async () => {
    const writeClipboard = jest.fn().mockResolvedValue(undefined);
    const store = makeStore(); // currentProject あり・reviewers.assignments は初期値 null
    await copyReviewInvite(store, { ...deps, writeClipboard }, 'r1@example.com');
    expect(writeClipboard).toHaveBeenCalledTimes(1);
    expect(writeClipboard.mock.calls[0][0] as string).toContain('AI の結果をレビュー');
  });

  test('コピー失敗（reject）でも例外を投げない', async () => {
    const writeClipboard = jest.fn().mockRejectedValue(new Error('denied'));
    const store = storeWith([]);
    await expect(
      copyReviewInvite(store, { ...deps, writeClipboard }, 'unknown@example.com'),
    ).resolves.toBeUndefined();
  });

  test('writeClipboard 未注入なら navigator.clipboard を使う', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    const store = storeWith([]);
    const depsNoClipboard: ReviewerAdminServiceDeps = { google: deps.google, profile: deps.profile };
    await copyReviewInvite(store, depsNoClipboard, 'r1@example.com');
    expect(writeText).toHaveBeenCalledTimes(1);
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
      readAnnotatorTypesForEmail: async () => new Set(),
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


describe('作業済み email のモード変更制限', () => {
  const email = 'r1@example.com';
  const input = { email, role: 'reviewer' as const, reviewMode: 'independent' as const };

  test.each([
    ['with_ai', 'reviewer', 'independent', ['human_with_ai']],
    ['independent', 'reviewer', 'with_ai', ['human_independent']],
    ['revoked', 'reviewer', 'independent', ['human_with_ai']],
    ['independent', 'adjudicator', 'with_ai', ['human_independent']],
    ['with_ai', 'reviewer', 'with_ai', ['human_with_ai', 'human_independent']],
    ['independent', 'reviewer', 'independent', ['human_with_ai', 'human_independent']],
    ['with_ai', 'adjudicator', 'with_ai', ['human_with_ai', 'human_independent']],
  ] as const)('%s → %s/%s は異種の実データがあれば拒否する', async (oldMode, role, reviewMode, types) => {
    const store = makeStore();
    store.setState({ reviewers: { ...store.getState().reviewers, assignments: [{
      email, role: oldMode === 'revoked' ? 'revoked' : 'reviewer',
      reviewMode: oldMode === 'revoked' ? null : oldMode, assignedBy: 'owner', assignedAt: 't0',
    }] } });
    const read = jest.fn(async () => new Set(types));
    await requestAddReviewer(store, { ...deps, readAnnotatorTypesForEmail: read }, { email, role, reviewMode });
    expect(read).toHaveBeenCalledWith(PROJECT.spreadsheetId, email, deps.google);
    expect(store.getState().reviewers.blockedChange).toEqual({ email });
    expect(store.getState().reviewers.confirmingChange).toBeNull();
    expect(store.getState().reviewers.saving).toBe(false);
    expect(appendReviewerAssignmentMock).not.toHaveBeenCalled();
    expect(shareProjectWithReviewerMock).not.toHaveBeenCalled();
  });

  test('同じ作業型の再登録は許可する', async () => {
    const store = makeStore();
    await requestAddReviewer(store, { ...deps,
      readAnnotatorTypesForEmail: async () => new Set(['human_independent']),
    }, input);
    expect(appendReviewerAssignmentMock).toHaveBeenCalledTimes(1);
    expect(store.getState().reviewers.blockedChange).toBeNull();
  });

  test('読込中は saving、失敗時は理由を表示して追記・共有しない', async () => {
    const store = makeStore();
    const read = jest.fn(async () => {
      expect(store.getState().reviewers.saving).toBe(true);
      throw new Error('確認用の読込失敗');
    });
    await requestAddReviewer(store, { ...deps, readAnnotatorTypesForEmail: read }, input);
    expect(store.getState().reviewers.saveError).toBe(
      'レビューモードの変更可否を確認できなかったため、登録しませんでした: 確認用の読込失敗',
    );
    expect(store.getState().reviewers.saving).toBe(false);
    expect(appendReviewerAssignmentMock).not.toHaveBeenCalled();
    expect(shareProjectWithReviewerMock).not.toHaveBeenCalled();
  });

  test('閉じる操作と次の送信でブロック通知を消し、毎回読み直す', async () => {
    const store = makeStore();
    const read = jest.fn<ReturnType<NonNullable<ReviewerAdminServiceDeps['readAnnotatorTypesForEmail']>>, []>()
      .mockResolvedValueOnce(new Set(['human_with_ai']))
      .mockResolvedValueOnce(new Set(['human_with_ai']))
      .mockResolvedValueOnce(new Set());
    const testDeps = { ...deps, readAnnotatorTypesForEmail: read };
    await requestAddReviewer(store, testDeps, input);
    dismissReviewerBlocked(store);
    expect(store.getState().reviewers.blockedChange).toBeNull();
    await requestAddReviewer(store, testDeps, input);
    const pending = requestAddReviewer(store, testDeps, input);
    expect(store.getState().reviewers.blockedChange).toBeNull();
    await pending;
    expect(read).toHaveBeenCalledTimes(3);
    expect(appendReviewerAssignmentMock).toHaveBeenCalledTimes(1);
  });

  test('空 email とプロジェクト未選択では読まず、解除もチェックしない', async () => {
    const read = jest.fn().mockRejectedValue(new Error('呼ばれてはいけない'));
    const testDeps = { ...deps, readAnnotatorTypesForEmail: read };
    await requestAddReviewer(makeStore(), testDeps, { ...input, email: ' ' });
    await requestAddReviewer(makeStore(false), testDeps, input);
    await revokeReviewer(makeStore(), testDeps, email);
    expect(read).not.toHaveBeenCalled();
    expect(appendReviewerAssignmentMock).toHaveBeenCalledTimes(1);
  });
});


test('既定 reader は Decisions の accept だけでも独立モードへの変更を拒否する', async () => {
  jest.mocked(readAllDecisions).mockResolvedValue([{
    decidedAt: 't', decidedBy: 'r1@example.com', studyId: 'study', fieldId: 'field',
    entityKey: 'study', annotator: 'r1@example.com', annotatorType: 'human_with_ai',
    schemaVersion: 1, action: 'accept', value: 'AI が出した値', note: '',
  }]);
  jest.mocked(readAllStudyDataRows).mockResolvedValue([]);
  jest.mocked(readAllResultsDataRows).mockResolvedValue([]);
  jest.mocked(readAllArmStructures).mockResolvedValue([]);
  const store = makeStore();
  await requestAddReviewer(store, { ...deps, readAnnotatorTypesForEmail: undefined }, {
    email: 'r1@example.com', role: 'reviewer', reviewMode: 'independent',
  });
  expect(store.getState().reviewers.blockedChange).toEqual({ email: 'r1@example.com' });
  expect(appendReviewerAssignmentMock).not.toHaveBeenCalled();
  expect(shareProjectWithReviewerMock).not.toHaveBeenCalled();
});


describe('モード変更の続行時の再確認', () => {
  const email = 'r1@example.com';

  function storeWithReviewer(): Store {
    const store = makeStore();
    store.setState({ reviewers: { ...store.getState().reviewers, assignments: [{
      email, role: 'reviewer', reviewMode: 'with_ai', assignedBy: 'owner', assignedAt: 't0',
    }] } });
    return store;
  }

  test('確認待ちの間に作業が始まったら続行しても登録・共有を拒否する', async () => {
    const store = storeWithReviewer();
    const read = jest.fn<ReturnType<NonNullable<ReviewerAdminServiceDeps['readAnnotatorTypesForEmail']>>, []>()
      .mockResolvedValueOnce(new Set())
      .mockImplementationOnce(async () => {
        expect(store.getState().reviewers.saving).toBe(true);
        return new Set(['human_with_ai']);
      });
    const testDeps = { ...deps, readAnnotatorTypesForEmail: read };
    await requestAddReviewer(store, testDeps, { email, role: 'reviewer', reviewMode: 'independent' });
    expect(store.getState().reviewers.confirmingChange).not.toBeNull();
    await confirmReviewerChange(store, testDeps);
    expect(read).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenLastCalledWith(PROJECT.spreadsheetId, email, deps.google);
    expect(store.getState().reviewers.blockedChange).toEqual({ email });
    expect(store.getState().reviewers.confirmingChange).toBeNull();
    expect(store.getState().reviewers.saving).toBe(false);
    expect(appendReviewerAssignmentMock).not.toHaveBeenCalled();
    expect(shareProjectWithReviewerMock).not.toHaveBeenCalled();
  });

  test('続行時の読込失敗も saveError とトーストを出して登録・共有しない', async () => {
    const store = storeWithReviewer();
    const read = jest.fn<ReturnType<NonNullable<ReviewerAdminServiceDeps['readAnnotatorTypesForEmail']>>, []>()
      .mockResolvedValueOnce(new Set())
      .mockRejectedValueOnce(new Error('再確認の読込失敗'));
    const testDeps = { ...deps, readAnnotatorTypesForEmail: read };
    await requestAddReviewer(store, testDeps, { email, role: 'reviewer', reviewMode: 'independent' });
    await confirmReviewerChange(store, testDeps);
    const message = 'レビューモードの変更可否を確認できなかったため、登録しませんでした: 再確認の読込失敗';
    expect(read).toHaveBeenCalledTimes(2);
    expect(store.getState().reviewers.saveError).toBe(message);
    expect(document.querySelector('#toast-container .toast:last-child')?.textContent).toBe(message);
    expect(store.getState().reviewers.saving).toBe(false);
    expect(store.getState().reviewers.confirmingChange).toBeNull();
    expect(appendReviewerAssignmentMock).not.toHaveBeenCalled();
    expect(shareProjectWithReviewerMock).not.toHaveBeenCalled();
  });
});


describe('共有通知メールとコピーの参加手順', () => {
  afterEach(() => setUiLanguage('ja'));

  describe.each(['ja', 'en'] as const)('%s', (language) => {
    test.each([
      ['reviewer', 'with_ai'],
      ['reviewer', 'independent'],
      ['adjudicator', 'with_ai'],
    ] as const)('%s / %s の追加と再共有は同じ役割別の本文を送る', async (role, reviewMode) => {
      setUiLanguage(language);
      const email = 'r1@example.com';
      const fetch = jest.fn().mockResolvedValue({
        ok: true, status: 200, json: async () => ({ id: 'perm' }),
      } as Response);
      const writeClipboard = jest.fn().mockResolvedValue(undefined);
      const testDeps: ReviewerAdminServiceDeps = {
        ...deps,
        google: { fetch, getAccessToken: jest.fn().mockResolvedValue('t') },
        shareProjectWithReviewer: undefined,
        writeClipboard,
      };
      const store = makeStore();
      await requestAddReviewer(store, testDeps, { email, role, reviewMode });
      const message = new URL(fetch.mock.calls[0][0] as string).searchParams.get('emailMessage') as string;
      expect(fetch.mock.calls[0][0]).toContain(`sendNotificationEmail=true&emailMessage=${encodeURIComponent(message)}`);
      expect(fetch.mock.calls[1][0]).toBe('https://www.googleapis.com/drive/v3/files/folder-1/permissions?sendNotificationEmail=false&fields=id');
      const adjudicator = role === 'adjudicator';
      const independent = !adjudicator && reviewMode === 'independent';
      const body = language === 'ja'
        ? `系統的レビューのデータ抽出「テスト SR」の${adjudicator ? '裁定者' : 'レビュアー'}をお願いします。以下の手順で参加してください。`
        : `Please join the systematic review data extraction "テスト SR" as ${adjudicator ? 'an adjudicator' : 'a reviewer'}. Follow these steps.`;
      expect(message.split('\n')[2]).toBe(body);
      expect(message).toContain(t('popup.openGrant'));
      expect(message).toContain(language === 'ja' ? 'このスプレッドシートを選ぶ' : 'select this spreadsheet');
      expect(message).toContain(adjudicator
        ? `4.${language === 'ja' ? '「不一致の解消」画面で裁定してください' : ' Adjudicate on the "Resolve conflicts" screen'}`
        : t('home.inviteStep4'));
      expect(message).toContain(t(adjudicator ? 'app.navAdjudicate' : 'app.navVerify'));
      if (adjudicator) {
        expect(message).not.toContain(t('home.inviteModeIndependent'));
        expect(message).not.toContain(t('home.inviteModeWithAi'));
      } else {
        expect(message).toContain(t(independent ? 'home.inviteModeIndependent' : 'home.inviteModeWithAi'));
      }
      expect(message.split('\n').at(-1)).toBe(language === 'ja'
        ? independent ? 'API キーの設定は要りません。' : 'API キーの設定は要りません（AI の下読みは済んでいます。質問パネルを使うときだけ、設定画面でご自身のキーを保存してください）。'
        : independent ? 'You do not need to configure an API key.' : 'You do not need to configure an API key (AI extraction is already complete. Only if you use the question panel, save your own key in Settings).');
      await copyReviewInvite(store, testDeps, email);
      expect(writeClipboard).toHaveBeenLastCalledWith(message);
      // 古い役割の行があっても、再共有とコピーは最新の登録内容を使う。
      store.setState({ reviewers: { ...store.getState().reviewers, assignments: [
        { email, role: adjudicator ? 'reviewer' : 'adjudicator', reviewMode: null, assignedBy: 'o', assignedAt: 't-before' },
        ...(store.getState().reviewers.assignments ?? []),
      ] } });
      await reshareReviewer(store, testDeps, email);
      expect(new URL(fetch.mock.calls[2][0] as string).searchParams.get('emailMessage')).toBe(message);
      expect(fetch.mock.calls[3][0]).toBe(fetch.mock.calls[1][0]);
      await copyReviewInvite(store, testDeps, email);
      expect(writeClipboard).toHaveBeenLastCalledWith(message);
    });
  });

  test('解除済みの役割は不明としてレビュアーの案内を使う', async () => {
    const store = makeStore();
    const email = 'r@example.com';
    store.setState({ reviewers: { ...store.getState().reviewers, assignments: [
      { email, role: 'revoked', reviewMode: null, assignedBy: 'o', assignedAt: 't' },
    ] } });
    const writeClipboard = jest.fn().mockResolvedValue(undefined);
    await reshareReviewer(store, deps, email);
    await copyReviewInvite(store, { ...deps, writeClipboard }, email);
    expect(writeClipboard).toHaveBeenCalledWith(shareProjectWithReviewerMock.mock.calls[0][3]);
    expect(writeClipboard.mock.calls[0][0]).toContain('のレビュアーをお願いします');
  });
});
