// tiabImportService（S3 tiab-review 採用リスト取り込み。issue #68）のテスト。
// シート直読み（tiabSheetReader）とリポジトリのバッチ更新はモジュールモックで置き換え、
// include 抽出 + プラン計算（tiabReview）は本物を使う。ストア遷移とトースト文言を検証する
import { createInitialState, createStore, type Store } from '../../../../src/app/store';
import { type DocumentsServiceDeps } from '../../../../src/app/services/documentsService';
import {
  applyTiabImport,
  closeTiabImport,
  openTiabImport,
  previewTiabImport,
} from '../../../../src/app/services/tiabImportService';
import type { DocumentRecord } from '../../../../src/domain/document';
import type { StudyRecord } from '../../../../src/domain/study';
import { updateDocuments } from '../../../../src/features/documents/documentRepository';
import { updateStudies } from '../../../../src/features/documents/studyRepository';
import type { TiabImportPlan } from '../../../../src/features/documents/tiabReview';
import { readTiabSheet } from '../../../../src/features/documents/tiabSheetReader';

jest.mock('../../../../src/features/documents/tiabSheetReader');
jest.mock('../../../../src/features/documents/documentRepository', () => {
  const actual = jest.requireActual('../../../../src/features/documents/documentRepository');
  return { __esModule: true, ...actual, readDocuments: jest.fn(), updateDocuments: jest.fn() };
});
jest.mock('../../../../src/features/documents/studyRepository', () => {
  const actual = jest.requireActual('../../../../src/features/documents/studyRepository');
  return { __esModule: true, ...actual, readStudies: jest.fn(), updateStudies: jest.fn() };
});
jest.mock('../../../../src/features/extraction/runRepository');
jest.mock('../../../../src/lib/storage/chromeStorage');

import { readDocuments } from '../../../../src/features/documents/documentRepository';
import { readStudies } from '../../../../src/features/documents/studyRepository';
import { readRunStudyCoverage } from '../../../../src/features/extraction/runRepository';
import { getLocal } from '../../../../src/lib/storage/chromeStorage';

const mockReadTiabSheet = jest.mocked(readTiabSheet);
const mockUpdateStudies = jest.mocked(updateStudies);
const mockUpdateDocuments = jest.mocked(updateDocuments);
const mockReadDocuments = jest.mocked(readDocuments);
const mockReadStudies = jest.mocked(readStudies);
const mockReadCoverage = jest.mocked(readRunStudyCoverage);
const mockGetLocal = jest.mocked(getLocal);

const SHEET_URL = 'https://docs.google.com/spreadsheets/d/tiab-sheet-1/edit';

function makeStudy(overrides: Partial<StudyRecord> = {}): StudyRecord {
  return {
    studyId: 'study-1',
    studyLabel: 'smith2020',
    registrationId: null,
    createdAt: 't1',
    createdBy: 'tester@example.com',
    note: null,
    ...overrides,
  };
}

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

function makeStore(options: { withProject?: boolean; loaded?: boolean } = {}): Store {
  const { withProject = true, loaded = true } = options;
  const initial = createInitialState();
  if (withProject) {
    initial.currentProject = {
      projectId: 'p1',
      spreadsheetId: 'sheet-1',
      driveFolderId: 'folder-1',
      name: 'テスト SR',
    };
  }
  if (loaded) {
    initial.documents = {
      ...initial.documents,
      records: [makeDoc()],
      studies: [makeStudy()],
    };
  }
  return createStore(initial);
}

function makePlan(overrides: Partial<TiabImportPlan> = {}): TiabImportPlan {
  return {
    phase: 'fulltext',
    totalReferences: 2,
    includeCount: 1,
    items: [
      {
        refId: 'r1',
        title: 'T1',
        studyLabel: 'Smith (2020)',
        status: 'update',
        matchedFilenames: ['smith2020.pdf'],
      },
      { refId: 'r2', title: 'T2', studyLabel: 'Doe (2021)', status: 'unmatched', matchedFilenames: [] },
    ],
    studyUpdates: [makeStudy({ studyLabel: 'Smith (2020)' })],
    documentUpdates: [makeDoc({ pmid: '123' })],
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  document.body.innerHTML = '';
});

describe('openTiabImport / closeTiabImport', () => {
  test('open でカードを開き、close で初期状態へ戻す', () => {
    const store = makeStore();
    openTiabImport(store);
    expect(store.getState().documents.tiabImport.open).toBe(true);

    store.setState({
      documents: {
        ...store.getState().documents,
        tiabImport: {
          open: true,
          sheetInput: 'x',
          loading: false,
          error: 'err',
          plan: makePlan(),
          applying: false,
          result: { studiesUpdated: 1, documentsUpdated: 1, unmatched: 0 },
        },
      },
    });
    closeTiabImport(store);
    expect(store.getState().documents.tiabImport).toEqual({
      open: false,
      sheetInput: '',
      loading: false,
      error: null,
      plan: null,
      applying: false,
      result: null,
    });
  });
});

describe('previewTiabImport', () => {
  test('tiab シートを読み、include 抽出 + 反映プランを state に置く', async () => {
    const store = makeStore();
    mockReadTiabSheet.mockResolvedValue({
      references: [
        {
          refId: 'r1',
          title: 'T1',
          year: 2020,
          authors: 'Smith, J',
          doi: null,
          pmid: '123',
          fulltextUrl: 'https://drive.google.com/file/d/src-1/view',
        },
      ],
      decisions: [
        {
          refId: 'r1',
          reviewerId: 'a@example.com',
          decision: 'include',
          decidedAt: 't1',
          screeningPhase: 'fulltext',
        },
      ],
      activeFulltextAiRound: null,
    });

    await previewTiabImport(store, makeDeps(), SHEET_URL);

    const tiab = store.getState().documents.tiabImport;
    expect(mockReadTiabSheet).toHaveBeenCalledWith('tiab-sheet-1', expect.anything());
    expect(tiab.loading).toBe(false);
    expect(tiab.error).toBeNull();
    expect(tiab.sheetInput).toBe(SHEET_URL);
    expect(tiab.plan?.includeCount).toBe(1);
    expect(tiab.plan?.studyUpdates).toEqual([makeStudy({ studyLabel: 'Smith (2020)' })]);
    expect(tiab.plan?.documentUpdates).toEqual([makeDoc({ pmid: '123' })]);
  });

  test('URL / ID を解釈できない入力はインラインエラー', async () => {
    const store = makeStore();
    await previewTiabImport(store, makeDeps(), 'not a sheet');
    expect(store.getState().documents.tiabImport.error).toBe(
      'tiab-review のスプレッドシートの URL または ID を入力してください',
    );
    expect(mockReadTiabSheet).not.toHaveBeenCalled();
  });

  test('文献一覧が未読込ならエラー案内する', async () => {
    const store = makeStore({ loaded: false });
    await previewTiabImport(store, makeDeps(), SHEET_URL);
    expect(store.getState().documents.tiabImport.error).toBe(
      '文献一覧の読み込みが完了してから実行してください',
    );
    expect(mockReadTiabSheet).not.toHaveBeenCalled();
  });

  test('プロジェクト未選択・読み込み中・反映中は no-op', async () => {
    await previewTiabImport(makeStore({ withProject: false }), makeDeps(), SHEET_URL);
    expect(mockReadTiabSheet).not.toHaveBeenCalled();

    const loadingStore = makeStore();
    loadingStore.setState({
      documents: {
        ...loadingStore.getState().documents,
        tiabImport: { ...loadingStore.getState().documents.tiabImport, loading: true },
      },
    });
    await previewTiabImport(loadingStore, makeDeps(), SHEET_URL);
    expect(mockReadTiabSheet).not.toHaveBeenCalled();

    const applyingStore = makeStore();
    applyingStore.setState({
      documents: {
        ...applyingStore.getState().documents,
        tiabImport: { ...applyingStore.getState().documents.tiabImport, applying: true },
      },
    });
    await previewTiabImport(applyingStore, makeDeps(), SHEET_URL);
    expect(mockReadTiabSheet).not.toHaveBeenCalled();
  });

  test('シート読み込みの失敗はエラー文言を state に置く', async () => {
    const store = makeStore();
    mockReadTiabSheet.mockRejectedValue(new Error('References / Decisions タブが見つかりません'));
    await previewTiabImport(store, makeDeps(), SHEET_URL);
    const tiab = store.getState().documents.tiabImport;
    expect(tiab.loading).toBe(false);
    expect(tiab.error).toContain('References / Decisions タブが見つかりません');
  });

  test('Error 以外の失敗も文字列化して表示する', async () => {
    const store = makeStore();
    mockReadTiabSheet.mockRejectedValue('boom');
    await previewTiabImport(store, makeDeps(), SHEET_URL);
    expect(store.getState().documents.tiabImport.error).toBe('boom');
  });
});

describe('applyTiabImport', () => {
  function storeWithPlan(plan: TiabImportPlan): Store {
    const store = makeStore();
    store.setState({
      documents: {
        ...store.getState().documents,
        tiabImport: { ...store.getState().documents.tiabImport, open: true, plan },
      },
    });
    return store;
  }

  test('Studies 上書き + Documents 転記 → 結果サマリ + 一覧の強制再読込', async () => {
    const store = storeWithPlan(makePlan());
    // applyTiabImport 完了後の loadDocuments(force) が読む素材
    mockReadDocuments.mockResolvedValue([makeDoc({ pmid: '123' })]);
    mockReadStudies.mockResolvedValue([makeStudy({ studyLabel: 'Smith (2020)' })]);
    mockReadCoverage.mockResolvedValue({
      extracted: new Set<string>(),
      interrupted: new Set<string>(),
      latestCompletedRunByStudy: new Map(),
    });
    mockGetLocal.mockResolvedValue(null);

    await applyTiabImport(store, makeDeps());

    expect(mockUpdateStudies).toHaveBeenCalledWith(
      'sheet-1',
      [makeStudy({ studyLabel: 'Smith (2020)' })],
      expect.anything(),
    );
    expect(mockUpdateDocuments).toHaveBeenCalledWith(
      'sheet-1',
      [makeDoc({ pmid: '123' })],
      expect.anything(),
    );
    const tiab = store.getState().documents.tiabImport;
    expect(tiab.applying).toBe(false);
    expect(tiab.plan).toBeNull();
    expect(tiab.result).toEqual({ studiesUpdated: 1, documentsUpdated: 1, unmatched: 1 });
    expect(document.body.textContent).toContain('tiab-review の採用リストを反映しました');
    // 一覧は再読込済み
    expect(mockReadDocuments).toHaveBeenCalled();
    expect(store.getState().documents.studies?.[0]?.studyLabel).toBe('Smith (2020)');
  });

  test('プラン未計算・反映中・プロジェクト未選択・変更 0 件は no-op', async () => {
    await applyTiabImport(makeStore(), makeDeps()); // plan なし
    expect(mockUpdateStudies).not.toHaveBeenCalled();

    const applying = storeWithPlan(makePlan());
    applying.setState({
      documents: {
        ...applying.getState().documents,
        tiabImport: { ...applying.getState().documents.tiabImport, applying: true },
      },
    });
    await applyTiabImport(applying, makeDeps());
    expect(mockUpdateStudies).not.toHaveBeenCalled();

    const noProject = makeStore({ withProject: false });
    noProject.setState({
      documents: {
        ...noProject.getState().documents,
        tiabImport: { ...noProject.getState().documents.tiabImport, plan: makePlan() },
      },
    });
    await applyTiabImport(noProject, makeDeps());
    expect(mockUpdateStudies).not.toHaveBeenCalled();

    const emptyPlan = storeWithPlan(makePlan({ studyUpdates: [], documentUpdates: [] }));
    await applyTiabImport(emptyPlan, makeDeps());
    expect(mockUpdateStudies).not.toHaveBeenCalled();
  });

  test('書き込み失敗はエラー + トーストで案内し、プランは残す（再実行可）', async () => {
    const store = storeWithPlan(makePlan());
    mockUpdateStudies.mockRejectedValue(new Error('quota exceeded'));

    await applyTiabImport(store, makeDeps());

    const tiab = store.getState().documents.tiabImport;
    expect(tiab.applying).toBe(false);
    expect(tiab.error).toBe('quota exceeded');
    expect(tiab.plan).not.toBeNull();
    expect(document.body.textContent).toContain('取り込みに失敗しました: quota exceeded');
  });
});
