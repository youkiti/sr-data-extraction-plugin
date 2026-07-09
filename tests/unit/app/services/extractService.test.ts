import {
  cancelExtractConfirm,
  initExtractSelection,
  loadExtractTargets,
  requestExtractRun,
  retryExtractStudy,
  runExtract,
  setExtractModel,
  toggleExtractStudy,
  type ExtractServiceDeps,
} from '../../../../src/app/services/extractService';
import { runExtraction } from '../../../../src/app/services/extractionService';
import { resolveProtocol } from '../../../../src/app/services/schemaService';
import { createInitialState, createStore, type Store } from '../../../../src/app/store';
import type { DocumentRecord } from '../../../../src/domain/document';
import type { Evidence } from '../../../../src/domain/evidence';
import type { ExtractionRun } from '../../../../src/domain/extractionRun';
import type { SchemaField } from '../../../../src/domain/schemaField';
import type { StudyRecord } from '../../../../src/domain/study';
import { readDocuments } from '../../../../src/features/documents/documentRepository';
import { readStudies } from '../../../../src/features/documents/studyRepository';
import { readRunStudyCoverage } from '../../../../src/features/extraction/runRepository';
import { ensureChildFolder } from '../../../../src/lib/google/drive';

jest.mock('../../../../src/app/services/extractionService', () => ({
  runExtraction: jest.fn(),
}));
jest.mock('../../../../src/app/services/schemaService', () => ({
  resolveProtocol: jest.fn(),
}));
jest.mock('../../../../src/features/documents/documentRepository', () => ({
  readDocuments: jest.fn(),
}));
jest.mock('../../../../src/features/documents/studyRepository', () => ({
  ...jest.requireActual('../../../../src/features/documents/studyRepository'),
  readStudies: jest.fn(),
}));
jest.mock('../../../../src/features/extraction/runRepository', () => ({
  readRunStudyCoverage: jest.fn(),
}));
jest.mock('../../../../src/lib/google/drive', () => ({
  ensureChildFolder: jest.fn(),
}));

const runExtractionMock = runExtraction as jest.MockedFunction<typeof runExtraction>;
const resolveProtocolMock = resolveProtocol as jest.MockedFunction<typeof resolveProtocol>;
const readDocumentsMock = readDocuments as jest.MockedFunction<typeof readDocuments>;
const readStudiesMock = readStudies as jest.MockedFunction<typeof readStudies>;
const readCoverageMock = readRunStudyCoverage as jest.MockedFunction<typeof readRunStudyCoverage>;
const ensureChildFolderMock = ensureChildFolder as jest.MockedFunction<typeof ensureChildFolder>;

/** doc-1 → study-doc-1（1 文書 = 1 study の既定） */
function studyIdOf(documentId: string): string {
  return `study-${documentId}`;
}

function makeDocument(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  const documentId = overrides.documentId ?? 'doc-1';
  return {
    documentId,
    studyId: studyIdOf(documentId),
    documentRole: 'article',
    driveFileId: 'drive-1',
    sourceFileId: 'src-1',
    filename: 'smith2020.pdf',
    pmid: null,
    doi: null,
    textRef: 'https://drive.google.com/file/d/txt-1/view',
    textStatus: 'ok',
    pageCount: 2,
    charCount: 1000,
    importedAt: 't0',
    importedBy: 'me@example.com',
    note: null,
    ...overrides,
  };
}

function makeStudy(studyId: string, overrides: Partial<StudyRecord> = {}): StudyRecord {
  return {
    studyId,
    studyLabel: `label-${studyId}`,
    registrationId: null,
    createdAt: 't0',
    createdBy: 'me@example.com',
    note: null,
    ...overrides,
  };
}

/** documents から一意 study を導出する（テスト用の既定 studies） */
function studiesFor(documents: readonly DocumentRecord[]): StudyRecord[] {
  const ids = [...new Set(documents.map((d) => d.studyId))];
  return ids.map((id) => makeStudy(id));
}

function makeField(overrides: Partial<SchemaField> = {}): SchemaField {
  return {
    schemaVersion: 1,
    fieldId: 'f-total',
    fieldIndex: 1,
    section: 'methods',
    fieldName: 'sample_size_total',
    fieldLabel: '総サンプルサイズ',
    entityLevel: 'study',
    dataType: 'integer',
    unit: null,
    allowedValues: null,
    required: true,
    extractionInstruction: '総 N を抽出',
    example: null,
    aiGenerated: false,
    note: null,
    ...overrides,
  };
}

function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    evidenceId: 'ev-1',
    runId: 'run-1',
    studyId: 'study-doc-1',
    documentId: 'doc-1',
    fieldId: 'f-total',
    entityKey: '-',
    value: '120',
    notReported: false,
    quote: 'a total of 120',
    page: 1,
    confidence: 'high',
    anchorStatus: 'exact',
    ...overrides,
  };
}

function makeRun(overrides: Partial<ExtractionRun> = {}): ExtractionRun {
  return {
    runId: 'run-1',
    runType: 'full',
    schemaVersion: 1,
    studyIds: ['study-doc-1'],
    provider: 'gemini',
    requestedModel: 'gemini-test',
    modelVersion: 'gemini-test-001',
    inputMode: 'text_only',
    status: 'done',
    startedAt: 't1',
    finishedAt: 't2',
    tokensIn: 100,
    tokensOut: 50,
    costEstimate: 0.01,
    ...overrides,
  };
}

function makeOutcome(
  overrides: {
    status?: 'done' | 'partial_failure';
    studyIds?: string[];
    evidence?: Evidence[];
    rejectedItems?: unknown[];
  } = {},
) {
  const status = overrides.status ?? 'done';
  return {
    run: makeRun({ status, studyIds: overrides.studyIds ?? ['study-doc-1'] }),
    plan: {
      schemaVersion: 1,
      model: 'gemini-test',
      batches: [],
      skippedDocuments: [],
      tokensInEstimate: 100,
      tokensOutEstimate: 10,
      costEstimateUsd: 0.01,
      warnings: [],
    },
    result: {
      runId: 'run-1',
      status,
      evidence: overrides.evidence ?? [makeEvidence()],
      rejectedItems: (overrides.rejectedItems ?? []) as never[],
      batchFailures: [],
      tokensIn: 100,
      tokensOut: 50,
      modelVersion: 'gemini-test-001',
    },
  };
}

function makeDeps(overrides: Partial<ExtractServiceDeps> = {}): ExtractServiceDeps {
  return {
    google: { fetch: jest.fn(), getAccessToken: jest.fn() },
    profile: { getProfileUserInfo: jest.fn() } as unknown as ExtractServiceDeps['profile'],
    loadApiKey: jest.fn().mockResolvedValue('api-key'),
    buildProvider: jest.fn(),
    newUuid: () => 'uuid-1',
    now: () => 't-now',
    ...overrides,
  };
}

function makeStore(patch: {
  withProject?: boolean;
  documents?: DocumentRecord[] | null;
  studies?: StudyRecord[] | null;
  fields?: SchemaField[] | null;
  pilotModel?: string;
  schemaModel?: string;
  extract?: Partial<ReturnType<typeof createInitialState>['extract']>;
}): Store {
  const state = createInitialState();
  if (patch.withProject !== false) {
    state.currentProject = {
      projectId: 'p1',
      spreadsheetId: 'sheet-1',
      driveFolderId: 'folder-1',
      name: 'テスト SR',
    };
  }
  const records = patch.documents ?? null;
  const studies =
    patch.studies !== undefined ? patch.studies : records === null ? null : studiesFor(records);
  state.documents = { ...state.documents, records, studies };
  state.schema = {
    ...state.schema,
    currentFields: patch.fields ?? null,
    model: patch.schemaModel ?? '',
  };
  state.pilot = { ...state.pilot, model: patch.pilotModel ?? '' };
  state.extract = { ...state.extract, ...(patch.extract ?? {}) };
  return createStore(state);
}

beforeEach(() => {
  resolveProtocolMock.mockResolvedValue({
    protocol: { version: 1 } as never,
    text: 'PROTOCOL TEXT',
  });
  ensureChildFolderMock.mockImplementation(async (name: string) => ({
    id: `${name}-id`,
    webViewLink: `https://drive.example/${name}`,
  }));
  readCoverageMock.mockResolvedValue({ extracted: new Set(), interrupted: new Set() });
  readDocumentsMock.mockResolvedValue([]);
  readStudiesMock.mockResolvedValue([]);
});

describe('loadExtractTargets', () => {
  test('ExtractionRuns の study カバレッジをそのまま抽出済み / 中断 study にする', async () => {
    readCoverageMock.mockResolvedValue({
      extracted: new Set(['study-doc-1']),
      interrupted: new Set(['study-doc-2']),
    });
    const store = makeStore({
      documents: [makeDocument({ documentId: 'doc-1' }), makeDocument({ documentId: 'doc-2' })],
    });
    await loadExtractTargets(store, makeDeps());
    expect(store.getState().extract.extractedStudyIds).toEqual(['study-doc-1']);
    expect(store.getState().extract.interruptedStudyIds).toEqual(['study-doc-2']);
    expect(store.getState().extract.loading).toBe(false);
  });

  test('プロジェクト未選択・読込中は何もしない', async () => {
    await loadExtractTargets(makeStore({ withProject: false }), makeDeps());
    await loadExtractTargets(makeStore({ extract: { loading: true } }), makeDeps());
    expect(readCoverageMock).not.toHaveBeenCalled();
  });

  test('読込済みは no-op、force 指定で再読込する', async () => {
    const store = makeStore({ extract: { extractedStudyIds: [] } });
    await loadExtractTargets(store, makeDeps());
    expect(readCoverageMock).not.toHaveBeenCalled();
    await loadExtractTargets(store, makeDeps(), { force: true });
    expect(readCoverageMock).toHaveBeenCalledTimes(1);
  });

  test('documents / studies 未読込なら読み込んで documents スライスへ反映する', async () => {
    readDocumentsMock.mockResolvedValue([makeDocument()]);
    readStudiesMock.mockResolvedValue([makeStudy('study-doc-1')]);
    const store = makeStore({ documents: null });
    await loadExtractTargets(store, makeDeps());
    expect(store.getState().documents.records?.map((d) => d.documentId)).toEqual(['doc-1']);
    expect(store.getState().documents.studies?.map((s) => s.studyId)).toEqual(['study-doc-1']);
  });

  test('読込失敗は loadError に理由を入れる', async () => {
    readCoverageMock.mockRejectedValue(new Error('boom'));
    const store = makeStore({});
    await loadExtractTargets(store, makeDeps());
    expect(store.getState().extract.loadError).toBe('boom');
    expect(store.getState().extract.loading).toBe(false);
  });
});

describe('initExtractSelection', () => {
  test('テキスト層があり未抽出の全 study を既定選択し、S6 のモデル入力を引き継ぐ', () => {
    const docs = [
      makeDocument({ documentId: 'd1' }),
      makeDocument({ documentId: 'd2', textStatus: 'no_text_layer' }),
      makeDocument({ documentId: 'd3' }),
      makeDocument({ documentId: 'd4' }),
    ];
    const store = makeStore({
      documents: docs,
      pilotModel: 'gemini-from-s6',
      extract: { extractedStudyIds: [studyIdOf('d3')] },
    });
    initExtractSelection(store);
    expect(store.getState().extract.selectedStudyIds).toEqual([studyIdOf('d1'), studyIdOf('d4')]);
    expect(store.getState().extract.model).toBe('gemini-from-s6');
    expect(store.getState().extract.selectionInitialized).toBe(true);
  });

  test('S6 のモデル入力がなければ S5 を引き継ぎ、ユーザー入力済みは上書きしない', () => {
    const base = {
      documents: [makeDocument()],
      extract: { extractedStudyIds: [] as string[] },
    };
    const fromSchema = makeStore({ ...base, schemaModel: 'gemini-from-s5' });
    initExtractSelection(fromSchema);
    expect(fromSchema.getState().extract.model).toBe('gemini-from-s5');

    const userInput = makeStore({
      ...base,
      schemaModel: 'gemini-from-s5',
      extract: { ...base.extract, model: 'user-model' },
    });
    initExtractSelection(userInput);
    expect(userInput.getState().extract.model).toBe('user-model');
  });

  test('初期化済み・文献未読込・抽出済み未読込のときは何もしない', () => {
    const initialized = makeStore({
      documents: [makeDocument()],
      extract: { selectionInitialized: true, extractedStudyIds: [] },
    });
    initExtractSelection(initialized);
    expect(initialized.getState().extract.selectedStudyIds).toEqual([]);

    const noDocs = makeStore({ documents: null, extract: { extractedStudyIds: [] } });
    initExtractSelection(noDocs);
    expect(noDocs.getState().extract.selectionInitialized).toBe(false);

    const noRuns = makeStore({ documents: [makeDocument()] });
    initExtractSelection(noRuns);
    expect(noRuns.getState().extract.selectionInitialized).toBe(false);
  });
});

describe('toggleExtractStudy / setExtractModel', () => {
  test('選択・重複追加・解除（上限なし）', () => {
    const store = makeStore({ extract: { selectedStudyIds: ['s1', 's2', 's3'] } });
    toggleExtractStudy(store, 's4', true);
    expect(store.getState().extract.selectedStudyIds).toEqual(['s1', 's2', 's3', 's4']);
    toggleExtractStudy(store, 's4', true); // 重複は無視
    expect(store.getState().extract.selectedStudyIds).toEqual(['s1', 's2', 's3', 's4']);
    toggleExtractStudy(store, 's2', false);
    expect(store.getState().extract.selectedStudyIds).toEqual(['s1', 's3', 's4']);
  });

  test('モデル名は trim して保存する', () => {
    const store = makeStore({});
    setExtractModel(store, '  gemini-x  ');
    expect(store.getState().extract.model).toBe('gemini-x');
  });
});

describe('requestExtractRun / cancelExtractConfirm', () => {
  test('検証を通れば確認カードを開く（runError はクリア）', async () => {
    const store = makeStore({
      fields: [makeField()],
      extract: { selectedStudyIds: ['study-doc-1'], model: 'gemini-test', runError: '前回のエラー' },
    });
    await requestExtractRun(store, makeDeps());
    expect(store.getState().extract.confirming).toBe(true);
    expect(store.getState().extract.runError).toBeNull();
  });

  test('実行中・再試行中は何もしない', async () => {
    const running = makeStore({ extract: { running: true } });
    await requestExtractRun(running, makeDeps());
    expect(running.getState().extract.confirming).toBe(false);

    const retrying = makeStore({ extract: { retryingStudyId: 'study-doc-1' } });
    await requestExtractRun(retrying, makeDeps());
    expect(retrying.getState().extract.confirming).toBe(false);
  });

  test('スキーマ未読込（null / 空）・対象 0 件・モデル未入力・API キー未設定はインラインエラー', async () => {
    for (const fields of [null, [] as SchemaField[]]) {
      const store = makeStore({ fields });
      await requestExtractRun(store, makeDeps());
      expect(store.getState().extract.runError).toContain('確定済みスキーマを読み込めていません');
    }

    const noSelection = makeStore({ fields: [makeField()], extract: { selectedStudyIds: [] } });
    await requestExtractRun(noSelection, makeDeps());
    expect(noSelection.getState().extract.runError).toContain('対象 study を 1 件以上');

    const noModel = makeStore({
      fields: [makeField()],
      extract: { selectedStudyIds: ['study-doc-1'], model: '' },
    });
    await requestExtractRun(noModel, makeDeps());
    expect(noModel.getState().extract.runError).toContain('モデルを選択してください');

    const noKey = makeStore({
      fields: [makeField()],
      extract: { selectedStudyIds: ['study-doc-1'], model: 'gemini-test' },
    });
    await requestExtractRun(noKey, makeDeps({ loadApiKey: jest.fn().mockResolvedValue(null) }));
    expect(noKey.getState().extract.runError).toContain('Gemini API キーが未設定です');
    expect(noKey.getState().extract.confirming).toBe(false);
  });

  test('キャンセルで確認カードを閉じる', () => {
    const store = makeStore({ extract: { confirming: true } });
    cancelExtractConfirm(store);
    expect(store.getState().extract.confirming).toBe(false);
  });
});

describe('runExtract', () => {
  function makeReadyStore(
    extra: Partial<ReturnType<typeof createInitialState>['extract']> = {},
  ): Store {
    return makeStore({
      documents: [makeDocument(), makeDocument({ documentId: 'doc-2' })],
      fields: [makeField()],
      extract: {
        selectedStudyIds: ['study-doc-1'],
        model: 'gemini-test',
        confirming: true,
        extractedStudyIds: [],
        ...extra,
      },
    });
  }

  test('プロジェクト未選択・実行中・再試行中・スキーマ未読込は何もしない', async () => {
    await runExtract(makeStore({ withProject: false }), makeDeps());
    await runExtract(makeStore({ fields: [makeField()], extract: { running: true } }), makeDeps());
    await runExtract(
      makeStore({ fields: [makeField()], extract: { retryingStudyId: 'study-doc-1' } }),
      makeDeps(),
    );
    await runExtract(makeStore({ fields: null }), makeDeps());
    expect(runExtractionMock).not.toHaveBeenCalled();
  });

  test('API キー未設定は確認カードを閉じてインラインエラー', async () => {
    const store = makeReadyStore();
    await runExtract(store, makeDeps({ loadApiKey: jest.fn().mockResolvedValue(null) }));
    expect(store.getState().extract.confirming).toBe(false);
    expect(store.getState().extract.runError).toContain('Gemini API キーが未設定です');
    expect(runExtractionMock).not.toHaveBeenCalled();
  });

  test('runExtraction を full 設定で呼び、counts・抽出済み・run 結果を反映する', async () => {
    const store = makeReadyStore();
    runExtractionMock.mockResolvedValue(makeOutcome());
    await runExtract(store, makeDeps());

    expect(runExtractionMock).toHaveBeenCalledTimes(1);
    const [params] = runExtractionMock.mock.calls[0] as unknown as [
      Parameters<typeof runExtraction>[0],
    ];
    expect(params).toMatchObject({
      spreadsheetId: 'sheet-1',
      logsLlmFolderId: 'llm-id',
      runType: 'full',
      model: 'gemini-test',
      protocolContext: 'PROTOCOL TEXT',
    });
    // 選択 study（study-doc-1）配下の文書だけが対象
    expect(params.documents.map((doc) => doc.documentId)).toEqual(['doc-1']);

    const state = store.getState();
    expect(state.counts).toMatchObject({ evidenceRows: 1, dataRows: 1 });
    expect(state.extract.running).toBe(false);
    expect(state.extract.confirming).toBe(false);
    expect(state.extract.run?.runId).toBe('run-1');
    expect(state.extract.extractedStudyIds).toEqual(['study-doc-1']);
    // 進捗イベントなしでは初期化直後の待機中のまま（実運用では executeRun が全バッチを通知する）
    expect(state.extract.studyRows).toEqual([
      {
        studyId: 'study-doc-1',
        status: 'queued',
        completedBatches: 0,
        totalBatches: 1,
        detail: null,
      },
    ]);
  });

  test('documents 未読込なら readDocuments / readStudies で解決する', async () => {
    const store = makeStore({
      documents: null,
      fields: [makeField()],
      extract: {
        selectedStudyIds: ['study-doc-1'],
        model: 'gemini-test',
        extractedStudyIds: null,
      },
    });
    readDocumentsMock.mockResolvedValue([makeDocument()]);
    readStudiesMock.mockResolvedValue([makeStudy('study-doc-1')]);
    runExtractionMock.mockResolvedValue(makeOutcome());
    await runExtract(store, makeDeps());
    expect(readDocumentsMock).toHaveBeenCalledWith('sheet-1', expect.anything());
    expect(store.getState().extract.run?.runId).toBe('run-1');
  });

  test('進捗コールバックが progress と studyRows を更新し、失敗バッチは failed 行になる', async () => {
    const store = makeReadyStore({ selectedStudyIds: ['study-doc-1', 'study-doc-2'] });
    let observedRows: unknown = null;
    runExtractionMock.mockImplementation(async (params) => {
      params.onProgress?.({
        totalBatches: 2,
        completedBatches: 1,
        studyId: 'study-doc-1',
        section: null,
        failure: null,
      });
      params.onProgress?.({
        totalBatches: 2,
        completedBatches: 2,
        studyId: 'study-doc-2',
        section: null,
        failure: { studyId: 'study-doc-2', section: null, reason: 'api_error', detail: '500' },
      });
      observedRows = store.getState().extract.studyRows;
      return makeOutcome({ status: 'partial_failure', studyIds: ['study-doc-1', 'study-doc-2'] });
    });
    await runExtract(store, makeDeps());
    expect(observedRows).toEqual([
      {
        studyId: 'study-doc-1',
        status: 'done',
        completedBatches: 1,
        totalBatches: 1,
        detail: null,
      },
      {
        studyId: 'study-doc-2',
        status: 'failed',
        completedBatches: 1,
        totalBatches: 1,
        detail: 'api_error（500）',
      },
    ]);
    expect(store.getState().extract.progress).toBeNull();
    expect(store.getState().extract.studyRows).toHaveLength(2);
  });

  test('応答要素の破棄件数を rejectedCount に反映する', async () => {
    const store = makeReadyStore();
    runExtractionMock.mockResolvedValue(
      makeOutcome({ status: 'partial_failure', rejectedItems: [{}, {}] }),
    );
    await runExtract(store, makeDeps());
    expect(store.getState().extract.rejectedCount).toBe(2);
  });

  test('実行例外は runError に理由を入れて実行状態を解除する（Error 以外も文字列化）', async () => {
    const store = makeReadyStore();
    runExtractionMock.mockRejectedValue(new Error('LLM が応答しません'));
    await runExtract(store, makeDeps());
    expect(store.getState().extract.running).toBe(false);
    expect(store.getState().extract.runError).toBe('LLM が応答しません');

    const nonError = makeReadyStore();
    runExtractionMock.mockRejectedValue('文字列エラー');
    await runExtract(nonError, makeDeps());
    expect(nonError.getState().extract.runError).toBe('文字列エラー');
  });

  test('deps.now 未指定でも転記素材の updatedAt を現在時刻で組み立てて完走する', async () => {
    const store = makeReadyStore();
    runExtractionMock.mockResolvedValue(makeOutcome());
    await runExtract(store, makeDeps({ now: undefined }));
    expect(store.getState().extract.run?.runId).toBe('run-1');
  });
});

describe('retryExtractStudy', () => {
  function makeFailedStore(): Store {
    return makeStore({
      documents: [makeDocument(), makeDocument({ documentId: 'doc-2' })],
      fields: [makeField()],
      extract: {
        selectedStudyIds: ['study-doc-1', 'study-doc-2'],
        model: 'gemini-test',
        extractedStudyIds: ['study-doc-1'],
        run: makeRun({ status: 'partial_failure' }),
        studyRows: [
          {
            studyId: 'study-doc-1',
            status: 'done',
            completedBatches: 1,
            totalBatches: 1,
            detail: null,
          },
          {
            studyId: 'study-doc-2',
            status: 'failed',
            completedBatches: 1,
            totalBatches: 1,
            detail: 'api_error（500）',
          },
        ],
        rejectedCount: 1,
      },
    });
  }

  test('プロジェクト未選択・実行中・再試行中・スキーマ未読込は何もしない', async () => {
    await retryExtractStudy(makeStore({ withProject: false }), makeDeps(), 'study-doc-2');
    await retryExtractStudy(
      makeStore({ fields: [makeField()], extract: { running: true } }),
      makeDeps(),
      'study-doc-2',
    );
    await retryExtractStudy(
      makeStore({ fields: [makeField()], extract: { retryingStudyId: 'study-doc-1' } }),
      makeDeps(),
      'study-doc-2',
    );
    await retryExtractStudy(makeStore({ fields: null }), makeDeps(), 'study-doc-2');
    expect(runExtractionMock).not.toHaveBeenCalled();
  });

  test('API キー未設定はインラインエラー', async () => {
    const store = makeFailedStore();
    await retryExtractStudy(
      store,
      makeDeps({ loadApiKey: jest.fn().mockResolvedValue(null) }),
      'study-doc-2',
    );
    expect(store.getState().extract.runError).toContain('Gemini API キーが未設定です');
    expect(runExtractionMock).not.toHaveBeenCalled();
  });

  test('single_study run で再実行し、成功で対象行を完了に置き換える', async () => {
    const store = makeFailedStore();
    runExtractionMock.mockImplementation(async (params) => {
      params.onProgress?.({
        totalBatches: 1,
        completedBatches: 1,
        studyId: 'study-doc-2',
        section: null,
        failure: null,
      });
      return makeOutcome({ studyIds: ['study-doc-2'] });
    });
    await retryExtractStudy(store, makeDeps(), 'study-doc-2');

    const [params] = runExtractionMock.mock.calls[0] as unknown as [
      Parameters<typeof runExtraction>[0],
    ];
    expect(params.runType).toBe('single_study');
    expect(params.documents.map((doc) => doc.documentId)).toEqual(['doc-2']);

    const state = store.getState();
    expect(state.extract.retryingStudyId).toBeNull();
    expect(state.extract.studyRows).toEqual([
      {
        studyId: 'study-doc-1',
        status: 'done',
        completedBatches: 1,
        totalBatches: 1,
        detail: null,
      },
      {
        studyId: 'study-doc-2',
        status: 'done',
        completedBatches: 1,
        totalBatches: 1,
        detail: null,
      },
    ]);
    expect(state.extract.extractedStudyIds?.sort()).toEqual(['study-doc-1', 'study-doc-2']);
    expect(state.counts).toMatchObject({ evidenceRows: 1, dataRows: 1 });
  });

  test('再実行中は対象行を実行中として表示する（partial_failure の破棄件数は加算）', async () => {
    const store = makeFailedStore();
    let observedRows: unknown = null;
    runExtractionMock.mockImplementation(async () => {
      observedRows = store.getState().extract.studyRows;
      return makeOutcome({
        status: 'partial_failure',
        studyIds: ['study-doc-2'],
        rejectedItems: [{}],
      });
    });
    await retryExtractStudy(store, makeDeps(), 'study-doc-2');
    expect((observedRows as { status: string }[])[1]?.status).toBe('running');
    expect(store.getState().extract.rejectedCount).toBe(2);
  });

  test('study が見つからない・実行例外は対象行を失敗に戻して runError を出す', async () => {
    const missing = makeFailedStore();
    readDocumentsMock.mockResolvedValue([]);
    readStudiesMock.mockResolvedValue([]);
    missing.setState({
      documents: { ...missing.getState().documents, records: null, studies: null },
    });
    await retryExtractStudy(missing, makeDeps(), 'study-doc-2');
    expect(missing.getState().extract.runError).toContain('study-doc-2 の文書が見つかりません');
    expect(missing.getState().extract.studyRows[1]).toMatchObject({ status: 'failed' });
    expect(missing.getState().extract.retryingStudyId).toBeNull();

    const failing = makeFailedStore();
    runExtractionMock.mockRejectedValue(new Error('boom'));
    await retryExtractStudy(failing, makeDeps(), 'study-doc-2');
    expect(failing.getState().extract.studyRows[1]).toEqual({
      studyId: 'study-doc-2',
      status: 'failed',
      completedBatches: 0,
      totalBatches: 0,
      detail: 'boom',
    });
    expect(failing.getState().extract.retryingStudyId).toBeNull();
  });
});
