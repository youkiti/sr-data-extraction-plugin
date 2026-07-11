import {
  folderAccessStorageKey,
  grantFolderAccess,
  loadRole,
  resolveProjectRole,
  type RoleServiceDeps,
} from '../../../../src/app/services/roleService';
import { createInitialState, createStore, type Store } from '../../../../src/app/store';
import { loadProjectMeta } from '../../../../src/features/project/selectProject';
import { readReviewerAssignments } from '../../../../src/features/project/reviewerRepository';
import { readDocuments } from '../../../../src/features/documents/documentRepository';
import { getFileText } from '../../../../src/lib/google/drive';
import { openPdfPicker } from '../../../../src/lib/google/picker';
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
