import {
  folderAccessStorageKey,
  grantFolderAccess,
  grantSpreadsheetAccess,
  loadRole,
  resolveProjectRole,
  type RoleServiceDeps,
} from '../../../../src/app/services/roleService';
import { createInitialState, createStore, type Store } from '../../../../src/app/store';
import { loadProjectMeta } from '../../../../src/features/project/selectProject';
import { readReviewerAssignments } from '../../../../src/features/project/reviewerRepository';
import { readDocuments } from '../../../../src/features/documents/documentRepository';
import { getFileText } from '../../../../src/lib/google/drive';
import { openPdfPicker, openSpreadsheetPicker } from '../../../../src/lib/google/picker';
import { SheetsAccessDeniedError } from '../../../../src/lib/google/sheets';
import { getLocal, setLocal } from '../../../../src/lib/storage/chromeStorage';

jest.mock('../../../../src/features/project/selectProject', () => ({
  loadProjectMeta: jest.fn(),
}));
jest.mock('../../../../src/features/project/reviewerRepository', () => ({
  ...jest.requireActual('../../../../src/features/project/reviewerRepository'),
  readReviewerAssignments: jest.fn(),
}));
jest.mock('../../../../src/features/documents/documentRepository', () => ({
  readDocuments: jest.fn(),
}));
jest.mock('../../../../src/lib/google/drive', () => ({
  getFileText: jest.fn(),
}));
jest.mock('../../../../src/lib/google/picker', () => ({
  openPdfPicker: jest.fn(),
  openSpreadsheetPicker: jest.fn(),
}));
jest.mock('../../../../src/lib/storage/chromeStorage', () => ({
  getLocal: jest.fn(),
  setLocal: jest.fn(),
}));

const loadProjectMetaMock = loadProjectMeta as jest.MockedFunction<typeof loadProjectMeta>;
const readReviewerAssignmentsMock = readReviewerAssignments as jest.MockedFunction<
  typeof readReviewerAssignments
>;
const readDocumentsMock = readDocuments as jest.MockedFunction<typeof readDocuments>;
const getFileTextMock = getFileText as jest.MockedFunction<typeof getFileText>;
const openPdfPickerMock = openPdfPicker as jest.MockedFunction<typeof openPdfPicker>;
const openSpreadsheetPickerMock = openSpreadsheetPicker as jest.MockedFunction<
  typeof openSpreadsheetPicker
>;
const getLocalMock = getLocal as jest.MockedFunction<typeof getLocal>;
const setLocalMock = setLocal as jest.MockedFunction<typeof setLocal>;

const PROJECT = {
  projectId: 'p1',
  spreadsheetId: 'sheet-1',
  driveFolderId: 'folder-1',
  name: 'テスト SR',
};

const META = {
  projectId: 'p1',
  projectTitle: 'テスト SR',
  spreadsheetId: 'sheet-1',
  driveFolderId: 'folder-1',
  schemaVersion: '1.0',
  createdAt: 't0',
  createdBy: 'owner@example.com',
};

function makeDeps(email: string): RoleServiceDeps {
  return {
    google: { fetch: jest.fn(), getAccessToken: jest.fn() },
    profile: { getProfileUserInfo: async () => ({ email, id: 'uid' }) },
    picker: {
      getAccessToken: async () => 'token',
      extensionId: 'ext',
      pickerPageUrl: 'https://example.com/picker.html',
      createTab: jest.fn(),
      removeTab: jest.fn(),
      addExternalMessageListener: jest.fn(() => () => undefined),
      addTabRemovedListener: jest.fn(() => () => undefined),
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  loadProjectMetaMock.mockResolvedValue(META);
  readReviewerAssignmentsMock.mockResolvedValue([]);
});

describe('resolveProjectRole', () => {
  test('email が Meta.created_by と一致 → owner', async () => {
    await expect(resolveProjectRole('sheet-1', makeDeps('owner@example.com'))).resolves.toBe('owner');
    expect(readReviewerAssignmentsMock).not.toHaveBeenCalled();
  });

  test('Reviewers に登録が無ければ unregistered', async () => {
    await expect(resolveProjectRole('sheet-1', makeDeps('nobody@example.com'))).resolves.toBe(
      'unregistered',
    );
  });

  test('role=revoked は unregistered', async () => {
    readReviewerAssignmentsMock.mockResolvedValue([
      { email: 'r1@example.com', role: 'revoked', reviewMode: null, assignedBy: 'owner@example.com', assignedAt: 't0' },
    ]);
    await expect(resolveProjectRole('sheet-1', makeDeps('r1@example.com'))).resolves.toBe(
      'unregistered',
    );
  });

  test('role=reviewer + review_mode=with_ai → reviewer_with_ai', async () => {
    readReviewerAssignmentsMock.mockResolvedValue([
      { email: 'r1@example.com', role: 'reviewer', reviewMode: 'with_ai', assignedBy: 'o', assignedAt: 't' },
    ]);
    await expect(resolveProjectRole('sheet-1', makeDeps('r1@example.com'))).resolves.toBe(
      'reviewer_with_ai',
    );
  });

  test('role=reviewer + review_mode=independent → reviewer_independent', async () => {
    readReviewerAssignmentsMock.mockResolvedValue([
      { email: 'r1@example.com', role: 'reviewer', reviewMode: 'independent', assignedBy: 'o', assignedAt: 't' },
    ]);
    await expect(resolveProjectRole('sheet-1', makeDeps('r1@example.com'))).resolves.toBe(
      'reviewer_independent',
    );
  });

  test('role=reviewer + review_mode 欠落（防御的）は with_ai として扱う', async () => {
    readReviewerAssignmentsMock.mockResolvedValue([
      { email: 'r1@example.com', role: 'reviewer', reviewMode: null, assignedBy: 'o', assignedAt: 't' },
    ]);
    await expect(resolveProjectRole('sheet-1', makeDeps('r1@example.com'))).resolves.toBe(
      'reviewer_with_ai',
    );
  });

  test('role=adjudicator → adjudicator', async () => {
    readReviewerAssignmentsMock.mockResolvedValue([
      { email: 'r1@example.com', role: 'adjudicator', reviewMode: null, assignedBy: 'o', assignedAt: 't' },
    ]);
    await expect(resolveProjectRole('sheet-1', makeDeps('r1@example.com'))).resolves.toBe(
      'adjudicator',
    );
  });

  test('email が取得できない（空文字）場合は owner 一致にならず Reviewers を見に行く', async () => {
    await expect(resolveProjectRole('sheet-1', makeDeps(''))).resolves.toBe('unregistered');
    expect(readReviewerAssignmentsMock).toHaveBeenCalled();
  });
});

describe('loadRole', () => {
  function makeStore(patch: Partial<ReturnType<typeof createInitialState>> = {}): Store {
    return createStore({ ...createInitialState(), ...patch });
  }

  test('プロジェクト未選択なら no-op', async () => {
    const store = makeStore();
    await loadRole(store, makeDeps('owner@example.com'));
    expect(loadProjectMetaMock).not.toHaveBeenCalled();
  });

  test('既に解決済みなら no-op', async () => {
    const state = createInitialState();
    state.currentProject = PROJECT;
    state.role = { ...state.role, role: 'owner' };
    const store = createStore(state);
    await loadRole(store, makeDeps('owner@example.com'));
    expect(loadProjectMetaMock).not.toHaveBeenCalled();
  });

  test('解決中なら no-op（二重解決しない）', async () => {
    const state = createInitialState();
    state.currentProject = PROJECT;
    state.role = { ...state.role, resolving: true };
    const store = createStore(state);
    await loadRole(store, makeDeps('owner@example.com'));
    expect(loadProjectMetaMock).not.toHaveBeenCalled();
  });

  test('owner を解決したら folderAccessGranted=true を無条件で立てる（storage.local を見ない）', async () => {
    const state = createInitialState();
    state.currentProject = PROJECT;
    const store = createStore(state);
    await loadRole(store, makeDeps('owner@example.com'));
    expect(store.getState().role).toEqual({
      role: 'owner',
      resolving: false,
      error: null,
      accessDenied: false,
      folderAccessGranted: true,
      folderAccessChecking: false,
      folderAccessError: null,
    });
    expect(getLocalMock).not.toHaveBeenCalled();
  });

  test('reviewer を解決したら storage.local のフラグを読む', async () => {
    readReviewerAssignmentsMock.mockResolvedValue([
      { email: 'r1@example.com', role: 'reviewer', reviewMode: 'with_ai', assignedBy: 'o', assignedAt: 't' },
    ]);
    getLocalMock.mockResolvedValue(true);
    const state = createInitialState();
    state.currentProject = PROJECT;
    const store = createStore(state);
    await loadRole(store, makeDeps('r1@example.com'));
    expect(getLocalMock).toHaveBeenCalledWith(folderAccessStorageKey('sheet-1'));
    expect(store.getState().role.role).toBe('reviewer_with_ai');
    expect(store.getState().role.folderAccessGranted).toBe(true);
  });

  test('reviewer で storage.local が未設定なら folderAccessGranted=false', async () => {
    readReviewerAssignmentsMock.mockResolvedValue([
      { email: 'r1@example.com', role: 'reviewer', reviewMode: 'with_ai', assignedBy: 'o', assignedAt: 't' },
    ]);
    getLocalMock.mockResolvedValue(undefined);
    const state = createInitialState();
    state.currentProject = PROJECT;
    const store = createStore(state);
    await loadRole(store, makeDeps('r1@example.com'));
    expect(store.getState().role.folderAccessGranted).toBe(false);
  });

  test('失敗時は error を記録し role は null のまま', async () => {
    loadProjectMetaMock.mockRejectedValue(new Error('HTTP 500'));
    const state = createInitialState();
    state.currentProject = PROJECT;
    const store = createStore(state);
    await loadRole(store, makeDeps('owner@example.com'));
    expect(store.getState().role).toEqual({
      role: null,
      resolving: false,
      error: 'HTTP 500',
      accessDenied: false,
      folderAccessGranted: false,
      folderAccessChecking: false,
      folderAccessError: null,
    });
  });

  test('Error 以外の throw も文字列化する', async () => {
    loadProjectMetaMock.mockRejectedValue('boom');
    const state = createInitialState();
    state.currentProject = PROJECT;
    const store = createStore(state);
    await loadRole(store, makeDeps('owner@example.com'));
    expect(store.getState().role.error).toBe('boom');
  });

  test('SheetsAccessDeniedError なら accessDenied=true（許可導線を出す。issue #131）', async () => {
    loadProjectMetaMock.mockRejectedValue(new SheetsAccessDeniedError('sheet-1', 404));
    const state = createInitialState();
    state.currentProject = PROJECT;
    const store = createStore(state);
    await loadRole(store, makeDeps('r1@example.com'));
    expect(store.getState().role.accessDenied).toBe(true);
    expect(store.getState().role.error).toContain('権限がまだありません');
  });

  test('解決を開始したら前回の accessDenied をリセットする', async () => {
    const state = createInitialState();
    state.currentProject = PROJECT;
    state.role = { ...state.role, error: null, accessDenied: true };
    const store = createStore(state);
    await loadRole(store, makeDeps('owner@example.com'));
    expect(store.getState().role.accessDenied).toBe(false);
    expect(store.getState().role.role).toBe('owner');
  });
});

describe('folderAccessStorageKey', () => {
  test('プロジェクト単位のキーを生成する', () => {
    expect(folderAccessStorageKey('sheet-1')).toBe(
      'sr-data-extraction:folder-access-granted:sheet-1',
    );
  });
});

describe('grantFolderAccess', () => {
  function makeStore(patch: Partial<ReturnType<typeof createInitialState>['role']> = {}): Store {
    const state = createInitialState();
    state.currentProject = PROJECT;
    state.role = { ...state.role, ...patch };
    return createStore(state);
  }

  test('プロジェクト未選択なら no-op', async () => {
    const store = createStore(createInitialState());
    await grantFolderAccess(store, makeDeps('r1@example.com'));
    expect(openPdfPickerMock).not.toHaveBeenCalled();
  });

  test('確認中の再入は no-op', async () => {
    const store = makeStore({ folderAccessChecking: true });
    await grantFolderAccess(store, makeDeps('r1@example.com'));
    expect(openPdfPickerMock).not.toHaveBeenCalled();
  });

  test('Picker 起動失敗はエラーを記録する', async () => {
    openPdfPickerMock.mockRejectedValue(new Error('picker offline'));
    const store = makeStore();
    await grantFolderAccess(store, makeDeps('r1@example.com'));
    expect(store.getState().role.folderAccessChecking).toBe(false);
    expect(store.getState().role.folderAccessError).toBe('picker offline');
    expect(store.getState().role.folderAccessGranted).toBe(false);
  });

  test('キャンセル（null）は何も変えない', async () => {
    openPdfPickerMock.mockResolvedValue(null);
    const store = makeStore();
    await grantFolderAccess(store, makeDeps('r1@example.com'));
    expect(store.getState().role.folderAccessChecking).toBe(false);
    expect(store.getState().role.folderAccessGranted).toBe(false);
    expect(readDocumentsMock).not.toHaveBeenCalled();
  });

  test('選択 0 件（空配列）も何も変えない', async () => {
    openPdfPickerMock.mockResolvedValue([]);
    const store = makeStore();
    await grantFolderAccess(store, makeDeps('r1@example.com'));
    expect(store.getState().role.folderAccessGranted).toBe(false);
  });

  test('Documents 先頭の text_ref を試し読みして成功したらフラグを立てる', async () => {
    openPdfPickerMock.mockResolvedValue([{ sourceFileId: 'f1', filename: 'a.pdf' }]);
    readDocumentsMock.mockResolvedValue([
      {
        documentId: 'doc-1',
        studyId: 'study-1',
        documentRole: 'article',
        driveFileId: 'drive-1',
        sourceFileId: 'src-1',
        filename: 'a.pdf',
        pmid: null,
        doi: null,
        textRef: 'https://drive.google.com/file/d/txt-1/view',
        textStatus: 'ok',
        pageCount: 1,
        charCount: 1,
        importedAt: 't',
        importedBy: 'e',
        note: null,
      },
    ]);
    getFileTextMock.mockResolvedValue('本文');
    const store = makeStore();
    await grantFolderAccess(store, makeDeps('r1@example.com'));
    expect(getFileTextMock).toHaveBeenCalledWith('txt-1', expect.anything());
    expect(setLocalMock).toHaveBeenCalledWith(folderAccessStorageKey('sheet-1'), true);
    expect(store.getState().role.folderAccessGranted).toBe(true);
    expect(store.getState().role.folderAccessChecking).toBe(false);
  });

  test('Documents 0 件は試し読みをスキップしてフラグを立てる', async () => {
    openPdfPickerMock.mockResolvedValue([{ sourceFileId: 'f1', filename: 'a.pdf' }]);
    readDocumentsMock.mockResolvedValue([]);
    const store = makeStore();
    await grantFolderAccess(store, makeDeps('r1@example.com'));
    expect(getFileTextMock).not.toHaveBeenCalled();
    expect(store.getState().role.folderAccessGranted).toBe(true);
  });

  test('text_ref からファイル ID を解決できない場合も試し読みをスキップしてフラグを立てる', async () => {
    openPdfPickerMock.mockResolvedValue([{ sourceFileId: 'f1', filename: 'a.pdf' }]);
    readDocumentsMock.mockResolvedValue([
      {
        documentId: 'doc-1',
        studyId: 'study-1',
        documentRole: 'article',
        driveFileId: 'drive-1',
        sourceFileId: 'src-1',
        filename: 'a.pdf',
        pmid: null,
        doi: null,
        textRef: 'not-a-url',
        textStatus: 'ok',
        pageCount: 1,
        charCount: 1,
        importedAt: 't',
        importedBy: 'e',
        note: null,
      },
    ]);
    const store = makeStore();
    await grantFolderAccess(store, makeDeps('r1@example.com'));
    expect(getFileTextMock).not.toHaveBeenCalled();
    expect(store.getState().role.folderAccessGranted).toBe(true);
  });

  test('試し読みに失敗したらフラグを立てず、エラーを記録する', async () => {
    openPdfPickerMock.mockResolvedValue([{ sourceFileId: 'f1', filename: 'a.pdf' }]);
    readDocumentsMock.mockResolvedValue([
      {
        documentId: 'doc-1',
        studyId: 'study-1',
        documentRole: 'article',
        driveFileId: 'drive-1',
        sourceFileId: 'src-1',
        filename: 'a.pdf',
        pmid: null,
        doi: null,
        textRef: 'https://drive.google.com/file/d/txt-1/view',
        textStatus: 'ok',
        pageCount: 1,
        charCount: 1,
        importedAt: 't',
        importedBy: 'e',
        note: null,
      },
    ]);
    getFileTextMock.mockRejectedValue(new Error('HTTP 403'));
    const store = makeStore();
    await grantFolderAccess(store, makeDeps('r1@example.com'));
    expect(store.getState().role.folderAccessGranted).toBe(false);
    expect(store.getState().role.folderAccessError).toBe('HTTP 403');
    expect(setLocalMock).not.toHaveBeenCalled();
  });
});

describe('grantSpreadsheetAccess（issue #131。docs/ui-states.md §3 ロール解決）', () => {
  function makeDeniedStore(): Store {
    const state = createInitialState();
    state.currentProject = PROJECT;
    state.role = {
      ...state.role,
      error: 'このスプレッドシートを開く権限がまだありません',
      accessDenied: true,
    };
    return createStore(state);
  }

  function depsWithSleep(email: string): { deps: RoleServiceDeps; sleep: jest.Mock } {
    const sleep = jest.fn(async () => undefined);
    return { deps: { ...makeDeps(email), sleep }, sleep };
  }

  test('プロジェクト未選択なら no-op', async () => {
    const store = createStore(createInitialState());
    await grantSpreadsheetAccess(store, makeDeps('r1@example.com'));
    expect(openSpreadsheetPickerMock).not.toHaveBeenCalled();
  });

  test('cancelled は状態を変えない（案内とボタンは残る）', async () => {
    openSpreadsheetPickerMock.mockResolvedValue('cancelled');
    const store = makeDeniedStore();
    await grantSpreadsheetAccess(store, makeDeps('r1@example.com'));
    expect(openSpreadsheetPickerMock).toHaveBeenCalledWith(expect.anything(), 'sheet-1');
    expect(store.getState().role.accessDenied).toBe(true);
    expect(loadProjectMetaMock).not.toHaveBeenCalled();
  });

  test('mismatch はトースト表示のみで状態を変えない', async () => {
    openSpreadsheetPickerMock.mockResolvedValue('mismatch');
    const store = makeDeniedStore();
    await grantSpreadsheetAccess(store, makeDeps('r1@example.com'));
    expect(store.getState().role.accessDenied).toBe(true);
    expect(loadProjectMetaMock).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('スプレッドシートと異なります');
  });

  test('Picker 失敗はトースト表示のみで状態を変えない', async () => {
    openSpreadsheetPickerMock.mockRejectedValue(new Error('タブの作成に失敗'));
    const store = makeDeniedStore();
    await grantSpreadsheetAccess(store, makeDeps('r1@example.com'));
    expect(store.getState().role.accessDenied).toBe(true);
    expect(document.body.textContent).toContain('タブの作成に失敗');
  });

  test('granted → 再解決成功でロールが確定する（リトライ・sleep なし）', async () => {
    openSpreadsheetPickerMock.mockResolvedValue('granted');
    const store = makeDeniedStore();
    const { deps, sleep } = depsWithSleep('owner@example.com');
    await grantSpreadsheetAccess(store, deps);
    expect(store.getState().role.role).toBe('owner');
    expect(store.getState().role.error).toBeNull();
    expect(store.getState().role.accessDenied).toBe(false);
    expect(sleep).not.toHaveBeenCalled();
  });

  test('granted → 拒否が続いたら 3 回で打ち切り、一般エラーへ切替（再誘導しない）', async () => {
    openSpreadsheetPickerMock.mockResolvedValue('granted');
    loadProjectMetaMock.mockRejectedValue(new SheetsAccessDeniedError('sheet-1', 404));
    const store = makeDeniedStore();
    const { deps, sleep } = depsWithSleep('r1@example.com');
    await grantSpreadsheetAccess(store, deps);
    expect(loadProjectMetaMock).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2_000);
    expect(store.getState().role.accessDenied).toBe(false);
    expect(store.getState().role.error).toContain('許可後もアクセスできませんでした');
  });

  test('granted → 2 回目で成功するケース（ACL 伝播待ち）', async () => {
    openSpreadsheetPickerMock.mockResolvedValue('granted');
    loadProjectMetaMock
      .mockRejectedValueOnce(new SheetsAccessDeniedError('sheet-1', 404))
      .mockResolvedValue(META);
    const store = makeDeniedStore();
    const { deps, sleep } = depsWithSleep('owner@example.com');
    await grantSpreadsheetAccess(store, deps);
    expect(store.getState().role.role).toBe('owner');
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  test('granted → アクセス以外のエラーは即打ち切り、通常のロールエラー表示に任せる', async () => {
    openSpreadsheetPickerMock.mockResolvedValue('granted');
    loadProjectMetaMock.mockRejectedValue(new Error('HTTP 500'));
    const store = makeDeniedStore();
    const { deps, sleep } = depsWithSleep('r1@example.com');
    await grantSpreadsheetAccess(store, deps);
    expect(loadProjectMetaMock).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(store.getState().role.error).toBe('HTTP 500');
    expect(store.getState().role.accessDenied).toBe(false);
  });

  test('sleep 未注入でも既定の setTimeout 実装で完走する', async () => {
    jest.useFakeTimers();
    try {
      openSpreadsheetPickerMock.mockResolvedValue('granted');
      loadProjectMetaMock
        .mockRejectedValueOnce(new SheetsAccessDeniedError('sheet-1', 404))
        .mockResolvedValue(META);
      const store = makeDeniedStore();
      const promise = grantSpreadsheetAccess(store, makeDeps('owner@example.com'));
      await jest.advanceTimersByTimeAsync(2_000);
      await promise;
      expect(store.getState().role.role).toBe('owner');
    } finally {
      jest.useRealTimers();
    }
  });
});
