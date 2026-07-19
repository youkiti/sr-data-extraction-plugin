// documentsService（S3 グルーピング）のテスト。lib/google / features/documents の I/O は
// モジュールモックで置き換え、studyRepository の純粋関数（resolveActiveStudies / studyLabelMap）は
// requireActual で本物を使う。ストア遷移とトースト文言を検証する
import { createInitialState, createStore, type Store } from '../../../../src/app/store';
import {
  activeStudyGroups,
  cancelMerge,
  confirmMerge,
  ignoreCandidate,
  ignoredCandidatesKey,
  importFromFiles,
  importFromPicker,
  importPickedSelections,
  loadDocuments,
  openMergeCandidate,
  openMergeDialog,
  saveDocumentRole,
  saveRegistrationId,
  saveStudyLabel,
  toggleStudySelection,
  updateMergeDialog,
  visibleMergeCandidates,
  type DocumentsServiceDeps,
} from '../../../../src/app/services/documentsService';
import type { DocumentRecord } from '../../../../src/domain/document';
import type { StudyRecord } from '../../../../src/domain/study';
import { dedupSelections } from '../../../../src/features/documents/dedupSelections';
import { readDocuments, updateDocument } from '../../../../src/features/documents/documentRepository';
import { importDocuments } from '../../../../src/features/documents/importDocuments';
import {
  appendStudies,
  readStudies,
  updateStudy,
} from '../../../../src/features/documents/studyRepository';
import { readRunStudyCoverage } from '../../../../src/features/extraction/runRepository';
import { loadTiabHandoff } from '../../../../src/features/project/tiabHandoffStore';
import { ensureChildFolder, listFolderPdfs } from '../../../../src/lib/google/drive';
import { getCurrentUserEmail } from '../../../../src/lib/google/identity';
import { FOLDER_MIME_TYPE, openPdfPicker } from '../../../../src/lib/google/picker';
import { getLocal, setLocal } from '../../../../src/lib/storage/chromeStorage';

// dedupSelections は関数だけモックし、DUPLICATE_REASON_LABELS（表示文言）は本物を使う
jest.mock('../../../../src/features/documents/dedupSelections', () => {
  const actual = jest.requireActual('../../../../src/features/documents/dedupSelections');
  return { __esModule: true, ...actual, dedupSelections: jest.fn() };
});
jest.mock('../../../../src/features/documents/documentRepository');
jest.mock('../../../../src/features/documents/importDocuments');
jest.mock('../../../../src/features/documents/studyRepository', () => {
  const actual = jest.requireActual('../../../../src/features/documents/studyRepository');
  return {
    __esModule: true,
    ...actual,
    readStudies: jest.fn(),
    appendStudies: jest.fn(),
    updateStudy: jest.fn(),
  };
});
jest.mock('../../../../src/features/extraction/runRepository');
jest.mock('../../../../src/features/project/tiabHandoffStore');
jest.mock('../../../../src/lib/google/drive');
jest.mock('../../../../src/lib/google/identity');
jest.mock('../../../../src/lib/google/picker');
jest.mock('../../../../src/lib/storage/chromeStorage');

const mockDedupSelections = jest.mocked(dedupSelections);
const mockReadDocuments = jest.mocked(readDocuments);
const mockUpdateDocument = jest.mocked(updateDocument);
const mockImportDocuments = jest.mocked(importDocuments);
const mockReadStudies = jest.mocked(readStudies);
const mockAppendStudies = jest.mocked(appendStudies);
const mockUpdateStudy = jest.mocked(updateStudy);
const mockReadCoverage = jest.mocked(readRunStudyCoverage);
const mockLoadTiabHandoff = jest.mocked(loadTiabHandoff);
const mockEnsureChildFolder = jest.mocked(ensureChildFolder);
const mockListFolderPdfs = jest.mocked(listFolderPdfs);
const mockGetCurrentUserEmail = jest.mocked(getCurrentUserEmail);
const mockOpenPdfPicker = jest.mocked(openPdfPicker);
const mockGetLocal = jest.mocked(getLocal);
const mockSetLocal = jest.mocked(setLocal);

function makeDoc(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    documentId: 'doc-1',
    studyId: 'study-1',
    documentRole: 'article',
    driveFileId: 'drive-1',
    sourceFileId: 'src-1',
    filename: 'smith2020.pdf',
    pmid: null,
    doi: null,
    textRef: 'https://drive.google.com/file/d/txt-1/view',
    textStatus: 'ok',
    pageCount: 10,
    charCount: 20000,
    importedAt: '2026-07-02T00:00:00Z',
    importedBy: 'tester@example.com',
    note: null,
    ...overrides,
  };
}

function makeStudy(overrides: Partial<StudyRecord> = {}): StudyRecord {
  return {
    studyId: 'study-1',
    studyLabel: 'Smith 2020',
    registrationId: null,
    createdAt: 't1',
    createdBy: 'tester@example.com',
    note: null,
    ...overrides,
  };
}

function makeDeps(): DocumentsServiceDeps {
  return {
    google: { fetch: jest.fn(), getAccessToken: jest.fn(async () => 't') },
    profile: { getProfileUserInfo: jest.fn() },
    picker: {
      getAccessToken: jest.fn(),
      extensionId: 'ext',
      pickerPageUrl: 'https://example.com/p.html',
      createTab: jest.fn(),
      removeTab: jest.fn(),
      addExternalMessageListener: jest.fn(),
      addTabRemovedListener: jest.fn(),
    },
    loadPdf: jest.fn(),
    newUuid: () => 'study-new',
    now: () => 'NOW',
  };
}

function makeStore(withProject = true): Store {
  const initial = createInitialState();
  if (withProject) {
    initial.currentProject = {
      projectId: 'p1',
      spreadsheetId: 'sheet-1',
      driveFolderId: 'folder-1',
      name: 'テスト SR',
    };
  }
  return createStore(initial);
}

function setDocs(store: Store, patch: Partial<ReturnType<Store['getState']>['documents']>): void {
  store.setState({ documents: { ...store.getState().documents, ...patch } });
}

function toastTexts(): string[] {
  return Array.from(document.querySelectorAll('.toast')).map((node) => node.textContent ?? '');
}

beforeEach(() => {
  jest.clearAllMocks();
  document.body.innerHTML = '';
  mockGetCurrentUserEmail.mockResolvedValue('tester@example.com');
  // 既定は素通し（重複なし）。重複スキップのシナリオは各テストで差し替える
  mockDedupSelections.mockImplementation(async ({ selections }) => ({
    accepted: [...selections],
    skipped: [],
  }));
  // records 未読込の取り込みは readDocuments で既存一覧を読むため既定を空にする
  // （clearAllMocks は実装を消さないので、前のテストの mockRejectedValue を残さない）
  mockReadDocuments.mockResolvedValue([]);
  mockEnsureChildFolder.mockImplementation(async (name) => ({
    id: `${name}-folder-id`,
    webViewLink: `https://drive.google.com/${name}`,
  }));
  mockReadCoverage.mockResolvedValue({
    extracted: new Set(),
    interrupted: new Set(),
    latestCompletedRunByStudy: new Map(),
  });
  mockGetLocal.mockResolvedValue(undefined);
  mockSetLocal.mockResolvedValue(undefined);
  mockLoadTiabHandoff.mockResolvedValue(null);
});

describe('loadDocuments', () => {
  test('プロジェクト未選択 / 読込中は no-op、records ありは force のみ', async () => {
    await loadDocuments(makeStore(false), makeDeps());
    expect(mockReadDocuments).not.toHaveBeenCalled();

    const loadingStore = makeStore();
    setDocs(loadingStore, { loading: true });
    await loadDocuments(loadingStore, makeDeps());
    expect(mockReadDocuments).not.toHaveBeenCalled();

    const store = makeStore();
    setDocs(store, { records: [] });
    await loadDocuments(store, makeDeps());
    expect(mockReadDocuments).not.toHaveBeenCalled();
  });

  test('成功で documents / studies / extractedStudyIds / ignoredCandidateKeys を読み込む', async () => {
    const store = makeStore();
    mockReadDocuments.mockResolvedValue([makeDoc(), makeDoc({ documentId: 'doc-2', studyId: 'study-2' })]);
    mockReadStudies.mockResolvedValue([makeStudy(), makeStudy({ studyId: 'study-2' })]);
    mockReadCoverage.mockResolvedValue({
      extracted: new Set(['study-1']),
      interrupted: new Set(),
      latestCompletedRunByStudy: new Map(),
    });
    mockGetLocal.mockResolvedValue(['a|b']);

    await loadDocuments(store, makeDeps());

    const state = store.getState();
    expect(state.documents.records).toHaveLength(2);
    expect(state.documents.studies).toHaveLength(2);
    expect(state.documents.extractedStudyIds).toEqual(['study-1']);
    expect(state.documents.ignoredCandidateKeys).toEqual(['a|b']);
    expect(state.counts.documents).toBe(2);
    expect(mockGetLocal).toHaveBeenCalledWith(ignoredCandidatesKey('sheet-1'));
  });

  test('無視候補が未保存なら空配列で初期化する', async () => {
    const store = makeStore();
    mockReadDocuments.mockResolvedValue([]);
    mockReadStudies.mockResolvedValue([]);
    await loadDocuments(store, makeDeps());
    expect(store.getState().documents.ignoredCandidateKeys).toEqual([]);
  });

  test('失敗で loadError（Error 以外の throw も文字列化）', async () => {
    const store = makeStore();
    mockReadDocuments.mockRejectedValue(new Error('boom'));
    await loadDocuments(store, makeDeps());
    expect(store.getState().documents.loadError).toBe('boom');

    mockReadDocuments.mockRejectedValue('str');
    await loadDocuments(store, makeDeps(), { force: true });
    expect(store.getState().documents.loadError).toBe('str');
  });

  // tiab-review 引き継ぎパネル（ui-states.md §3 / ※Q2）: storage の tiabHandoff との同期
  test('tiabHandoff: storage の projectId が一致すれば running / error を維持したまま反映する（取り込み完了後の force 再読込で消えない）', async () => {
    const store = makeStore();
    setDocs(store, {
      records: [],
      studies: [],
      tiabHandoff: { tiabSheetId: 'old-sheet-id', running: true, error: '前回のエラー' },
    });
    mockReadDocuments.mockResolvedValue([]);
    mockReadStudies.mockResolvedValue([]);
    mockLoadTiabHandoff.mockResolvedValue({ projectId: 'p1', tiabSheetId: 'tiab-sheet-xyz' });

    await loadDocuments(store, makeDeps(), { force: true });

    expect(store.getState().documents.tiabHandoff).toEqual({
      tiabSheetId: 'tiab-sheet-xyz',
      running: true,
      error: '前回のエラー',
    });
  });

  test('tiabHandoff: 直前状態が無い初回読込は running=false / error=null で初期化する', async () => {
    const store = makeStore();
    mockReadDocuments.mockResolvedValue([]);
    mockReadStudies.mockResolvedValue([]);
    mockLoadTiabHandoff.mockResolvedValue({ projectId: 'p1', tiabSheetId: 'tiab-sheet-xyz' });

    await loadDocuments(store, makeDeps());

    expect(store.getState().documents.tiabHandoff).toEqual({
      tiabSheetId: 'tiab-sheet-xyz',
      running: false,
      error: null,
    });
  });

  test('tiabHandoff: storage が別プロジェクトを指すなら非表示（null）にする', async () => {
    const store = makeStore();
    setDocs(store, {
      records: [],
      studies: [],
      tiabHandoff: { tiabSheetId: 'old-sheet-id', running: false, error: null },
    });
    mockReadDocuments.mockResolvedValue([]);
    mockReadStudies.mockResolvedValue([]);
    mockLoadTiabHandoff.mockResolvedValue({ projectId: 'other-project', tiabSheetId: 'tiab-sheet-xyz' });

    await loadDocuments(store, makeDeps(), { force: true });

    expect(store.getState().documents.tiabHandoff).toBeNull();
  });

  test('tiabHandoff: storage が空（未保存）なら非表示（null）にする', async () => {
    const store = makeStore();
    mockReadDocuments.mockResolvedValue([]);
    mockReadStudies.mockResolvedValue([]);
    mockLoadTiabHandoff.mockResolvedValue(null);

    await loadDocuments(store, makeDeps());

    expect(store.getState().documents.tiabHandoff).toBeNull();
  });
});

describe('importPickedSelections（Picker 確定後の共通取り込み処理。tiab-review 引き継ぎパネルからも再利用）', () => {
  test('プロジェクト未選択 / 取り込み中 / 選択 0 件は no-op', async () => {
    await importPickedSelections(makeStore(false), makeDeps(), [{ sourceFileId: 'src-1', filename: 'a.pdf' }]);
    expect(mockEnsureChildFolder).not.toHaveBeenCalled();

    const importingStore = makeStore();
    setDocs(importingStore, { importing: true });
    await importPickedSelections(importingStore, makeDeps(), [{ sourceFileId: 'src-1', filename: 'a.pdf' }]);
    expect(mockEnsureChildFolder).not.toHaveBeenCalled();

    const store = makeStore();
    await importPickedSelections(store, makeDeps(), []);
    expect(mockEnsureChildFolder).not.toHaveBeenCalled();
    expect(store.getState().documents.importing).toBe(false);
  });

  test('選択を取り込みパイプラインへ渡す（importFromPicker と同じ挙動）', async () => {
    const store = makeStore();
    mockImportDocuments.mockResolvedValue({
      importedStudies: [makeStudy({ studyId: 'study-1' })],
      imported: [makeDoc({ documentId: 'doc-1', studyId: 'study-1' })],
      failures: [],
    });

    await importPickedSelections(store, makeDeps(), [{ sourceFileId: 'src-1', filename: 'a.pdf' }]);

    expect(store.getState().documents.records?.map((d) => d.documentId)).toEqual(['doc-1']);
    expect(toastTexts()).toContain('1 件の PDF を取り込みました');
  });
});

describe('importFromPicker', () => {
  test('プロジェクト未選択 / 取り込み中は Picker を開かない', async () => {
    await importFromPicker(makeStore(false), makeDeps());
    const store = makeStore();
    setDocs(store, { importing: true });
    await importFromPicker(store, makeDeps());
    expect(mockOpenPdfPicker).not.toHaveBeenCalled();
  });

  test('Picker 起動失敗はトースト案内 / キャンセル・空は no-op', async () => {
    mockOpenPdfPicker.mockRejectedValue(new Error('no token'));
    await importFromPicker(makeStore(), makeDeps());
    expect(toastTexts()).toContain('Drive Picker を開けませんでした: no token');

    mockOpenPdfPicker.mockResolvedValue(null);
    await importFromPicker(makeStore(), makeDeps());
    mockOpenPdfPicker.mockResolvedValue([]);
    await importFromPicker(makeStore(), makeDeps());
    expect(mockEnsureChildFolder).not.toHaveBeenCalled();
  });

  test('取り込み成功で records / studies を追加し done トースト', async () => {
    const store = makeStore();
    setDocs(store, { records: [makeDoc({ documentId: 'doc-0', studyId: 'study-0' })], studies: [makeStudy({ studyId: 'study-0' })] });
    store.setState({ counts: { ...store.getState().counts, documents: 1 } });
    mockOpenPdfPicker.mockResolvedValue([{ sourceFileId: 'src-1', filename: 'a.pdf' }]);
    mockImportDocuments.mockImplementation(async (_params, deps) => {
      deps.onProgress?.({ key: 'src-1', fileIndex: 0, totalFiles: 1, filename: 'a.pdf', stage: 'copy' });
      return {
        importedStudies: [makeStudy({ studyId: 'study-1' })],
        imported: [makeDoc({ documentId: 'doc-1', studyId: 'study-1' })],
        failures: [],
      };
    });

    await importFromPicker(store, makeDeps());

    const state = store.getState();
    expect(state.documents.records?.map((d) => d.documentId)).toEqual(['doc-0', 'doc-1']);
    expect(state.documents.studies?.map((s) => s.studyId)).toEqual(['study-0', 'study-1']);
    expect(state.counts.documents).toBe(2);
    expect(toastTexts()).toContain('1 件の PDF を取り込みました');
  });

  test('部分失敗のトーストと failed 進捗行（records/studies 未読込でも成立）', async () => {
    const store = makeStore();
    mockGetCurrentUserEmail.mockResolvedValue(null);
    mockOpenPdfPicker.mockResolvedValue([
      { sourceFileId: 'src-1', filename: 'a.pdf' },
      { sourceFileId: 'src-2', filename: 'b.pdf' },
    ]);
    mockImportDocuments.mockImplementation(async (_params, deps) => {
      // key='src-1' の進捗通知で、2 行のうち 1 行目のみ差し替え（他行は据え置きの分岐）
      deps.onProgress?.({ key: 'src-1', fileIndex: 0, totalFiles: 2, filename: 'a.pdf', stage: 'copy' });
      return {
        importedStudies: [makeStudy({ studyId: 'study-1' })],
        imported: [makeDoc({ documentId: 'doc-1', studyId: 'study-1' })],
        failures: [{ key: 'src-2', filename: 'b.pdf', stage: 'extract', detail: 'parse' }],
      };
    });

    await importFromPicker(store, makeDeps());

    const rows = store.getState().documents.importRows;
    expect(rows[0]?.status).toBe('done');
    expect(rows[1]).toMatchObject({ status: 'failed', detail: 'テキスト抽出に失敗: parse' });
    expect(toastTexts()).toContain('1 件取り込み、1 件失敗しました');
  });

  test('フォルダ解決失敗で全行 failed + トースト', async () => {
    const store = makeStore();
    mockOpenPdfPicker.mockResolvedValue([{ sourceFileId: 'src-1', filename: 'a.pdf' }]);
    mockEnsureChildFolder.mockRejectedValue(new Error('drive down'));
    await importFromPicker(store, makeDeps());
    expect(store.getState().documents.importRows[0]?.status).toBe('failed');
    expect(toastTexts()).toContain('取り込みに失敗しました: drive down');
  });

  test('フォルダ選択は直下 PDF を列挙して展開し「展開中」トーストを出す', async () => {
    const store = makeStore();
    mockOpenPdfPicker.mockResolvedValue([
      { sourceFileId: 'folder-1', filename: 'fulltext', mimeType: FOLDER_MIME_TYPE },
    ]);
    mockListFolderPdfs.mockResolvedValue([
      { id: 'src-1', name: 'a.pdf' },
      { id: 'src-2', name: 'b.pdf' },
    ]);
    mockImportDocuments.mockResolvedValue({ importedStudies: [], imported: [], failures: [] });

    await importFromPicker(store, makeDeps());

    expect(mockListFolderPdfs).toHaveBeenCalledWith('folder-1', expect.anything());
    expect(mockImportDocuments.mock.calls[0]?.[0].selections).toEqual([
      { key: 'src-1', filename: 'a.pdf', sourceFileId: 'src-1', source: { kind: 'drive', fileId: 'src-1' } },
      { key: 'src-2', filename: 'b.pdf', sourceFileId: 'src-2', source: { kind: 'drive', fileId: 'src-2' } },
    ]);
    expect(toastTexts()).toContain('フォルダを展開中…');
  });

  test('ファイルとフォルダ混在は結合し key（= sourceFileId）で重複排除する', async () => {
    const store = makeStore();
    mockOpenPdfPicker.mockResolvedValue([
      { sourceFileId: 'src-1', filename: 'a.pdf', mimeType: 'application/pdf' },
      { sourceFileId: 'folder-1', filename: 'fulltext', mimeType: FOLDER_MIME_TYPE },
    ]);
    // フォルダ内に個別選択と同じ src-1 が含まれる → 1 回だけ取り込む
    mockListFolderPdfs.mockResolvedValue([
      { id: 'src-1', name: 'a.pdf' },
      { id: 'src-3', name: 'c.pdf' },
    ]);
    mockImportDocuments.mockResolvedValue({ importedStudies: [], imported: [], failures: [] });

    await importFromPicker(store, makeDeps());

    expect(mockImportDocuments.mock.calls[0]?.[0].selections).toEqual([
      { key: 'src-1', filename: 'a.pdf', sourceFileId: 'src-1', source: { kind: 'drive', fileId: 'src-1' } },
      { key: 'src-3', filename: 'c.pdf', sourceFileId: 'src-3', source: { kind: 'drive', fileId: 'src-3' } },
    ]);
  });

  test('PDF なしフォルダはトースト案内して取り込まない（importing を戻す）', async () => {
    const store = makeStore();
    mockOpenPdfPicker.mockResolvedValue([
      { sourceFileId: 'folder-1', filename: 'empty', mimeType: FOLDER_MIME_TYPE },
    ]);
    mockListFolderPdfs.mockResolvedValue([]);

    await importFromPicker(store, makeDeps());

    expect(mockImportDocuments).not.toHaveBeenCalled();
    expect(store.getState().documents.importing).toBe(false);
    expect(toastTexts()).toContain('選択したフォルダに PDF が見つかりませんでした');
  });

  test('フォルダ列挙失敗はトースト案内して中断する', async () => {
    const store = makeStore();
    mockOpenPdfPicker.mockResolvedValue([
      { sourceFileId: 'folder-1', filename: 'fulltext', mimeType: FOLDER_MIME_TYPE },
    ]);
    mockListFolderPdfs.mockRejectedValue(new Error('list failed'));

    await importFromPicker(store, makeDeps());

    expect(mockImportDocuments).not.toHaveBeenCalled();
    expect(store.getState().documents.importing).toBe(false);
    expect(toastTexts()).toContain('フォルダの読み込みに失敗しました: list failed');
  });
});

describe('重複スキップ（issue #102）', () => {
  test('スキップと取り込みの混在: スキップ行を理由付きで表示し、accepted だけ importDocuments へ渡す', async () => {
    const store = makeStore();
    setDocs(store, { records: [makeDoc()], studies: [makeStudy()] });
    mockOpenPdfPicker.mockResolvedValue([
      { sourceFileId: 'src-1', filename: 'a.pdf' },
      { sourceFileId: 'src-2', filename: 'b.pdf' },
    ]);
    mockDedupSelections.mockResolvedValue({
      accepted: [
        {
          key: 'src-2',
          filename: 'b.pdf',
          sourceFileId: 'src-2',
          source: { kind: 'drive', fileId: 'src-2' },
        },
      ],
      skipped: [{ key: 'src-1', filename: 'a.pdf', reason: 'same_source' }],
    });
    mockImportDocuments.mockResolvedValue({
      importedStudies: [makeStudy({ studyId: 'study-2' })],
      imported: [makeDoc({ documentId: 'doc-2', studyId: 'study-2', sourceFileId: 'src-2' })],
      failures: [],
    });

    await importFromPicker(store, makeDeps());

    // 判定には既存一覧と documents/ フォルダ ID を渡す
    expect(mockDedupSelections).toHaveBeenCalledWith(
      expect.objectContaining({
        existingDocuments: [makeDoc()],
        documentsFolderId: 'documents-folder-id',
      }),
      expect.anything(),
    );
    expect(mockImportDocuments.mock.calls[0]?.[0].selections.map((s) => s.key)).toEqual([
      'src-2',
    ]);
    const rows = store.getState().documents.importRows;
    expect(rows[0]).toMatchObject({ status: 'skipped', detail: '取り込み済みのためスキップ' });
    expect(rows[1]?.status).toBe('done');
    expect(toastTexts()).toContain('1 件取り込み、1 件スキップしました');
  });

  test('全件スキップは importDocuments を呼ばず専用トースト（same_content の文言も検証）', async () => {
    const store = makeStore();
    setDocs(store, { records: [makeDoc()], studies: [makeStudy()] });
    mockOpenPdfPicker.mockResolvedValue([
      { sourceFileId: 'src-2', filename: 'a.pdf' },
      { sourceFileId: 'src-3', filename: 'b.pdf' },
    ]);
    mockDedupSelections.mockResolvedValue({
      accepted: [],
      skipped: [
        { key: 'src-2', filename: 'a.pdf', reason: 'same_source' },
        { key: 'src-3', filename: 'b.pdf', reason: 'same_content' },
      ],
    });

    await importFromPicker(store, makeDeps());

    expect(mockImportDocuments).not.toHaveBeenCalled();
    const rows = store.getState().documents.importRows;
    expect(rows[0]).toMatchObject({ status: 'skipped', detail: '取り込み済みのためスキップ' });
    expect(rows[1]).toMatchObject({
      status: 'skipped',
      detail: '内容が同一の PDF が取り込み済みのためスキップ',
    });
    expect(store.getState().documents.importing).toBe(false);
    expect(toastTexts()).toContain('取り込み済みのため 2 件をスキップしました');
    // 既存レコードは変更しない（新規発生の防止のみ）
    expect(store.getState().documents.records).toHaveLength(1);
  });

  test('スキップ + 失敗の混在トースト（ローカル経路でも key で突き合わせる）', async () => {
    const store = makeStore();
    setDocs(store, { records: [], studies: [] });
    mockDedupSelections.mockImplementation(async ({ selections }) => ({
      accepted: selections.filter((s) => s.key !== 'local:dup.pdf:10'),
      skipped: [{ key: 'local:dup.pdf:10', filename: 'dup.pdf', reason: 'same_content' }],
    }));
    mockImportDocuments.mockResolvedValue({
      importedStudies: [makeStudy({ studyId: 'study-1' })],
      imported: [makeDoc({ sourceFileId: null })],
      failures: [{ key: 'local:c.pdf:10', filename: 'c.pdf', stage: 'copy', detail: 'quota' }],
    });

    await importFromFiles(store, makeDeps(), [
      makeFakeFile('dup.pdf', 10),
      makeFakeFile('b.pdf', 10),
      makeFakeFile('c.pdf', 10),
    ]);

    const rows = store.getState().documents.importRows;
    expect(rows.map((r) => r.status)).toEqual(['skipped', 'done', 'failed']);
    expect(toastTexts()).toContain('1 件取り込み、1 件スキップ、1 件失敗しました');
  });

  test('records 未読込なら readDocuments で既存一覧を読んでから判定する', async () => {
    const store = makeStore();
    mockOpenPdfPicker.mockResolvedValue([{ sourceFileId: 'src-9', filename: 'z.pdf' }]);
    mockReadDocuments.mockResolvedValue([makeDoc()]);
    mockImportDocuments.mockResolvedValue({ importedStudies: [], imported: [], failures: [] });

    await importFromPicker(store, makeDeps());

    expect(mockReadDocuments).toHaveBeenCalledWith('sheet-1', expect.anything());
    expect(mockDedupSelections).toHaveBeenCalledWith(
      expect.objectContaining({ existingDocuments: [makeDoc()] }),
      expect.anything(),
    );
  });

  test('重複判定の失敗は取り込み全体を中断する（フェイルクローズ）', async () => {
    const store = makeStore();
    setDocs(store, { records: [], studies: [] });
    mockOpenPdfPicker.mockResolvedValue([{ sourceFileId: 'src-1', filename: 'a.pdf' }]);
    mockDedupSelections.mockRejectedValue(new Error('md5 fetch down'));

    await importFromPicker(store, makeDeps());

    expect(mockImportDocuments).not.toHaveBeenCalled();
    expect(store.getState().documents.importRows[0]).toMatchObject({
      status: 'failed',
      detail: 'md5 fetch down',
    });
    expect(toastTexts()).toContain('取り込みに失敗しました: md5 fetch down');
  });
});

/** jsdom の File には arrayBuffer() が無いため補って生成する（protocolView.test.ts と同じ手法） */
function makeFakeFile(name: string, size: number, type = 'application/pdf'): File {
  const file = new File([new Uint8Array(size)], name, { type });
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new ArrayBuffer(size) });
  return file;
}

describe('importFromFiles', () => {
  test('プロジェクト未選択 / 取り込み中は importDocuments を呼ばない', async () => {
    await importFromFiles(makeStore(false), makeDeps(), [makeFakeFile('a.pdf', 10)]);
    expect(mockImportDocuments).not.toHaveBeenCalled();

    const store = makeStore();
    setDocs(store, { importing: true });
    await importFromFiles(store, makeDeps(), [makeFakeFile('a.pdf', 10)]);
    expect(mockImportDocuments).not.toHaveBeenCalled();
  });

  test('PDF 以外を除外してトースト、残りは source.kind=local で取り込む', async () => {
    const store = makeStore();
    mockImportDocuments.mockResolvedValue({ importedStudies: [], imported: [], failures: [] });
    const pdf = makeFakeFile('a.pdf', 10);
    const txt = makeFakeFile('notes.txt', 5, 'text/plain');

    await importFromFiles(store, makeDeps(), [pdf, txt]);

    expect(mockImportDocuments).toHaveBeenCalledTimes(1);
    const selections = mockImportDocuments.mock.calls[0]?.[0].selections;
    expect(selections).toEqual([
      {
        key: 'local:a.pdf:10',
        filename: 'a.pdf',
        sourceFileId: null,
        source: { kind: 'local', data: expect.any(ArrayBuffer) },
      },
    ]);
    expect(toastTexts()).toContain('PDF 以外の 1 件を除外しました');
  });

  test('MIME 未設定でも .pdf 拡張子なら PDF 扱いする', async () => {
    const store = makeStore();
    mockImportDocuments.mockResolvedValue({ importedStudies: [], imported: [], failures: [] });
    await importFromFiles(store, makeDeps(), [makeFakeFile('scan.pdf', 10, '')]);
    expect(mockImportDocuments).toHaveBeenCalledTimes(1);
  });

  test('filename + size が同一のファイルはバッチ内で重複排除する（サイズ違いは別物）', async () => {
    const store = makeStore();
    mockImportDocuments.mockResolvedValue({ importedStudies: [], imported: [], failures: [] });
    const a = makeFakeFile('a.pdf', 10);
    const aDup = makeFakeFile('a.pdf', 10);
    const aOtherSize = makeFakeFile('a.pdf', 20);

    await importFromFiles(store, makeDeps(), [a, aDup, aOtherSize]);

    const selections = mockImportDocuments.mock.calls[0]?.[0]?.selections ?? [];
    expect(selections.map((s) => s.key)).toEqual(['local:a.pdf:10', 'local:a.pdf:20']);
  });

  test('PDF が 0 件なら取り込まずトースト案内する（importing は立たない）', async () => {
    const store = makeStore();
    await importFromFiles(store, makeDeps(), [makeFakeFile('notes.txt', 5, 'text/plain')]);
    expect(mockImportDocuments).not.toHaveBeenCalled();
    expect(store.getState().documents.importing).toBe(false);
    expect(toastTexts()).toContain('PDF ファイルが選択されていません');
  });

  test('files が空配列（除外なし）なら 0 件案内トーストも出さない', async () => {
    const store = makeStore();
    await importFromFiles(store, makeDeps(), []);
    expect(mockImportDocuments).not.toHaveBeenCalled();
    expect(toastTexts()).toHaveLength(0);
  });

  test('成功で records / studies を追加し done トースト', async () => {
    const store = makeStore();
    mockImportDocuments.mockImplementation(async (_params, deps) => {
      deps.onProgress?.({ key: 'local:a.pdf:10', fileIndex: 0, totalFiles: 1, filename: 'a.pdf', stage: 'copy' });
      return {
        importedStudies: [makeStudy({ studyId: 'study-1' })],
        imported: [makeDoc({ documentId: 'doc-1', studyId: 'study-1', sourceFileId: null })],
        failures: [],
      };
    });

    await importFromFiles(store, makeDeps(), [makeFakeFile('a.pdf', 10)]);

    const state = store.getState();
    expect(state.documents.records?.map((d) => d.documentId)).toEqual(['doc-1']);
    expect(state.documents.studies?.map((s) => s.studyId)).toEqual(['study-1']);
    expect(toastTexts()).toContain('1 件の PDF を取り込みました');
  });

  test('失敗混在は key 突き合わせで failed 進捗行になる', async () => {
    const store = makeStore();
    mockImportDocuments.mockResolvedValue({
      importedStudies: [],
      imported: [],
      failures: [{ key: 'local:a.pdf:10', filename: 'a.pdf', stage: 'copy', detail: 'quota' }],
    });

    await importFromFiles(store, makeDeps(), [makeFakeFile('a.pdf', 10)]);

    const rows = store.getState().documents.importRows;
    expect(rows[0]).toMatchObject({ status: 'failed', detail: 'コピーに失敗: quota' });
  });
});

describe('saveStudyLabel / saveRegistrationId', () => {
  function withStudies(): Store {
    const store = makeStore();
    // 2 件にして map の「非対象行は据え置き」分岐も通す
    setDocs(store, {
      studies: [makeStudy(), makeStudy({ studyId: 'study-2', studyLabel: 'Jones 2021' })],
      records: [makeDoc()],
    });
    return store;
  }

  test('未選択 / 対象なしは no-op', async () => {
    await saveStudyLabel(makeStore(false), makeDeps(), 'study-1', 'X');
    await saveStudyLabel(makeStore(), makeDeps(), 'unknown', 'X');
    expect(mockUpdateStudy).not.toHaveBeenCalled();
  });

  test('空文字は保存せず案内し再描画で戻す', async () => {
    const store = withStudies();
    const listener = jest.fn();
    store.subscribe(listener);
    await saveStudyLabel(store, makeDeps(), 'study-1', '   ');
    expect(mockUpdateStudy).not.toHaveBeenCalled();
    expect(toastTexts()).toContain('study_label は空にできません');
    expect(listener).toHaveBeenCalled();
  });

  test('変更なしは再描画のみ', async () => {
    const store = withStudies();
    await saveStudyLabel(store, makeDeps(), 'study-1', '  Smith 2020  ');
    expect(mockUpdateStudy).not.toHaveBeenCalled();
    expect(toastTexts()).toHaveLength(0);
  });

  test('成功で Studies を上書きしトースト', async () => {
    const store = withStudies();
    mockUpdateStudy.mockResolvedValue(undefined);
    await saveStudyLabel(store, makeDeps(), 'study-1', ' Smith 2020a ');
    expect(mockUpdateStudy).toHaveBeenCalledWith(
      'sheet-1',
      expect.objectContaining({ studyId: 'study-1', studyLabel: 'Smith 2020a' }),
      expect.anything(),
    );
    expect(store.getState().documents.studies?.[0]?.studyLabel).toBe('Smith 2020a');
    expect(toastTexts()).toContain('study_label を保存しました');
  });

  test('失敗でトースト + 再描画（元の値のまま）', async () => {
    const store = withStudies();
    mockUpdateStudy.mockRejectedValue(new Error('offline'));
    await saveStudyLabel(store, makeDeps(), 'study-1', 'New');
    expect(toastTexts()).toContain('study_label の保存に失敗しました: offline');
    expect(store.getState().documents.studies?.[0]?.studyLabel).toBe('Smith 2020');
  });

  test('registration_id: 未選択 no-op / 変更なし / 空は null 解除 / 成功', async () => {
    await saveRegistrationId(makeStore(false), makeDeps(), 'study-1', 'X');

    const same = withStudies(); // registrationId null
    await saveRegistrationId(same, makeDeps(), 'study-1', '  ');
    expect(mockUpdateStudy).not.toHaveBeenCalled();

    const store = withStudies();
    mockUpdateStudy.mockResolvedValue(undefined);
    await saveRegistrationId(store, makeDeps(), 'study-1', ' NCT01234567 ');
    expect(mockUpdateStudy).toHaveBeenCalledWith(
      'sheet-1',
      expect.objectContaining({ registrationId: 'NCT01234567' }),
      expect.anything(),
    );
    expect(store.getState().documents.studies?.[0]?.registrationId).toBe('NCT01234567');
  });
});

describe('saveDocumentRole', () => {
  function withDocs(): Store {
    const store = makeStore();
    setDocs(store, {
      records: [makeDoc(), makeDoc({ documentId: 'doc-2', studyId: 'study-2' })],
      studies: [makeStudy()],
    });
    return store;
  }

  test('未選択 / 対象なし / 同一 role は no-op（再描画のみ）', async () => {
    await saveDocumentRole(makeStore(false), makeDeps(), 'doc-1', 'protocol');
    const store = withDocs();
    await saveDocumentRole(store, makeDeps(), 'doc-1', 'article'); // 同一
    expect(mockUpdateDocument).not.toHaveBeenCalled();
  });

  test('成功で Documents を上書き', async () => {
    const store = withDocs();
    mockUpdateDocument.mockResolvedValue(undefined);
    await saveDocumentRole(store, makeDeps(), 'doc-1', 'registration');
    expect(mockUpdateDocument).toHaveBeenCalledWith(
      'sheet-1',
      expect.objectContaining({ documentId: 'doc-1', documentRole: 'registration' }),
      expect.anything(),
    );
    expect(store.getState().documents.records?.[0]?.documentRole).toBe('registration');
    expect(toastTexts()).toContain('document_role を保存しました');
  });

  test('失敗でトースト + 再描画', async () => {
    const store = withDocs();
    mockUpdateDocument.mockRejectedValue(new Error('nope'));
    await saveDocumentRole(store, makeDeps(), 'doc-1', 'abstract');
    expect(toastTexts()).toContain('document_role の保存に失敗しました: nope');
    expect(store.getState().documents.records?.[0]?.documentRole).toBe('article');
  });
});

describe('toggleStudySelection', () => {
  test('追加 / 重複追加は無視 / 解除', () => {
    const store = makeStore();
    toggleStudySelection(store, 'study-1', true);
    toggleStudySelection(store, 'study-1', true); // 重複
    expect(store.getState().documents.selectedStudyIds).toEqual(['study-1']);
    toggleStudySelection(store, 'study-1', false);
    expect(store.getState().documents.selectedStudyIds).toEqual([]);
  });
});

describe('merge dialog', () => {
  function withTwoStudies(extracted: string[] = []): Store {
    const store = makeStore();
    setDocs(store, {
      studies: [
        makeStudy({ studyId: 'study-1', studyLabel: 'Smith 2020', registrationId: 'NCT01234567' }),
        makeStudy({ studyId: 'study-2', studyLabel: 'Smith 2020 reg' }),
      ],
      records: [makeDoc({ studyId: 'study-1' }), makeDoc({ documentId: 'doc-2', studyId: 'study-2' })],
      extractedStudyIds: extracted,
    });
    return store;
  }

  test('選択 2 件未満はトーストのみ', () => {
    const store = withTwoStudies();
    setDocs(store, { selectedStudyIds: ['study-1'] });
    openMergeDialog(store);
    expect(store.getState().documents.mergeDialog).toBeNull();
    expect(toastTexts()).toContain('統合するには 2 件以上の試験を選択してください');
  });

  test('studies 未読込（null）で選択があってもダイアログは開かない', () => {
    const store = makeStore();
    setDocs(store, { studies: null, selectedStudyIds: ['study-1', 'study-2'] });
    openMergeDialog(store);
    expect(store.getState().documents.mergeDialog).toBeNull();
  });

  test('選択 2 件で既定値を埋めたダイアログを開く（抽出済みは警告フラグ）', () => {
    const store = withTwoStudies(['study-1']);
    setDocs(store, { selectedStudyIds: ['study-2', 'study-1'] });
    openMergeDialog(store);
    const dialog = store.getState().documents.mergeDialog;
    expect(dialog).toEqual({
      studyIds: ['study-1', 'study-2'],
      label: 'Smith 2020',
      registrationId: 'NCT01234567',
      hasExtractedData: true,
    });
  });

  test('候補バナー経由でも開ける（registration_id null は空文字に）', () => {
    const store = withTwoStudies();
    // study-1 の registration を消して null→'' 分岐を通す
    setDocs(store, {
      studies: [makeStudy({ studyId: 'study-1' }), makeStudy({ studyId: 'study-2' })],
    });
    openMergeCandidate(store, ['study-1', 'study-2']);
    expect(store.getState().documents.mergeDialog?.registrationId).toBe('');
    expect(store.getState().documents.mergeDialog?.hasExtractedData).toBe(false);
  });

  test('updateMergeDialog は dialog が無ければ no-op / あれば patch', () => {
    const store = withTwoStudies();
    updateMergeDialog(store, { label: 'X' });
    expect(store.getState().documents.mergeDialog).toBeNull();
    setDocs(store, { selectedStudyIds: ['study-1', 'study-2'] });
    openMergeDialog(store);
    updateMergeDialog(store, { label: '統合ラベル' });
    expect(store.getState().documents.mergeDialog?.label).toBe('統合ラベル');
  });

  test('cancelMerge で閉じる', () => {
    const store = withTwoStudies();
    setDocs(store, { selectedStudyIds: ['study-1', 'study-2'] });
    openMergeDialog(store);
    cancelMerge(store);
    expect(store.getState().documents.mergeDialog).toBeNull();
  });
});

describe('confirmMerge', () => {
  function ready(): Store {
    const store = makeStore();
    setDocs(store, {
      studies: [makeStudy({ studyId: 'study-1' }), makeStudy({ studyId: 'study-2' })],
      records: [makeDoc({ documentId: 'doc-1', studyId: 'study-1' }), makeDoc({ documentId: 'doc-2', studyId: 'study-2' })],
      mergeDialog: {
        studyIds: ['study-1', 'study-2'],
        label: '統合後',
        registrationId: 'NCT01234567',
        hasExtractedData: false,
      },
    });
    return store;
  }

  test('未選択 / dialog なし / merging 中は no-op', async () => {
    await confirmMerge(makeStore(false), makeDeps());
    await confirmMerge(makeStore(), makeDeps()); // dialog null
    const merging = ready();
    setDocs(merging, { merging: true });
    await confirmMerge(merging, makeDeps());
    expect(mockAppendStudies).not.toHaveBeenCalled();
  });

  test('成功で新 study 追記 + 文書付け替え + 再読込', async () => {
    const store = ready();
    mockAppendStudies.mockResolvedValue(undefined);
    mockUpdateDocument.mockResolvedValue(undefined);
    // confirm 後の loadDocuments(force) が読む値
    mockReadDocuments.mockResolvedValue([
      makeDoc({ documentId: 'doc-1', studyId: 'study-new' }),
      makeDoc({ documentId: 'doc-2', studyId: 'study-new' }),
    ]);
    mockReadStudies.mockResolvedValue([makeStudy({ studyId: 'study-new', studyLabel: '統合後' })]);

    await confirmMerge(store, makeDeps());

    expect(mockAppendStudies).toHaveBeenCalledWith(
      'sheet-1',
      [expect.objectContaining({ studyId: 'study-new', studyLabel: '統合後', registrationId: 'NCT01234567' })],
      expect.anything(),
    );
    expect(mockUpdateDocument).toHaveBeenCalledTimes(2);
    expect(mockUpdateDocument).toHaveBeenCalledWith(
      'sheet-1',
      expect.objectContaining({ documentId: 'doc-1', studyId: 'study-new' }),
      expect.anything(),
    );
    const state = store.getState();
    expect(state.documents.mergeDialog).toBeNull();
    expect(state.documents.selectedStudyIds).toEqual([]);
    expect(state.documents.studies?.map((s) => s.studyId)).toEqual(['study-new']);
    expect(toastTexts()).toContain('試験を統合しました（統合後の試験は未抽出に戻ります）');
  });

  test('label / registration 空欄は既定 / null を採用する', async () => {
    const store = ready();
    setDocs(store, {
      mergeDialog: { studyIds: ['study-1', 'study-2'], label: '   ', registrationId: '  ', hasExtractedData: false },
    });
    mockAppendStudies.mockResolvedValue(undefined);
    mockUpdateDocument.mockResolvedValue(undefined);
    mockReadDocuments.mockResolvedValue([]);
    mockReadStudies.mockResolvedValue([]);
    await confirmMerge(store, makeDeps());
    expect(mockAppendStudies).toHaveBeenCalledWith(
      'sheet-1',
      [expect.objectContaining({ studyLabel: 'Smith 2020', registrationId: null })],
      expect.anything(),
    );
  });

  test('失敗で mergeError + トースト', async () => {
    const store = ready();
    mockAppendStudies.mockRejectedValue(new Error('sheets down'));
    await confirmMerge(store, makeDeps());
    expect(store.getState().documents.merging).toBe(false);
    expect(store.getState().documents.mergeError).toBe('sheets down');
    expect(toastTexts()).toContain('統合に失敗しました: sheets down');
  });

  test('studies 未読込（null）は mergeStudies が弾いて mergeError にする', async () => {
    const store = ready();
    setDocs(store, { studies: null });
    await confirmMerge(store, makeDeps());
    expect(store.getState().documents.mergeError).not.toBeNull();
    expect(mockAppendStudies).not.toHaveBeenCalled();
  });

  test('records 未読込 / email 取得不可 / uuid・now 未注入でも既定で動く', async () => {
    const store = ready();
    setDocs(store, { records: null }); // 付け替え対象 0 件（records ?? [] の null 側）
    mockGetCurrentUserEmail.mockResolvedValue(null); // createdBy ?? '' の null 側
    mockAppendStudies.mockResolvedValue(undefined);
    mockReadDocuments.mockResolvedValue([]);
    mockReadStudies.mockResolvedValue([]);
    await confirmMerge(store, { ...makeDeps(), newUuid: undefined, now: undefined });
    expect(mockAppendStudies).toHaveBeenCalledTimes(1);
    expect(mockUpdateDocument).not.toHaveBeenCalled();
    const appended = mockAppendStudies.mock.calls[0]?.[1] as readonly StudyRecord[];
    expect(appended[0]?.createdBy).toBe('');
    expect(appended[0]?.createdAt).not.toBe('');
  });
});

describe('ignoreCandidate', () => {
  test('未選択は no-op', async () => {
    await ignoreCandidate(makeStore(false), makeDeps(), ['study-1', 'study-2']);
    expect(mockSetLocal).not.toHaveBeenCalled();
  });

  test('新規なら追加して storage.local に永続化 / 既存キーは no-op', async () => {
    const store = makeStore();
    await ignoreCandidate(store, makeDeps(), ['study-2', 'study-1']);
    expect(store.getState().documents.ignoredCandidateKeys).toEqual(['study-1|study-2']);
    expect(mockSetLocal).toHaveBeenCalledWith(ignoredCandidatesKey('sheet-1'), ['study-1|study-2']);

    mockSetLocal.mockClear();
    await ignoreCandidate(store, makeDeps(), ['study-1', 'study-2']); // 既存
    expect(mockSetLocal).not.toHaveBeenCalled();
  });

  test('永続化失敗はトーストのみ（state は反映済み）', async () => {
    const store = makeStore();
    mockSetLocal.mockRejectedValue(new Error('quota'));
    await ignoreCandidate(store, makeDeps(), ['study-1', 'study-2']);
    expect(store.getState().documents.ignoredCandidateKeys).toEqual(['study-1|study-2']);
    expect(toastTexts()).toContain('統合候補の無視を保存できませんでした: quota');
  });
});

describe('activeStudyGroups / visibleMergeCandidates', () => {
  test('アクティブ study と配下文書を作成順で返す', () => {
    const groups = activeStudyGroups(
      [makeStudy({ studyId: 'study-1' }), makeStudy({ studyId: 'study-2' }), makeStudy({ studyId: 'study-3' })],
      [makeDoc({ documentId: 'd1', studyId: 'study-1' }), makeDoc({ documentId: 'd3', studyId: 'study-3' })],
    );
    expect(groups.map((g) => g.study.studyId)).toEqual(['study-1', 'study-3']);
    expect(groups[0]?.documents.map((d) => d.documentId)).toEqual(['d1']);
  });

  test('登録番号一致の候補を返し、無視キーは除外する', () => {
    const store = makeStore();
    setDocs(store, {
      studies: [
        makeStudy({ studyId: 'study-1', registrationId: 'NCT01234567' }),
        makeStudy({ studyId: 'study-2', registrationId: 'NCT01234567' }),
      ],
      records: [makeDoc({ studyId: 'study-1' }), makeDoc({ documentId: 'doc-2', studyId: 'study-2' })],
    });
    expect(visibleMergeCandidates(store.getState().documents)).toEqual([
      { registrationId: 'NCT01234567', studyIds: ['study-1', 'study-2'] },
    ]);

    setDocs(store, { ignoredCandidateKeys: ['study-1|study-2'] });
    expect(visibleMergeCandidates(store.getState().documents)).toEqual([]);
  });

  test('studies / records 未読込（null）でも空配列を返す', () => {
    expect(visibleMergeCandidates(createInitialState().documents)).toEqual([]);
  });
});
