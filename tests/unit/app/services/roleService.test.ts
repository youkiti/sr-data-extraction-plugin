import {
  checkMissingFileAccess,
  fileAccessRecordStorageKey,
  folderAccessStorageKey,
  grantFolderAccess,
  grantSpreadsheetAccess,
  loadRole,
  resolveProjectRole,
  skipMissingFileAccess,
  type FileAccessRecord,
  type RoleServiceDeps,
} from '../../../../src/app/services/roleService';
import { createInitialState, createStore, type Store } from '../../../../src/app/store';
import { loadProjectMeta } from '../../../../src/features/project/selectProject';
import { readReviewerAssignments } from '../../../../src/features/project/reviewerRepository';
import { readDocuments } from '../../../../src/features/documents/documentRepository';
import type { DocumentRecord } from '../../../../src/domain/document';
import { getFileMd5, getFileText } from '../../../../src/lib/google/drive';
import { openProjectFilesPicker, openSpreadsheetPicker } from '../../../../src/lib/google/picker';
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
  getFileMd5: jest.fn(),
  getFileText: jest.fn(),
}));
jest.mock('../../../../src/lib/google/picker', () => ({
  openProjectFilesPicker: jest.fn(),
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
const getFileMd5Mock = getFileMd5 as jest.MockedFunction<typeof getFileMd5>;
const openProjectFilesPickerMock = openProjectFilesPicker as jest.MockedFunction<
  typeof openProjectFilesPicker
>;
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

/** deps に sleep モックを差し込む（伝播待ちリトライのテスト用。両 grant 系 describe で共用） */
function depsWithSleep(email: string): { deps: RoleServiceDeps; sleep: jest.Mock } {
  const sleep = jest.fn(async () => undefined);
  return { deps: { ...makeDeps(email), sleep }, sleep };
}

beforeEach(() => {
  jest.clearAllMocks();
  loadProjectMetaMock.mockResolvedValue(META);
  readReviewerAssignmentsMock.mockResolvedValue([]);
  // clearAllMocks は呼び出し履歴だけをクリアし mockImplementation は引き継がれるため、
  // 個別テストで getLocal に特殊な実装（mockImplementation / 拒否）を積んだ場合に後続テストへ
  // 漏れないよう、毎テスト開始時に安全な既定（未設定 = undefined）へ戻す
  getLocalMock.mockResolvedValue(undefined);
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
      folderAccessMissingCount: null,
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
    expect(getLocalMock).toHaveBeenCalledWith(folderAccessStorageKey('sheet-1', 'r1@example.com'));
    expect(store.getState().role.role).toBe('reviewer_with_ai');
    expect(store.getState().role.folderAccessGranted).toBe(true);
  });

  test('email が取得できないときは空文字キーで読む（防御的フォールバック）', async () => {
    const state = createInitialState();
    state.currentProject = PROJECT;
    const store = createStore(state);
    await loadRole(store, makeDeps(''));
    expect(getLocalMock).toHaveBeenCalledWith(folderAccessStorageKey('sheet-1', ''));
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
      folderAccessMissingCount: null,
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
  test('プロジェクト × アカウントのキーを生成する（同一プロファイルのアカウント切替で流用しない）', () => {
    expect(folderAccessStorageKey('sheet-1', 'r1@example.com')).toBe(
      'sr-data-extraction:folder-access-granted:sheet-1:r1@example.com',
    );
  });
});

describe('grantFolderAccess（issue #139: ファイル単位付与・issue #141: 差分付与）', () => {
  function makeStore(patch: Partial<ReturnType<typeof createInitialState>['role']> = {}): Store {
    const state = createInitialState();
    state.currentProject = PROJECT;
    state.role = { ...state.role, ...patch };
    return createStore(state);
  }

  function doc(patch: Partial<DocumentRecord> = {}): DocumentRecord {
    return {
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
      ...patch,
    };
  }

  /** FileAccessRecord の読み出しだけを差し替える（folderAccessStorageKey の boolean 読み出しは
   * このテストでは使わないため undefined のまま。getLocalMock は共有モックなのでキーで分岐する） */
  function mockStoredRecord(email: string, record: FileAccessRecord): void {
    getLocalMock.mockImplementation(async (key: string) => {
      if (key === fileAccessRecordStorageKey('sheet-1', email)) {
        return record;
      }
      return undefined;
    });
  }

  test('プロジェクト未選択なら no-op', async () => {
    const store = createStore(createInitialState());
    await grantFolderAccess(store, makeDeps('r1@example.com'));
    expect(readDocumentsMock).not.toHaveBeenCalled();
    expect(openProjectFilesPickerMock).not.toHaveBeenCalled();
  });

  test('確認中の再入は no-op', async () => {
    const store = makeStore({ folderAccessChecking: true });
    await grantFolderAccess(store, makeDeps('r1@example.com'));
    expect(readDocumentsMock).not.toHaveBeenCalled();
  });

  test('Documents の読み出し失敗はエラーを記録し、Picker を開かない', async () => {
    readDocumentsMock.mockRejectedValue(new Error('sheet unreachable'));
    const store = makeStore();
    await grantFolderAccess(store, makeDeps('r1@example.com'));
    expect(store.getState().role.folderAccessChecking).toBe(false);
    expect(store.getState().role.folderAccessError).toBe('sheet unreachable');
    expect(openProjectFilesPickerMock).not.toHaveBeenCalled();
  });

  test('付与対象 0 件（Documents 0 件）は Picker を開かずフラグを立てる', async () => {
    readDocumentsMock.mockResolvedValue([]);
    const store = makeStore();
    await grantFolderAccess(store, makeDeps('r1@example.com'));
    expect(openProjectFilesPickerMock).not.toHaveBeenCalled();
    expect(setLocalMock).toHaveBeenCalledWith(folderAccessStorageKey('sheet-1', 'r1@example.com'), true);
    expect(store.getState().role.folderAccessGranted).toBe(true);
    expect(store.getState().role.folderAccessMissingCount).toBe(0);
  });

  test('付与対象 0 件（drive_file_id 空 + text_ref 解析不能）も Picker を開かずフラグを立てる', async () => {
    readDocumentsMock.mockResolvedValue([doc({ driveFileId: '', textRef: 'not-a-url' })]);
    const store = makeStore();
    await grantFolderAccess(store, makeDeps('r1@example.com'));
    expect(openProjectFilesPickerMock).not.toHaveBeenCalled();
    expect(store.getState().role.folderAccessGranted).toBe(true);
  });

  test('email が取得できないときは空文字キーで保存する（防御的フォールバック）', async () => {
    readDocumentsMock.mockResolvedValue([]);
    const store = makeStore();
    await grantFolderAccess(store, makeDeps(''));
    expect(setLocalMock).toHaveBeenCalledWith(folderAccessStorageKey('sheet-1', ''), true);
  });

  test('付与対象 0 件でフラグ保存が失敗したら checking を戻してエラーを記録する（未処理拒否にしない）', async () => {
    readDocumentsMock.mockResolvedValue([]);
    setLocalMock.mockRejectedValueOnce(new Error('storage full'));
    const store = makeStore();
    await grantFolderAccess(store, makeDeps('r1@example.com'));
    expect(store.getState().role.folderAccessChecking).toBe(false);
    expect(store.getState().role.folderAccessError).toBe('storage full');
    expect(store.getState().role.folderAccessGranted).toBe(false);
  });

  test('付与済みレコードの読み出しに失敗したら fail し、Picker を開かない', async () => {
    readDocumentsMock.mockResolvedValue([doc()]);
    getLocalMock.mockImplementation(async (key: string) => {
      if (key === fileAccessRecordStorageKey('sheet-1', 'r1@example.com')) {
        throw new Error('storage unavailable');
      }
      return undefined;
    });
    const store = makeStore();
    await grantFolderAccess(store, makeDeps('r1@example.com'));
    expect(openProjectFilesPickerMock).not.toHaveBeenCalled();
    expect(store.getState().role.folderAccessChecking).toBe(false);
    expect(store.getState().role.folderAccessError).toBe('storage unavailable');
  });

  test('Picker 起動失敗はエラーを記録する', async () => {
    readDocumentsMock.mockResolvedValue([doc()]);
    openProjectFilesPickerMock.mockRejectedValue(new Error('picker offline'));
    const store = makeStore();
    await grantFolderAccess(store, makeDeps('r1@example.com'));
    expect(store.getState().role.folderAccessChecking).toBe(false);
    expect(store.getState().role.folderAccessError).toBe('picker offline');
    expect(store.getState().role.folderAccessGranted).toBe(false);
  });

  test('キャンセル（null）は何も変えない', async () => {
    readDocumentsMock.mockResolvedValue([doc()]);
    openProjectFilesPickerMock.mockResolvedValue(null);
    const store = makeStore();
    await grantFolderAccess(store, makeDeps('r1@example.com'));
    expect(store.getState().role.folderAccessChecking).toBe(false);
    expect(store.getState().role.folderAccessGranted).toBe(false);
    expect(getFileTextMock).not.toHaveBeenCalled();
  });

  test('選択 0 件（空配列）も何も変えない', async () => {
    readDocumentsMock.mockResolvedValue([doc()]);
    openProjectFilesPickerMock.mockResolvedValue([]);
    const store = makeStore();
    await grantFolderAccess(store, makeDeps('r1@example.com'));
    expect(store.getState().role.folderAccessGranted).toBe(false);
  });

  test('必要ファイル ID（PDF + 抽出テキスト）を重複なく列挙し、候補（不足分）として Picker を開く', async () => {
    readDocumentsMock.mockResolvedValue([
      doc(),
      doc({ documentId: 'doc-2' }),
      doc({ documentId: 'doc-3', driveFileId: 'drive-2', textRef: null }),
    ]);
    openProjectFilesPickerMock.mockResolvedValue(null);
    const store = makeStore();
    await grantFolderAccess(store, makeDeps('r1@example.com'));
    // 付与済みレコードが無い（初回）ので候補 = required 全件
    expect(openProjectFilesPickerMock).toHaveBeenCalledWith(expect.anything(), [
      'drive-1',
      'txt-1',
      'drive-2',
    ]);
  });

  test('一部だけ選択されても弾かず、選択分を永続化して不足分の件数を記録する（issue #141）', async () => {
    readDocumentsMock.mockResolvedValue([
      doc(),
      doc({ documentId: 'doc-2', driveFileId: 'drive-2', textRef: null }),
    ]);
    openProjectFilesPickerMock.mockResolvedValue([{ sourceFileId: 'drive-1', filename: 'a.pdf' }]);
    const store = makeStore();
    await grantFolderAccess(store, makeDeps('r1@example.com'));
    expect(openProjectFilesPickerMock).toHaveBeenCalledWith(expect.anything(), [
      'drive-1',
      'txt-1',
      'drive-2',
    ]);
    expect(setLocalMock).toHaveBeenCalledWith(fileAccessRecordStorageKey('sheet-1', 'r1@example.com'), {
      granted: ['drive-1'],
      skipped: [],
    });
    expect(store.getState().role.folderAccessGranted).toBe(false);
    expect(store.getState().role.folderAccessMissingCount).toBe(2);
    expect(store.getState().role.folderAccessError).toBeNull();
    expect(getFileTextMock).not.toHaveBeenCalled();
  });

  test('選択分の永続化に失敗したら fail し、到達性は確認しない', async () => {
    readDocumentsMock.mockResolvedValue([doc()]);
    openProjectFilesPickerMock.mockResolvedValue([{ sourceFileId: 'drive-1', filename: 'a.pdf' }]);
    setLocalMock.mockRejectedValueOnce(new Error('storage full'));
    const store = makeStore();
    await grantFolderAccess(store, makeDeps('r1@example.com'));
    expect(getFileTextMock).not.toHaveBeenCalled();
    expect(store.getState().role.folderAccessChecking).toBe(false);
    expect(store.getState().role.folderAccessError).toBe('storage full');
    expect(store.getState().role.folderAccessGranted).toBe(false);
  });

  test('2 回目の Picker は前回までに記録した分を除いた不足分のみで開く（差分付与）', async () => {
    readDocumentsMock.mockResolvedValue([
      doc(),
      doc({ documentId: 'doc-2', driveFileId: 'drive-2', textRef: null }),
    ]);
    mockStoredRecord('r1@example.com', { granted: ['drive-1', 'txt-1'], skipped: [] });
    openProjectFilesPickerMock.mockResolvedValue([{ sourceFileId: 'drive-2', filename: 'b.pdf' }]);
    getFileTextMock.mockResolvedValue('本文');
    const store = makeStore();
    await grantFolderAccess(store, makeDeps('r1@example.com'));
    expect(openProjectFilesPickerMock).toHaveBeenCalledWith(expect.anything(), ['drive-2']);
    expect(store.getState().role.folderAccessGranted).toBe(true);
    expect(store.getState().role.folderAccessMissingCount).toBe(0);
  });

  test('候補 0 件（required が既に granted / skipped で埋まっている）なら Picker を開かず到達性のみ確認する', async () => {
    readDocumentsMock.mockResolvedValue([doc()]);
    mockStoredRecord('r1@example.com', { granted: ['drive-1'], skipped: ['txt-1'] });
    getFileTextMock.mockResolvedValue('本文');
    const store = makeStore();
    await grantFolderAccess(store, makeDeps('r1@example.com'));
    expect(openProjectFilesPickerMock).not.toHaveBeenCalled();
    expect(getFileTextMock).toHaveBeenCalledWith('txt-1', expect.anything());
    expect(store.getState().role.folderAccessGranted).toBe(true);
    expect(store.getState().role.folderAccessMissingCount).toBe(0);
  });

  test('候補 0 件で到達性確認に失敗したらフラグを立てず、最後のエラーを記録する', async () => {
    readDocumentsMock.mockResolvedValue([doc()]);
    mockStoredRecord('r1@example.com', { granted: ['drive-1'], skipped: ['txt-1'] });
    getFileTextMock.mockRejectedValue(new Error('HTTP 404'));
    const store = makeStore();
    const { deps, sleep } = depsWithSleep('r1@example.com');
    await grantFolderAccess(store, deps);
    expect(openProjectFilesPickerMock).not.toHaveBeenCalled();
    expect(getFileTextMock).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(store.getState().role.folderAccessGranted).toBe(false);
    expect(store.getState().role.folderAccessError).toBe('HTTP 404');
  });

  test('全件選択 + text_ref の試し読み成功でフラグを立てる', async () => {
    readDocumentsMock.mockResolvedValue([doc()]);
    openProjectFilesPickerMock.mockResolvedValue([
      { sourceFileId: 'drive-1', filename: 'a.pdf' },
      { sourceFileId: 'txt-1', filename: 'a.txt' },
    ]);
    getFileTextMock.mockResolvedValue('本文');
    const store = makeStore();
    await grantFolderAccess(store, makeDeps('r1@example.com'));
    expect(getFileTextMock).toHaveBeenCalledWith('txt-1', expect.anything());
    expect(getFileMd5Mock).not.toHaveBeenCalled();
    expect(setLocalMock).toHaveBeenCalledWith(fileAccessRecordStorageKey('sheet-1', 'r1@example.com'), {
      granted: ['drive-1', 'txt-1'],
      skipped: [],
    });
    expect(setLocalMock).toHaveBeenCalledWith(folderAccessStorageKey('sheet-1', 'r1@example.com'), true);
    expect(store.getState().role.folderAccessGranted).toBe(true);
    expect(store.getState().role.folderAccessChecking).toBe(false);
    expect(store.getState().role.folderAccessMissingCount).toBe(0);
  });

  test('試し読み成功後のフラグ保存失敗は到達性エラーと誤分類せず、再プローブしない', async () => {
    readDocumentsMock.mockResolvedValue([doc()]);
    openProjectFilesPickerMock.mockResolvedValue([
      { sourceFileId: 'drive-1', filename: 'a.pdf' },
      { sourceFileId: 'txt-1', filename: 'a.txt' },
    ]);
    getFileTextMock.mockResolvedValue('本文');
    // 1 回目 = 選択分の record 永続化（成功）、2 回目 = confirmGranted の boolean フラグ保存（失敗）
    setLocalMock.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('storage full'));
    const store = makeStore();
    await grantFolderAccess(store, makeDeps('r1@example.com'));
    expect(getFileTextMock).toHaveBeenCalledTimes(1);
    expect(store.getState().role.folderAccessChecking).toBe(false);
    expect(store.getState().role.folderAccessError).toBe('storage full');
    expect(store.getState().role.folderAccessGranted).toBe(false);
  });

  test('text_ref が 1 件も無い（全スキャン PDF）は先頭 PDF のメタデータ取得で到達性を確認する', async () => {
    readDocumentsMock.mockResolvedValue([doc({ textRef: null })]);
    openProjectFilesPickerMock.mockResolvedValue([{ sourceFileId: 'drive-1', filename: 'a.pdf' }]);
    getFileMd5Mock.mockResolvedValue('md5');
    const store = makeStore();
    await grantFolderAccess(store, makeDeps('r1@example.com'));
    expect(getFileTextMock).not.toHaveBeenCalled();
    expect(getFileMd5Mock).toHaveBeenCalledWith('drive-1', expect.anything());
    expect(store.getState().role.folderAccessGranted).toBe(true);
  });

  test('text_ref 解析不能 + 有効な drive_file_id はテキストを除外して PDF メタデータで確認する（挙動の固定）', async () => {
    readDocumentsMock.mockResolvedValue([doc({ textRef: 'not-a-url' })]);
    openProjectFilesPickerMock.mockResolvedValue([{ sourceFileId: 'drive-1', filename: 'a.pdf' }]);
    getFileMd5Mock.mockResolvedValue('md5');
    const store = makeStore();
    await grantFolderAccess(store, makeDeps('r1@example.com'));
    expect(openProjectFilesPickerMock).toHaveBeenCalledWith(expect.anything(), ['drive-1']);
    expect(getFileTextMock).not.toHaveBeenCalled();
    expect(getFileMd5Mock).toHaveBeenCalledWith('drive-1', expect.anything());
    expect(store.getState().role.folderAccessGranted).toBe(true);
  });

  test('試し読みが伝播遅延で失敗しても最大 3 回リトライして成功できる', async () => {
    readDocumentsMock.mockResolvedValue([doc()]);
    openProjectFilesPickerMock.mockResolvedValue([
      { sourceFileId: 'drive-1', filename: 'a.pdf' },
      { sourceFileId: 'txt-1', filename: 'a.txt' },
    ]);
    getFileTextMock
      .mockRejectedValueOnce(new Error('HTTP 404'))
      .mockRejectedValueOnce(new Error('HTTP 404'))
      .mockResolvedValue('本文');
    const store = makeStore();
    const { deps, sleep } = depsWithSleep('r1@example.com');
    await grantFolderAccess(store, deps);
    expect(getFileTextMock).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2_000);
    expect(store.getState().role.folderAccessGranted).toBe(true);
  });

  test('sleep 未注入時は既定の setTimeout 待ちでリトライする', async () => {
    jest.useFakeTimers();
    try {
      readDocumentsMock.mockResolvedValue([doc()]);
      openProjectFilesPickerMock.mockResolvedValue([
        { sourceFileId: 'drive-1', filename: 'a.pdf' },
        { sourceFileId: 'txt-1', filename: 'a.txt' },
      ]);
      getFileTextMock.mockRejectedValueOnce(new Error('HTTP 404')).mockResolvedValue('本文');
      const store = makeStore();
      const promise = grantFolderAccess(store, makeDeps('r1@example.com'));
      await jest.advanceTimersByTimeAsync(2_000);
      await promise;
      expect(getFileTextMock).toHaveBeenCalledTimes(2);
      expect(store.getState().role.folderAccessGranted).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  test('試し読みが 3 回失敗したらフラグを立てず、最後のエラーを記録する（選択分の記録は残る）', async () => {
    readDocumentsMock.mockResolvedValue([doc()]);
    openProjectFilesPickerMock.mockResolvedValue([
      { sourceFileId: 'drive-1', filename: 'a.pdf' },
      { sourceFileId: 'txt-1', filename: 'a.txt' },
    ]);
    getFileTextMock.mockRejectedValue(new Error('HTTP 404'));
    const store = makeStore();
    const { deps, sleep } = depsWithSleep('r1@example.com');
    await grantFolderAccess(store, deps);
    expect(getFileTextMock).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(store.getState().role.folderAccessGranted).toBe(false);
    expect(store.getState().role.folderAccessError).toBe('HTTP 404');
    // 選択分の永続化（record）は既に行われている。boolean フラグだけが未設定のまま
    expect(setLocalMock).toHaveBeenCalledTimes(1);
    expect(setLocalMock).toHaveBeenCalledWith(fileAccessRecordStorageKey('sheet-1', 'r1@example.com'), {
      granted: ['drive-1', 'txt-1'],
      skipped: [],
    });
  });
});

describe('fileAccessRecordStorageKey', () => {
  test('プロジェクト × アカウントのキーを生成する（folderAccessStorageKey とは別キー）', () => {
    expect(fileAccessRecordStorageKey('sheet-1', 'r1@example.com')).toBe(
      'sr-data-extraction:file-access-record:sheet-1:r1@example.com',
    );
  });
});

describe('skipMissingFileAccess（issue #141 課題 2: 削除済みファイルの恒久ブロック回避）', () => {
  function makeStore(patch: Partial<ReturnType<typeof createInitialState>['role']> = {}): Store {
    const state = createInitialState();
    state.currentProject = PROJECT;
    state.role = { ...state.role, ...patch };
    return createStore(state);
  }

  function doc(patch: Partial<DocumentRecord> = {}): DocumentRecord {
    return {
      documentId: 'doc-1',
      studyId: 'study-1',
      documentRole: 'article',
      driveFileId: 'drive-1',
      sourceFileId: 'src-1',
      filename: 'a.pdf',
      pmid: null,
      doi: null,
      textRef: null,
      textStatus: 'ok',
      pageCount: 1,
      charCount: 1,
      importedAt: 't',
      importedBy: 'e',
      note: null,
      ...patch,
    };
  }

  test('プロジェクト未選択なら no-op', async () => {
    const store = createStore(createInitialState());
    await skipMissingFileAccess(store, makeDeps('r1@example.com'));
    expect(readDocumentsMock).not.toHaveBeenCalled();
  });

  test('確認中の再入は no-op', async () => {
    const store = makeStore({ folderAccessChecking: true });
    await skipMissingFileAccess(store, makeDeps('r1@example.com'));
    expect(readDocumentsMock).not.toHaveBeenCalled();
  });

  test('Documents の読み出し失敗はエラーを記録する', async () => {
    readDocumentsMock.mockRejectedValue(new Error('sheet unreachable'));
    const store = makeStore();
    await skipMissingFileAccess(store, makeDeps('r1@example.com'));
    expect(store.getState().role.folderAccessChecking).toBe(false);
    expect(store.getState().role.folderAccessError).toBe('sheet unreachable');
  });

  test('レコード読み出し失敗はエラーを記録する', async () => {
    readDocumentsMock.mockResolvedValue([doc({ driveFileId: 'drive-1' })]);
    getLocalMock.mockRejectedValue(new Error('storage unavailable'));
    const store = makeStore();
    await skipMissingFileAccess(store, makeDeps('r1@example.com'));
    expect(store.getState().role.folderAccessError).toBe('storage unavailable');
  });

  test('不足分すべてを skipped として永続化し、ゲートを開く', async () => {
    readDocumentsMock.mockResolvedValue([
      doc({ driveFileId: 'drive-1' }),
      doc({ documentId: 'doc-2', driveFileId: 'drive-2' }),
    ]);
    const store = makeStore();
    await skipMissingFileAccess(store, makeDeps('r1@example.com'));
    expect(setLocalMock).toHaveBeenCalledWith(fileAccessRecordStorageKey('sheet-1', 'r1@example.com'), {
      granted: [],
      skipped: ['drive-1', 'drive-2'],
    });
    expect(setLocalMock).toHaveBeenCalledWith(folderAccessStorageKey('sheet-1', 'r1@example.com'), true);
    expect(store.getState().role).toMatchObject({
      folderAccessChecking: false,
      folderAccessGranted: true,
      folderAccessMissingCount: 0,
      folderAccessError: null,
    });
    expect(document.body.textContent).toContain('未付与のファイル 2 件をスキップしました');
  });

  test('既に granted / skipped 済みの ID は除外して不足分だけを skipped に足す', async () => {
    readDocumentsMock.mockResolvedValue([
      doc({ driveFileId: 'drive-1' }),
      doc({ documentId: 'doc-2', driveFileId: 'drive-2' }),
      doc({ documentId: 'doc-3', driveFileId: 'drive-3' }),
    ]);
    getLocalMock.mockImplementation(async (key: string) => {
      if (key === fileAccessRecordStorageKey('sheet-1', 'r1@example.com')) {
        return { granted: ['drive-1'], skipped: ['drive-2'] } as FileAccessRecord;
      }
      return undefined;
    });
    const store = makeStore();
    await skipMissingFileAccess(store, makeDeps('r1@example.com'));
    expect(setLocalMock).toHaveBeenCalledWith(fileAccessRecordStorageKey('sheet-1', 'r1@example.com'), {
      granted: ['drive-1'],
      skipped: ['drive-2', 'drive-3'],
    });
  });

  test('永続化に失敗したらエラーを記録し、ゲートを開かない', async () => {
    readDocumentsMock.mockResolvedValue([doc({ driveFileId: 'drive-1' })]);
    setLocalMock.mockRejectedValueOnce(new Error('storage full'));
    const store = makeStore();
    await skipMissingFileAccess(store, makeDeps('r1@example.com'));
    expect(store.getState().role.folderAccessGranted).toBe(false);
    expect(store.getState().role.folderAccessError).toBe('storage full');
  });

  test('email が取得できないときは空文字キーで保存する（防御的フォールバック）', async () => {
    readDocumentsMock.mockResolvedValue([doc({ driveFileId: 'drive-1' })]);
    const store = makeStore();
    await skipMissingFileAccess(store, makeDeps(''));
    expect(setLocalMock).toHaveBeenCalledWith(fileAccessRecordStorageKey('sheet-1', ''), {
      granted: [],
      skipped: ['drive-1'],
    });
    expect(setLocalMock).toHaveBeenCalledWith(folderAccessStorageKey('sheet-1', ''), true);
  });
});

describe('checkMissingFileAccess（issue #141 課題 1: 起動時の差分検知）', () => {
  function makeStore(patch: Partial<ReturnType<typeof createInitialState>['role']> = {}): Store {
    const state = createInitialState();
    state.currentProject = PROJECT;
    state.role = { ...state.role, role: 'reviewer_with_ai', folderAccessGranted: true, ...patch };
    return createStore(state);
  }

  function doc(patch: Partial<DocumentRecord> = {}): DocumentRecord {
    return {
      documentId: 'doc-1',
      studyId: 'study-1',
      documentRole: 'article',
      driveFileId: 'drive-1',
      sourceFileId: 'src-1',
      filename: 'a.pdf',
      pmid: null,
      doi: null,
      textRef: null,
      textStatus: 'ok',
      pageCount: 1,
      charCount: 1,
      importedAt: 't',
      importedBy: 'e',
      note: null,
      ...patch,
    };
  }

  test('プロジェクト未選択なら no-op', async () => {
    const store = createStore(createInitialState());
    await checkMissingFileAccess(store, makeDeps('r1@example.com'));
    expect(readDocumentsMock).not.toHaveBeenCalled();
  });

  test('role が未解決（null）なら no-op', async () => {
    const store = makeStore({ role: null });
    await checkMissingFileAccess(store, makeDeps('r1@example.com'));
    expect(readDocumentsMock).not.toHaveBeenCalled();
  });

  test('owner は no-op（フォルダアクセス付与の対象外）', async () => {
    const store = makeStore({ role: 'owner' });
    await checkMissingFileAccess(store, makeDeps('owner@example.com'));
    expect(readDocumentsMock).not.toHaveBeenCalled();
  });

  test('フォルダアクセス未付与なら no-op', async () => {
    const store = makeStore({ folderAccessGranted: false });
    await checkMissingFileAccess(store, makeDeps('r1@example.com'));
    expect(readDocumentsMock).not.toHaveBeenCalled();
  });

  test('計算済み（missingCount !== null）なら再計算しない（冪等ガード）', async () => {
    const store = makeStore({ folderAccessMissingCount: 0 });
    await checkMissingFileAccess(store, makeDeps('r1@example.com'));
    expect(readDocumentsMock).not.toHaveBeenCalled();
  });

  test('レコードが存在しない（レガシー: 旧 boolean のみで付与した既存 reviewer）は検知対象外', async () => {
    getLocalMock.mockResolvedValue(undefined);
    const store = makeStore();
    await checkMissingFileAccess(store, makeDeps('r1@example.com'));
    expect(readDocumentsMock).not.toHaveBeenCalled();
    expect(store.getState().role.folderAccessMissingCount).toBeNull();
  });

  test('候補 0 件（required が既に granted / skipped で埋まっている）は missingCount=0', async () => {
    getLocalMock.mockResolvedValue({ granted: ['drive-1'], skipped: [] });
    readDocumentsMock.mockResolvedValue([doc({ driveFileId: 'drive-1' })]);
    const store = makeStore();
    await checkMissingFileAccess(store, makeDeps('r1@example.com'));
    expect(getFileMd5Mock).not.toHaveBeenCalled();
    expect(store.getState().role.folderAccessMissingCount).toBe(0);
  });

  test('email が取得できないときは空文字キーで読む（防御的フォールバック）', async () => {
    getLocalMock.mockResolvedValue({ granted: ['drive-1'], skipped: [] });
    readDocumentsMock.mockResolvedValue([doc({ driveFileId: 'drive-1' })]);
    const store = makeStore();
    await checkMissingFileAccess(store, makeDeps(''));
    expect(getLocalMock).toHaveBeenCalledWith(fileAccessRecordStorageKey('sheet-1', ''));
    expect(store.getState().role.folderAccessMissingCount).toBe(0);
  });

  test('候補を試し読みして読めた ID は granted へ足し、永続化する（自己修復）', async () => {
    getLocalMock.mockResolvedValue({ granted: [], skipped: [] });
    readDocumentsMock.mockResolvedValue([
      doc({ driveFileId: 'drive-1' }),
      doc({ documentId: 'doc-2', driveFileId: 'drive-2' }),
    ]);
    getFileMd5Mock.mockResolvedValueOnce('md5-1').mockRejectedValueOnce(new Error('HTTP 404'));
    const store = makeStore();
    await checkMissingFileAccess(store, makeDeps('r1@example.com'));
    expect(getFileMd5Mock).toHaveBeenCalledTimes(2);
    expect(setLocalMock).toHaveBeenCalledWith(fileAccessRecordStorageKey('sheet-1', 'r1@example.com'), {
      granted: ['drive-1'],
      skipped: [],
    });
    expect(store.getState().role.folderAccessMissingCount).toBe(1);
  });

  test('全件読めなければ自己修復の永続化は行わず、missingCount = 候補数', async () => {
    getLocalMock.mockResolvedValue({ granted: [], skipped: [] });
    readDocumentsMock.mockResolvedValue([doc({ driveFileId: 'drive-1' })]);
    getFileMd5Mock.mockRejectedValue(new Error('HTTP 404'));
    const store = makeStore();
    await checkMissingFileAccess(store, makeDeps('r1@example.com'));
    expect(setLocalMock).not.toHaveBeenCalled();
    expect(store.getState().role.folderAccessMissingCount).toBe(1);
  });

  test('候補が 25 件を超える分はプローブせず missing 扱いにする（API 呼び出し数の上限）', async () => {
    getLocalMock.mockResolvedValue({ granted: [], skipped: [] });
    const docs = Array.from({ length: 30 }, (_, i) =>
      doc({ documentId: `doc-${i}`, driveFileId: `drive-${i}` }),
    );
    readDocumentsMock.mockResolvedValue(docs);
    getFileMd5Mock.mockResolvedValue('md5');
    const store = makeStore();
    await checkMissingFileAccess(store, makeDeps('r1@example.com'));
    expect(getFileMd5Mock).toHaveBeenCalledTimes(25);
    // 先頭 25 件は読めた（granted）ので、missing は超過分の 5 件のみ
    expect(store.getState().role.folderAccessMissingCount).toBe(5);
  });

  test('途中の失敗（Documents 読み出し等）は UI に出さず握りつぶす', async () => {
    getLocalMock.mockResolvedValue({ granted: [], skipped: [] });
    readDocumentsMock.mockRejectedValue(new Error('sheet unreachable'));
    const store = makeStore();
    await expect(checkMissingFileAccess(store, makeDeps('r1@example.com'))).resolves.toBeUndefined();
    expect(store.getState().role.folderAccessMissingCount).toBeNull();
    expect(store.getState().role.folderAccessError).toBeNull();
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
