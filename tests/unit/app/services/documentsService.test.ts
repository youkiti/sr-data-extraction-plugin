// documentsService のテスト。lib/google / features/documents はモジュールモックで置き換え、
// ストア（AppState.documents / counts）の遷移とトースト文言を検証する
import { createInitialState, createStore, type Store } from '../../../../src/app/store';
import {
  importFromPicker,
  loadDocuments,
  saveStudyLabel,
  type DocumentsServiceDeps,
} from '../../../../src/app/services/documentsService';
import type { DocumentRecord } from '../../../../src/domain/document';
import { readDocuments, updateDocument } from '../../../../src/features/documents/documentRepository';
import { importDocuments } from '../../../../src/features/documents/importDocuments';
import { ensureChildFolder } from '../../../../src/lib/google/drive';
import { getCurrentUserEmail } from '../../../../src/lib/google/identity';
import { openPdfPicker } from '../../../../src/lib/google/picker';

jest.mock('../../../../src/features/documents/documentRepository');
jest.mock('../../../../src/features/documents/importDocuments');
jest.mock('../../../../src/lib/google/drive');
jest.mock('../../../../src/lib/google/identity');
jest.mock('../../../../src/lib/google/picker');

const mockReadDocuments = readDocuments as jest.MockedFunction<typeof readDocuments>;
const mockUpdateDocument = updateDocument as jest.MockedFunction<typeof updateDocument>;
const mockImportDocuments = importDocuments as jest.MockedFunction<typeof importDocuments>;
const mockEnsureChildFolder = ensureChildFolder as jest.MockedFunction<typeof ensureChildFolder>;
const mockGetCurrentUserEmail = getCurrentUserEmail as jest.MockedFunction<
  typeof getCurrentUserEmail
>;
const mockOpenPdfPicker = openPdfPicker as jest.MockedFunction<typeof openPdfPicker>;

function makeDoc(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    documentId: 'doc-1',
    studyLabel: 'Smith 2020',
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

function toastTexts(): string[] {
  return Array.from(document.querySelectorAll('.toast')).map((node) => node.textContent ?? '');
}

beforeEach(() => {
  document.body.innerHTML = '';
  mockGetCurrentUserEmail.mockResolvedValue('tester@example.com');
  mockEnsureChildFolder.mockImplementation(async (name) => ({
    id: `${name}-folder-id`,
    webViewLink: `https://drive.google.com/${name}`,
  }));
});

describe('loadDocuments', () => {
  test('プロジェクト未選択なら何もしない', async () => {
    const store = makeStore(false);
    await loadDocuments(store, makeDeps());
    expect(mockReadDocuments).not.toHaveBeenCalled();
  });

  test('読込中なら二重読込しない', async () => {
    const store = makeStore();
    store.setState({ documents: { ...store.getState().documents, loading: true } });
    await loadDocuments(store, makeDeps());
    expect(mockReadDocuments).not.toHaveBeenCalled();
  });

  test('読込済み（records あり）は force 指定時のみ再読込する', async () => {
    const store = makeStore();
    store.setState({ documents: { ...store.getState().documents, records: [] } });
    await loadDocuments(store, makeDeps());
    expect(mockReadDocuments).not.toHaveBeenCalled();

    mockReadDocuments.mockResolvedValue([makeDoc()]);
    await loadDocuments(store, makeDeps(), { force: true });
    expect(mockReadDocuments).toHaveBeenCalledWith('sheet-1', expect.anything());
    expect(store.getState().documents.records).toHaveLength(1);
  });

  test('成功で records と counts.documents を更新し loading を解除する', async () => {
    const store = makeStore();
    mockReadDocuments.mockResolvedValue([makeDoc(), makeDoc({ documentId: 'doc-2' })]);
    const promise = loadDocuments(store, makeDeps());
    expect(store.getState().documents.loading).toBe(true);
    await promise;
    const state = store.getState();
    expect(state.documents.loading).toBe(false);
    expect(state.documents.records).toHaveLength(2);
    expect(state.counts.documents).toBe(2);
  });

  test('失敗で loadError を設定する（Error 以外の throw も文字列化）', async () => {
    const store = makeStore();
    mockReadDocuments.mockRejectedValue(new Error('boom'));
    await loadDocuments(store, makeDeps());
    expect(store.getState().documents.loadError).toBe('boom');

    mockReadDocuments.mockRejectedValue('string-error');
    await loadDocuments(store, makeDeps(), { force: true });
    expect(store.getState().documents.loadError).toBe('string-error');
  });
});

describe('importFromPicker', () => {
  const selections = [
    { sourceFileId: 'src-1', filename: 'a.pdf' },
    { sourceFileId: 'src-2', filename: 'b.pdf' },
  ];

  test('プロジェクト未選択 / 取り込み中は Picker を開かない', async () => {
    await importFromPicker(makeStore(false), makeDeps());
    expect(mockOpenPdfPicker).not.toHaveBeenCalled();

    const store = makeStore();
    store.setState({ documents: { ...store.getState().documents, importing: true } });
    await importFromPicker(store, makeDeps());
    expect(mockOpenPdfPicker).not.toHaveBeenCalled();
  });

  test('Picker の起動失敗はトースト案内のみ', async () => {
    mockOpenPdfPicker.mockRejectedValue(new Error('no token'));
    const store = makeStore();
    await importFromPicker(store, makeDeps());
    expect(toastTexts()).toContain('Drive Picker を開けませんでした: no token');
    expect(store.getState().documents.importing).toBe(false);
  });

  test('キャンセル（null）と空選択は何もしない', async () => {
    const store = makeStore();
    mockOpenPdfPicker.mockResolvedValue(null);
    await importFromPicker(store, makeDeps());
    mockOpenPdfPicker.mockResolvedValue([]);
    await importFromPicker(store, makeDeps());
    expect(mockEnsureChildFolder).not.toHaveBeenCalled();
    expect(store.getState().documents.importRows).toHaveLength(0);
  });

  test('選択 → サブフォルダ解決 → importDocuments → 進捗行と一覧・counts へ反映（部分失敗あり）', async () => {
    const store = makeStore();
    store.setState({
      documents: { ...store.getState().documents, records: [makeDoc({ documentId: 'doc-0' })] },
      counts: { ...store.getState().counts, documents: 1 },
    });
    mockOpenPdfPicker.mockResolvedValue(selections);

    const progressSnapshots: string[][] = [];
    mockImportDocuments.mockImplementation(async (params, deps) => {
      expect(params).toMatchObject({
        spreadsheetId: 'sheet-1',
        documentsFolderId: 'documents-folder-id',
        extractedTextsFolderId: 'extracted_texts-folder-id',
        selections,
        importedBy: 'tester@example.com',
      });
      // 2 段階進捗を通知し、ストアの進捗行が追随することを検証する
      deps.onProgress?.({ fileIndex: 0, totalFiles: 2, filename: 'a.pdf', stage: 'copy' });
      progressSnapshots.push(store.getState().documents.importRows.map((row) => row.status));
      deps.onProgress?.({ fileIndex: 0, totalFiles: 2, filename: 'a.pdf', stage: 'extract' });
      deps.onProgress?.({ fileIndex: 1, totalFiles: 2, filename: 'b.pdf', stage: 'copy' });
      progressSnapshots.push(store.getState().documents.importRows.map((row) => row.status));
      return {
        imported: [makeDoc({ documentId: 'doc-1', sourceFileId: 'src-1', filename: 'a.pdf' })],
        failures: [
          { sourceFileId: 'src-2', filename: 'b.pdf', stage: 'extract', detail: 'parse error' },
        ],
      };
    });

    await importFromPicker(store, makeDeps());

    expect(mockEnsureChildFolder).toHaveBeenCalledWith('documents', 'folder-1', expect.anything());
    expect(mockEnsureChildFolder).toHaveBeenCalledWith(
      'extracted_texts',
      'folder-1',
      expect.anything(),
    );
    expect(progressSnapshots).toEqual([
      ['copy', 'queued'],
      ['extract', 'copy'],
    ]);

    const state = store.getState();
    expect(state.documents.importing).toBe(false);
    expect(state.documents.importRows).toEqual([
      { sourceFileId: 'src-1', filename: 'a.pdf', status: 'done', detail: null },
      {
        sourceFileId: 'src-2',
        filename: 'b.pdf',
        status: 'failed',
        detail: 'テキスト抽出に失敗: parse error',
      },
    ]);
    expect(state.documents.records?.map((doc) => doc.documentId)).toEqual(['doc-0', 'doc-1']);
    expect(state.counts.documents).toBe(2);
    expect(toastTexts()).toContain('1 件取り込み、1 件失敗しました');
  });

  test('全件成功のトースト + 一覧未読込（records null）でも取り込み分だけで一覧を作る', async () => {
    const store = makeStore();
    mockOpenPdfPicker.mockResolvedValue([{ sourceFileId: 'src-1', filename: 'a.pdf' }]);
    mockGetCurrentUserEmail.mockResolvedValue(null); // importedBy 空文字のフォールバック
    mockImportDocuments.mockImplementation(async (params) => {
      expect(params.importedBy).toBe('');
      return {
        imported: [makeDoc({ documentId: 'doc-1', sourceFileId: 'src-1', filename: 'a.pdf' })],
        failures: [],
      };
    });

    await importFromPicker(store, makeDeps());

    const state = store.getState();
    expect(state.documents.records?.map((doc) => doc.documentId)).toEqual(['doc-1']);
    expect(state.counts.documents).toBe(1);
    expect(state.documents.importRows[0]?.status).toBe('done');
    expect(toastTexts()).toContain('1 件の PDF を取り込みました');
  });

  test('サブフォルダ解決の失敗で全行 failed + トースト', async () => {
    const store = makeStore();
    mockOpenPdfPicker.mockResolvedValue(selections);
    mockEnsureChildFolder.mockRejectedValue(new Error('drive down'));

    await importFromPicker(store, makeDeps());

    const state = store.getState();
    expect(state.documents.importing).toBe(false);
    expect(state.documents.importRows.map((row) => row.status)).toEqual(['failed', 'failed']);
    expect(state.documents.importRows[0]?.detail).toBe('drive down');
    expect(toastTexts()).toContain('取り込みに失敗しました: drive down');
  });
});

describe('saveStudyLabel', () => {
  test('プロジェクト未選択 / 一覧未読込 / 対象行なしは何もしない', async () => {
    await saveStudyLabel(makeStore(false), makeDeps(), 'doc-1', 'X');

    const noRecords = makeStore();
    await saveStudyLabel(noRecords, makeDeps(), 'doc-1', 'X');

    const store = makeStore();
    store.setState({ documents: { ...store.getState().documents, records: [makeDoc()] } });
    await saveStudyLabel(store, makeDeps(), 'unknown-id', 'X');

    expect(mockUpdateDocument).not.toHaveBeenCalled();
  });

  test('空文字は保存せず案内し、再描画（listener 通知）で入力値を戻す', async () => {
    const store = makeStore();
    store.setState({ documents: { ...store.getState().documents, records: [makeDoc()] } });
    const listener = jest.fn();
    store.subscribe(listener);

    await saveStudyLabel(store, makeDeps(), 'doc-1', '   ');

    expect(mockUpdateDocument).not.toHaveBeenCalled();
    expect(toastTexts()).toContain('study_label は空にできません');
    expect(listener).toHaveBeenCalled();
  });

  test('trim 後に変更がなければ API を呼ばず再描画のみ', async () => {
    const store = makeStore();
    store.setState({ documents: { ...store.getState().documents, records: [makeDoc()] } });
    const listener = jest.fn();
    store.subscribe(listener);

    await saveStudyLabel(store, makeDeps(), 'doc-1', '  Smith 2020  ');

    expect(mockUpdateDocument).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalled();
    expect(toastTexts()).toHaveLength(0);
  });

  test('成功で該当行のみ更新しトーストを出す', async () => {
    const store = makeStore();
    store.setState({
      documents: {
        ...store.getState().documents,
        records: [makeDoc(), makeDoc({ documentId: 'doc-2', studyLabel: 'Jones 2021' })],
      },
    });
    mockUpdateDocument.mockResolvedValue(undefined);

    await saveStudyLabel(store, makeDeps(), 'doc-1', ' Smith 2020a ');

    expect(mockUpdateDocument).toHaveBeenCalledWith(
      'sheet-1',
      expect.objectContaining({ documentId: 'doc-1', studyLabel: 'Smith 2020a' }),
      expect.anything(),
    );
    const records = store.getState().documents.records;
    expect(records?.[0]?.studyLabel).toBe('Smith 2020a');
    expect(records?.[1]?.studyLabel).toBe('Jones 2021');
    expect(toastTexts()).toContain('study_label を保存しました');
  });

  test('失敗でトースト + 再描画（値は元のまま）', async () => {
    const store = makeStore();
    store.setState({ documents: { ...store.getState().documents, records: [makeDoc()] } });
    mockUpdateDocument.mockRejectedValue(new Error('offline'));
    const listener = jest.fn();
    store.subscribe(listener);

    await saveStudyLabel(store, makeDeps(), 'doc-1', 'New Label');

    expect(toastTexts()).toContain('study_label の保存に失敗しました: offline');
    expect(store.getState().documents.records?.[0]?.studyLabel).toBe('Smith 2020');
    expect(listener).toHaveBeenCalled();
  });
});
