// tiabImportService（S3 tiab-review 採用リスト取り込み。issue #68。
// アクセス拒否からの Picker 許可導線は issue #142）のテスト。
// シート直読み（tiabSheetReader）とリポジトリのバッチ更新はモジュールモックで置き換え、
// include 抽出 + プラン計算（tiabReview）は本物を使う。ストア遷移とトースト文言を検証する
import { createInitialState, createStore, type Store, type TiabHandoffState } from '../../../../src/app/store';
import { type DocumentsServiceDeps } from '../../../../src/app/services/documentsService';
import {
  applyTiabImport,
  closeTiabImport,
  dismissTiabHandoff,
  grantTiabSheetAccess,
  openTiabImport,
  previewTiabImport,
  runTiabHandoffImport,
} from '../../../../src/app/services/tiabImportService';
import type { DocumentRecord } from '../../../../src/domain/document';
import type { StudyRecord } from '../../../../src/domain/study';
import { updateDocuments } from '../../../../src/features/documents/documentRepository';
import { updateStudies } from '../../../../src/features/documents/studyRepository';
import type { TiabImportPlan } from '../../../../src/features/documents/tiabReview';
import { readTiabSheet } from '../../../../src/features/documents/tiabSheetReader';
import { tiabHandoffKey } from '../../../../src/features/project/tiabHandoffStore';
import { openProjectFilesPicker, openSpreadsheetPicker } from '../../../../src/lib/google/picker';
import { SheetsAccessDeniedError } from '../../../../src/lib/google/sheets';
import { t } from '../../../../src/lib/i18n';

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
jest.mock('../../../../src/lib/google/picker', () => ({
  openSpreadsheetPicker: jest.fn(),
  openProjectFilesPicker: jest.fn(),
}));
// runTiabHandoffImport の呼び出し順序（importPickedSelections → openTiabImport →
// previewTiabImport）を検証するため、documentsService は importPickedSelections だけ差し替える
// （loadDocuments 等は本物のまま = applyTiabImport の既存テストの挙動を変えない）
jest.mock('../../../../src/app/services/documentsService', () => {
  const actual = jest.requireActual('../../../../src/app/services/documentsService');
  return { __esModule: true, ...actual, importPickedSelections: jest.fn() };
});

import { readDocuments } from '../../../../src/features/documents/documentRepository';
import { readStudies } from '../../../../src/features/documents/studyRepository';
import { readRunStudyCoverage } from '../../../../src/features/extraction/runRepository';
import { getLocal, removeLocal } from '../../../../src/lib/storage/chromeStorage';
import { importPickedSelections } from '../../../../src/app/services/documentsService';

const mockReadTiabSheet = jest.mocked(readTiabSheet);
const mockUpdateStudies = jest.mocked(updateStudies);
const mockUpdateDocuments = jest.mocked(updateDocuments);
const mockReadDocuments = jest.mocked(readDocuments);
const mockReadStudies = jest.mocked(readStudies);
const mockReadCoverage = jest.mocked(readRunStudyCoverage);
const mockGetLocal = jest.mocked(getLocal);
const mockRemoveLocal = jest.mocked(removeLocal);
const mockOpenSpreadsheetPicker = jest.mocked(openSpreadsheetPicker);
const mockOpenProjectFilesPicker = jest.mocked(openProjectFilesPicker);
const mockImportPickedSelections = jest.mocked(importPickedSelections);

const SHEET_URL = 'https://docs.google.com/spreadsheets/d/tiab-sheet-1/edit';
const HANDOFF_SHEET_ID = 'tiab-handoff-sheet-id-1';

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

/** documents.tiabHandoff を差し込んだ store を作る（runTiabHandoffImport / dismissTiabHandoff 用） */
function withHandoff(
  patch: Partial<TiabHandoffState> = {},
  storeOptions: { withProject?: boolean; loaded?: boolean } = {},
): Store {
  const store = makeStore(storeOptions);
  const documents = store.getState().documents;
  store.setState({
    documents: {
      ...documents,
      tiabHandoff: { tiabSheetId: HANDOFF_SHEET_ID, running: false, error: null, ...patch },
    },
  });
  return store;
}

/** include 1 件（fulltext PDF 付き）の tiab シート応答（runTiabHandoffImport の成功系テスト用） */
function includedSheetResponse(fulltextUrl: string | null = 'https://drive.google.com/file/d/src-9/view') {
  return {
    references: [
      {
        refId: 'r1',
        title: 'T1',
        year: 2020,
        authors: 'Smith, J',
        doi: null,
        pmid: null,
        fulltextUrl,
      },
    ],
    decisions: [
      {
        refId: 'r1',
        reviewerId: 'a@example.com',
        decision: 'include' as const,
        decidedAt: 't1',
        screeningPhase: 'fulltext' as const,
      },
    ],
    activeFulltextAiRound: null,
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
          accessDenied: true,
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
      accessDenied: false,
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

  test('SheetsAccessDeniedError（drive.file 未許可）は accessDenied を立てる（issue #142）', async () => {
    const store = makeStore();
    mockReadTiabSheet.mockRejectedValue(new SheetsAccessDeniedError('tiab-sheet-1', 404));
    await previewTiabImport(store, makeDeps(), SHEET_URL);
    const tiab = store.getState().documents.tiabImport;
    expect(tiab.accessDenied).toBe(true);
    expect(tiab.error).toContain('Picker での許可が必要です');
  });

  test('通常のエラー（アクセス拒否以外）は accessDenied を立てない', async () => {
    const store = makeStore();
    mockReadTiabSheet.mockRejectedValue(new Error('タブが見つかりません'));
    await previewTiabImport(store, makeDeps(), SHEET_URL);
    expect(store.getState().documents.tiabImport.accessDenied).toBe(false);
  });

  test('再プレビューは直前の accessDenied を引きずらない', async () => {
    const store = makeStore();
    store.setState({
      documents: {
        ...store.getState().documents,
        tiabImport: { ...store.getState().documents.tiabImport, accessDenied: true, error: '前回のエラー' },
      },
    });
    mockReadTiabSheet.mockResolvedValue({ references: [], decisions: [], activeFulltextAiRound: null });
    await previewTiabImport(store, makeDeps(), SHEET_URL);
    expect(store.getState().documents.tiabImport.accessDenied).toBe(false);
  });
});

describe('grantTiabSheetAccess（issue #142。docs/ui-states.md §3 tiab カード）', () => {
  function makeDeniedStore(sheetInput: string = SHEET_URL): Store {
    const store = makeStore();
    store.setState({
      documents: {
        ...store.getState().documents,
        tiabImport: {
          ...store.getState().documents.tiabImport,
          open: true,
          sheetInput,
          error: 'このスプレッドシートを開く権限がまだありません',
          accessDenied: true,
        },
      },
    });
    return store;
  }

  test('プロジェクト未選択・accessDenied でない・読み込み中・反映中は no-op', async () => {
    await grantTiabSheetAccess(makeStore({ withProject: false }), makeDeps());
    expect(mockOpenSpreadsheetPicker).not.toHaveBeenCalled();

    const notDenied = makeStore();
    await grantTiabSheetAccess(notDenied, makeDeps());
    expect(mockOpenSpreadsheetPicker).not.toHaveBeenCalled();

    const loading = makeDeniedStore();
    loading.setState({
      documents: {
        ...loading.getState().documents,
        tiabImport: { ...loading.getState().documents.tiabImport, loading: true },
      },
    });
    await grantTiabSheetAccess(loading, makeDeps());
    expect(mockOpenSpreadsheetPicker).not.toHaveBeenCalled();

    const applying = makeDeniedStore();
    applying.setState({
      documents: {
        ...applying.getState().documents,
        tiabImport: { ...applying.getState().documents.tiabImport, applying: true },
      },
    });
    await grantTiabSheetAccess(applying, makeDeps());
    expect(mockOpenSpreadsheetPicker).not.toHaveBeenCalled();
  });

  test('accessDenied だが sheetInput を解釈できない場合は Picker を開かない（フェイルクローズ）', async () => {
    const store = makeDeniedStore('not a sheet url');
    await grantTiabSheetAccess(store, makeDeps());
    expect(mockOpenSpreadsheetPicker).not.toHaveBeenCalled();
  });

  test('cancelled は状態を変えない（案内とボタンは残る）', async () => {
    mockOpenSpreadsheetPicker.mockResolvedValue('cancelled');
    const store = makeDeniedStore();
    await grantTiabSheetAccess(store, makeDeps());
    expect(mockOpenSpreadsheetPicker).toHaveBeenCalledWith(expect.anything(), 'tiab-sheet-1');
    expect(store.getState().documents.tiabImport.accessDenied).toBe(true);
    expect(mockReadTiabSheet).not.toHaveBeenCalled();
  });

  test('mismatch はトースト表示のみで状態を変えない', async () => {
    mockOpenSpreadsheetPicker.mockResolvedValue('mismatch');
    const store = makeDeniedStore();
    await grantTiabSheetAccess(store, makeDeps());
    expect(store.getState().documents.tiabImport.accessDenied).toBe(true);
    expect(mockReadTiabSheet).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('開こうとしたシートと違うシートが選択されました');
  });

  test('Picker 起動自体の失敗はトースト表示のみで状態を変えない', async () => {
    mockOpenSpreadsheetPicker.mockRejectedValue(new Error('タブの作成に失敗'));
    const store = makeDeniedStore();
    await grantTiabSheetAccess(store, makeDeps());
    expect(store.getState().documents.tiabImport.accessDenied).toBe(true);
    expect(document.body.textContent).toContain('タブの作成に失敗');
  });

  test('granted → プレビューを自動リトライして成功する', async () => {
    mockOpenSpreadsheetPicker.mockResolvedValue('granted');
    mockReadTiabSheet.mockResolvedValue({
      references: [
        {
          refId: 'r1',
          title: 'T1',
          year: 2020,
          authors: 'Smith, J',
          doi: null,
          pmid: '123',
          fulltextUrl: null,
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
    const store = makeDeniedStore();
    await grantTiabSheetAccess(store, makeDeps());
    expect(mockReadTiabSheet).toHaveBeenCalledWith('tiab-sheet-1', expect.anything());
    const tiab = store.getState().documents.tiabImport;
    expect(tiab.accessDenied).toBe(false);
    expect(tiab.error).toBeNull();
    expect(tiab.plan?.includeCount).toBe(1);
  });

  test('granted だが再取得も拒否されたら accessDenied を維持する', async () => {
    mockOpenSpreadsheetPicker.mockResolvedValue('granted');
    mockReadTiabSheet.mockRejectedValue(new SheetsAccessDeniedError('tiab-sheet-1', 404));
    const store = makeDeniedStore();
    await grantTiabSheetAccess(store, makeDeps());
    expect(store.getState().documents.tiabImport.accessDenied).toBe(true);
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
    // tiabHandoff が無い（通常の手動導線）ときは storage をクリアしない
    expect(mockRemoveLocal).not.toHaveBeenCalled();
  });

  test('反映したシートが引き継ぎ対象と一致すれば force 再読込の前に storage の引き継ぎ状態をクリアする', async () => {
    const store = storeWithPlan(makePlan());
    store.setState({
      documents: {
        ...store.getState().documents,
        // tiab.sheetInput が引き継ぎ対象（HANDOFF_SHEET_ID）と一致するケース
        tiabImport: { ...store.getState().documents.tiabImport, plan: makePlan(), sheetInput: HANDOFF_SHEET_ID },
        tiabHandoff: { tiabSheetId: HANDOFF_SHEET_ID, running: false, error: null },
      },
    });
    mockReadDocuments.mockResolvedValue([makeDoc({ pmid: '123' })]);
    mockReadStudies.mockResolvedValue([makeStudy({ studyLabel: 'Smith (2020)' })]);
    mockReadCoverage.mockResolvedValue({
      extracted: new Set<string>(),
      interrupted: new Set<string>(),
      latestCompletedRunByStudy: new Map(),
    });
    mockGetLocal.mockResolvedValue(null);

    await applyTiabImport(store, makeDeps());

    expect(mockRemoveLocal).toHaveBeenCalledWith(tiabHandoffKey('p1'));
    // 直後の loadDocuments(force) は loadTiabHandoff() → null（storage クリア済み）を読むため非表示になる
    expect(store.getState().documents.tiabHandoff).toBeNull();
  });

  test('反映したシートが引き継ぎ対象と一致しなければクリアしない（手動で別の tiab シートを入力して反映したケース）', async () => {
    const store = storeWithPlan(makePlan());
    store.setState({
      documents: {
        ...store.getState().documents,
        // sheetInput は引き継ぎ対象（HANDOFF_SHEET_ID）とは別のシート
        tiabImport: {
          ...store.getState().documents.tiabImport,
          plan: makePlan(),
          sheetInput: 'another-manual-sheet-id-xxxxxxxxxx',
        },
        tiabHandoff: { tiabSheetId: HANDOFF_SHEET_ID, running: false, error: null },
      },
    });
    mockReadDocuments.mockResolvedValue([makeDoc({ pmid: '123' })]);
    mockReadStudies.mockResolvedValue([makeStudy({ studyLabel: 'Smith (2020)' })]);
    mockReadCoverage.mockResolvedValue({
      extracted: new Set<string>(),
      interrupted: new Set<string>(),
      latestCompletedRunByStudy: new Map(),
    });
    mockGetLocal.mockResolvedValue(null);

    await applyTiabImport(store, makeDeps());

    expect(mockRemoveLocal).not.toHaveBeenCalled();
  });

  test('storage のクリアに失敗しても（ベストエフォート）Sheets への反映は成功扱いのまま force 再読込まで進む', async () => {
    const store = storeWithPlan(makePlan());
    store.setState({
      documents: {
        ...store.getState().documents,
        tiabImport: { ...store.getState().documents.tiabImport, plan: makePlan(), sheetInput: HANDOFF_SHEET_ID },
        tiabHandoff: { tiabSheetId: HANDOFF_SHEET_ID, running: false, error: null },
      },
    });
    mockReadDocuments.mockResolvedValue([makeDoc({ pmid: '123' })]);
    mockReadStudies.mockResolvedValue([makeStudy({ studyLabel: 'Smith (2020)' })]);
    mockReadCoverage.mockResolvedValue({
      extracted: new Set<string>(),
      interrupted: new Set<string>(),
      latestCompletedRunByStudy: new Map(),
    });
    mockGetLocal.mockResolvedValue(null);
    // mockRejectedValueOnce: jest.clearAllMocks()（beforeEach）は呼び出し履歴のみクリアし
    // 実装は引き継がれるため、mockRejectedValue（永続）だと後続テストの removeLocal 呼び出しまで
    // 失敗させてしまう。1 回だけ失敗させれば本テストの検証には十分
    mockRemoveLocal.mockRejectedValueOnce(new Error('storage failed'));

    await applyTiabImport(store, makeDeps());

    expect(mockRemoveLocal).toHaveBeenCalledWith(tiabHandoffKey('p1'));
    const tiab = store.getState().documents.tiabImport;
    expect(tiab.applying).toBe(false);
    expect(tiab.error).toBeNull();
    expect(tiab.plan).toBeNull();
    expect(document.body.textContent).toContain('tiab-review の採用リストを反映しました');
    expect(mockReadDocuments).toHaveBeenCalled();
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

describe('runTiabHandoffImport（S3 tiab-review 引き継ぎパネル。ui-states.md §3 / ※Q2）', () => {
  test('プロジェクト未選択・handoff なし・running 中・importing 中・tiabImport.loading・tiabImport.applying は no-op', async () => {
    await runTiabHandoffImport(makeStore({ withProject: false }), makeDeps());
    expect(mockReadTiabSheet).not.toHaveBeenCalled();

    // handoff なし（既定 null）
    await runTiabHandoffImport(makeStore(), makeDeps());
    expect(mockReadTiabSheet).not.toHaveBeenCalled();

    // 既に running 中
    await runTiabHandoffImport(withHandoff({ running: true }), makeDeps());
    expect(mockReadTiabSheet).not.toHaveBeenCalled();

    // documents.importing 中（通常取り込みと競合させない）
    const importingStore = withHandoff();
    importingStore.setState({
      documents: { ...importingStore.getState().documents, importing: true },
    });
    await runTiabHandoffImport(importingStore, makeDeps());
    expect(mockReadTiabSheet).not.toHaveBeenCalled();

    // tiabImport.loading 中
    const loadingStore = withHandoff();
    loadingStore.setState({
      documents: {
        ...loadingStore.getState().documents,
        tiabImport: { ...loadingStore.getState().documents.tiabImport, loading: true },
      },
    });
    await runTiabHandoffImport(loadingStore, makeDeps());
    expect(mockReadTiabSheet).not.toHaveBeenCalled();

    // tiabImport.applying 中
    const applyingStore = withHandoff();
    applyingStore.setState({
      documents: {
        ...applyingStore.getState().documents,
        tiabImport: { ...applyingStore.getState().documents.tiabImport, applying: true },
      },
    });
    await runTiabHandoffImport(applyingStore, makeDeps());
    expect(mockReadTiabSheet).not.toHaveBeenCalled();
  });

  test('include に Drive 上の fulltext PDF が無ければ案内して終了する（Picker は開かない）', async () => {
    const store = withHandoff();
    mockReadTiabSheet.mockResolvedValue(includedSheetResponse(null));

    await runTiabHandoffImport(store, makeDeps());

    expect(mockReadTiabSheet).toHaveBeenCalledWith(HANDOFF_SHEET_ID, expect.anything());
    const handoff = store.getState().documents.tiabHandoff;
    expect(handoff?.running).toBe(false);
    expect(handoff?.error).toBe(t('documents.tiabHandoffNoFulltext'));
    expect(mockOpenProjectFilesPicker).not.toHaveBeenCalled();
    expect(mockImportPickedSelections).not.toHaveBeenCalled();
  });

  test('include の fulltext_url を重複除去したうえで Picker のファイル許可モードへ渡す', async () => {
    const store = withHandoff();
    mockReadTiabSheet.mockResolvedValue({
      references: [
        {
          refId: 'r1',
          title: 'T1',
          year: 2020,
          authors: 'Smith, J',
          doi: null,
          pmid: null,
          fulltextUrl: 'https://drive.google.com/file/d/src-9/view',
        },
        {
          refId: 'r2',
          title: 'T2',
          year: 2021,
          authors: 'Doe, J',
          doi: null,
          pmid: null,
          // r1 と同じ Drive ファイル（重複除去の対象）
          fulltextUrl: 'https://drive.google.com/file/d/src-9/view',
        },
      ],
      decisions: [
        { refId: 'r1', reviewerId: 'a@example.com', decision: 'include', decidedAt: 't1', screeningPhase: 'fulltext' },
        { refId: 'r2', reviewerId: 'a@example.com', decision: 'include', decidedAt: 't1', screeningPhase: 'fulltext' },
      ],
      activeFulltextAiRound: null,
    });
    mockOpenProjectFilesPicker.mockResolvedValue(null); // キャンセルで以降を省略

    await runTiabHandoffImport(store, makeDeps());

    expect(mockOpenProjectFilesPicker).toHaveBeenCalledWith(expect.anything(), ['src-9']);
  });

  test('Picker キャンセル（null）は状態を維持する（running のみ false へ戻す）', async () => {
    const store = withHandoff();
    mockReadTiabSheet.mockResolvedValue(includedSheetResponse());
    mockOpenProjectFilesPicker.mockResolvedValue(null);

    await runTiabHandoffImport(store, makeDeps());

    const handoff = store.getState().documents.tiabHandoff;
    expect(handoff?.running).toBe(false);
    expect(handoff?.error).toBeNull();
    expect(mockImportPickedSelections).not.toHaveBeenCalled();
  });

  test('Picker で空配列が確定してもキャンセル扱い（running のみ false へ戻す）', async () => {
    const store = withHandoff();
    mockReadTiabSheet.mockResolvedValue(includedSheetResponse());
    mockOpenProjectFilesPicker.mockResolvedValue([]);

    await runTiabHandoffImport(store, makeDeps());

    const handoff = store.getState().documents.tiabHandoff;
    expect(handoff?.running).toBe(false);
    expect(handoff?.error).toBeNull();
    expect(mockImportPickedSelections).not.toHaveBeenCalled();
  });

  test('importPickedSelections が false（別の取り込みと競合）なら busy エラーで打ち切り、preview は実行しない', async () => {
    const store = withHandoff();
    mockReadTiabSheet.mockResolvedValue(includedSheetResponse());
    const selections = [{ sourceFileId: 'src-9', filename: 'a.pdf' }];
    mockOpenProjectFilesPicker.mockResolvedValue(selections);
    mockImportPickedSelections.mockResolvedValue(false);

    await runTiabHandoffImport(store, makeDeps());

    expect(mockImportPickedSelections).toHaveBeenCalledWith(store, expect.anything(), selections);
    // readTiabSheet は fulltext 列挙用の 1 回だけ（busy で打ち切るため previewTiabImport は呼ばれない）
    expect(mockReadTiabSheet).toHaveBeenCalledTimes(1);
    const handoff = store.getState().documents.tiabHandoff;
    expect(handoff?.running).toBe(false);
    expect(handoff?.error).toBe(t('documents.tiabHandoffBusy'));
    // openTiabImport / previewTiabImport は呼ばれていない
    const tiab = store.getState().documents.tiabImport;
    expect(tiab.open).toBe(false);
    expect(tiab.plan).toBeNull();
  });

  test('成功フロー: importPickedSelections → openTiabImport → previewTiabImport の順で呼ばれる（readTiabSheet は 1 回だけ）', async () => {
    const store = withHandoff();
    mockReadTiabSheet.mockResolvedValue(includedSheetResponse());
    const selections = [{ sourceFileId: 'src-9', filename: 'a.pdf' }];
    mockOpenProjectFilesPicker.mockResolvedValue(selections);
    mockImportPickedSelections.mockResolvedValue(true);

    await runTiabHandoffImport(store, makeDeps());

    expect(mockImportPickedSelections).toHaveBeenCalledWith(store, expect.anything(), selections);
    // previewTiabImport には直前に読んだ sheet（prefetched）を渡すため、readTiabSheet は
    // fulltext 列挙用の 1 回だけで済む（Sheets API の往復を 1 回に抑える）
    expect(mockReadTiabSheet).toHaveBeenCalledTimes(1);

    // openTiabImport が呼ばれた証跡（previewTiabImport 自体は open を触らない）
    const tiab = store.getState().documents.tiabImport;
    expect(tiab.open).toBe(true);
    // previewTiabImport が成功した証跡（prefetched のシートから計算した反映プレビューの自動実行）
    expect(tiab.plan?.includeCount).toBe(1);
    expect(tiab.sheetInput).toBe(HANDOFF_SHEET_ID);

    const handoff = store.getState().documents.tiabHandoff;
    expect(handoff?.running).toBe(false);
    expect(handoff?.error).toBeNull();
  });

  test('例外（readTiabSheet の失敗）は running: false + error にする', async () => {
    const store = withHandoff();
    mockReadTiabSheet.mockRejectedValue(new Error('sheet down'));

    await runTiabHandoffImport(store, makeDeps());

    const handoff = store.getState().documents.tiabHandoff;
    expect(handoff?.running).toBe(false);
    expect(handoff?.error).toBe('sheet down');
  });

  test('Picker 起動自体の失敗も同じ catch でエラー案内する（トーストは出さない）', async () => {
    const store = withHandoff();
    mockReadTiabSheet.mockResolvedValue(includedSheetResponse());
    mockOpenProjectFilesPicker.mockRejectedValue(new Error('picker offline'));

    await runTiabHandoffImport(store, makeDeps());

    const handoff = store.getState().documents.tiabHandoff;
    expect(handoff?.running).toBe(false);
    expect(handoff?.error).toBe('picker offline');
    expect(document.body.textContent ?? '').not.toContain('picker offline');
  });

  test('実行中に「この案内を閉じる」が呼ばれた（tiabHandoff が null になった）ら以降のパッチは no-op', async () => {
    const store = withHandoff();
    mockReadTiabSheet.mockImplementation(async () => {
      // readTiabSheet 呼び出し中に dismissTiabHandoff 相当の状態変化が起きた状況を模す
      store.setState({ documents: { ...store.getState().documents, tiabHandoff: null } });
      return includedSheetResponse(null);
    });

    await runTiabHandoffImport(store, makeDeps());

    // running: true への最初のパッチは実行済みだが、以降（fulltext 0 件のエラーパッチ）は
    // tiabHandoff が null のため反映されず null のまま
    expect(store.getState().documents.tiabHandoff).toBeNull();
  });
});

describe('dismissTiabHandoff（「この案内を閉じる」）', () => {
  test('storage の引き継ぎ状態（プロジェクト単位キー）を破棄して tiabHandoff を null にする', async () => {
    const store = withHandoff();

    await dismissTiabHandoff(store);

    expect(mockRemoveLocal).toHaveBeenCalledWith(tiabHandoffKey('p1'));
    expect(store.getState().documents.tiabHandoff).toBeNull();
    // 他スライスは維持する
    expect(store.getState().documents.tiabImport.open).toBe(false);
  });

  test('プロジェクト未選択なら storage には触らず state だけ null にする', async () => {
    const store = withHandoff({}, { withProject: false });

    await dismissTiabHandoff(store);

    expect(mockRemoveLocal).not.toHaveBeenCalled();
    expect(store.getState().documents.tiabHandoff).toBeNull();
  });
});
