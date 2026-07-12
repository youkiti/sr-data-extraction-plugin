import {
  autoLoadLatestPilotRun,
  initPilotSelection,
  loadPilotHistory,
  loadPilotRun,
  loadPilotVerification,
  persistPilotArmConfirmation,
  persistPilotDecision,
  persistPilotInstanceDeclarations,
  persistPilotRelocateQuote,
  runPilot,
  setPilotLayoutMode,
  setPilotModel,
  togglePilotStudy,
  type PilotServiceDeps,
} from '../../../../src/app/services/pilotService';
import {
  resultsCellKeyOf,
  type QueuedDecisionWrite,
} from '../../../../src/app/services/verificationService';
import { runExtraction } from '../../../../src/app/services/extractionService';
import { relocateQuote } from '../../../../src/app/services/relocateQuoteService';
import { resolveProtocol } from '../../../../src/app/services/schemaService';
import { createInitialState, createStore, type Store } from '../../../../src/app/store';
import type { Decision } from '../../../../src/domain/decision';
import type { DocumentRecord } from '../../../../src/domain/document';
import type { Evidence } from '../../../../src/domain/evidence';
import type { ExtractionRun } from '../../../../src/domain/extractionRun';
import type { SchemaField } from '../../../../src/domain/schemaField';
import type { StudyRecord } from '../../../../src/domain/study';
import { readDocuments } from '../../../../src/features/documents/documentRepository';
import { readStudies } from '../../../../src/features/documents/studyRepository';
import { readEvidenceRows } from '../../../../src/features/extraction/evidenceRepository';
import { readPilotRuns } from '../../../../src/features/extraction/runRepository';
import { getSchemaFieldsByVersion } from '../../../../src/features/schema/schemaRepository';
import type { DisposablePdfDocument } from '../../../../src/features/documents/extractTextLayer';
import {
  AnnotationConflictError,
  readResultsDataRows,
  readStudyDataSheet,
  upsertResultsDataRows,
  upsertStudyDataRows,
} from '../../../../src/features/extraction/annotationRepository';
import {
  appendArmStructureVersion,
  readArmStructuresByStudy,
} from '../../../../src/features/verification/armStructureRepository';
import {
  appendDecisionRows,
  readDecisionsByStudy,
} from '../../../../src/features/verification/decisionRepository';
import type { VerificationData } from '../../../../src/features/verification/types';
import { ensureChildFolder, getFileBinary, getFileText } from '../../../../src/lib/google/drive';
import { getCurrentUserEmail } from '../../../../src/lib/google/identity';
import type { OfflineQueue } from '../../../../src/lib/storage/offlineQueue';

// pilotService → makeLoadDocumentPageImages → lib/pdf/loadPdf 経由で
// pdfjs-dist（ESM 専用）が require されるのを防ぐ（bootstrap.test.ts と同じ対策。
// loadDocumentPageImages 自体の挙動は tests/unit/features/documents/loadDocumentPageImages.test.ts で検証済み）
jest.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: jest.fn(),
}));
jest.mock('../../../../src/app/services/extractionService', () => ({
  runExtraction: jest.fn(),
}));
jest.mock('../../../../src/app/services/schemaService', () => ({
  resolveProtocol: jest.fn(),
}));
jest.mock('../../../../src/app/services/relocateQuoteService', () => ({
  relocateQuote: jest.fn(),
}));
jest.mock('../../../../src/features/documents/documentRepository', () => ({
  readDocuments: jest.fn(),
}));
jest.mock('../../../../src/features/documents/studyRepository', () => ({
  // resolveActiveStudies / studyLabelMap は純粋関数なので実物を使う
  ...jest.requireActual('../../../../src/features/documents/studyRepository'),
  readStudies: jest.fn(),
}));
jest.mock('../../../../src/features/extraction/evidenceRepository', () => ({
  readEvidenceRows: jest.fn(),
}));
jest.mock('../../../../src/features/extraction/runRepository', () => ({
  readPilotRuns: jest.fn(),
}));
jest.mock('../../../../src/features/schema/schemaRepository', () => ({
  getSchemaFieldsByVersion: jest.fn(),
}));
jest.mock('../../../../src/features/extraction/annotationRepository', () => ({
  ...jest.requireActual('../../../../src/features/extraction/annotationRepository'),
  readResultsDataRows: jest.fn(),
  readStudyDataSheet: jest.fn(),
  upsertResultsDataRows: jest.fn(),
  upsertStudyDataRows: jest.fn(),
}));
jest.mock('../../../../src/features/verification/decisionRepository', () => ({
  appendDecisionRows: jest.fn(),
  readDecisionsByStudy: jest.fn(),
}));
jest.mock('../../../../src/features/verification/armStructureRepository', () => ({
  // latestArmStructure は純粋関数なので実物を使う
  ...jest.requireActual('../../../../src/features/verification/armStructureRepository'),
  appendArmStructureVersion: jest.fn(),
  readArmStructuresByStudy: jest.fn(),
}));
jest.mock('../../../../src/lib/google/drive', () => ({
  ensureChildFolder: jest.fn(),
  getFileBinary: jest.fn(),
  getFileText: jest.fn(),
}));
jest.mock('../../../../src/lib/google/identity', () => ({
  getCurrentUserEmail: jest.fn(),
}));

const runExtractionMock = runExtraction as jest.MockedFunction<typeof runExtraction>;
const resolveProtocolMock = resolveProtocol as jest.MockedFunction<typeof resolveProtocol>;
const relocateQuoteMock = relocateQuote as jest.MockedFunction<typeof relocateQuote>;
const readDocumentsMock = readDocuments as jest.MockedFunction<typeof readDocuments>;
const readStudiesMock = readStudies as jest.MockedFunction<typeof readStudies>;
const readEvidenceRowsMock = readEvidenceRows as jest.MockedFunction<typeof readEvidenceRows>;
const readPilotRunsMock = readPilotRuns as jest.MockedFunction<typeof readPilotRuns>;
const getSchemaFieldsByVersionMock = getSchemaFieldsByVersion as jest.MockedFunction<
  typeof getSchemaFieldsByVersion
>;
const readStudyDataSheetMock = readStudyDataSheet as jest.MockedFunction<typeof readStudyDataSheet>;
const readResultsDataRowsMock = readResultsDataRows as jest.MockedFunction<typeof readResultsDataRows>;
const upsertStudyMock = upsertStudyDataRows as jest.MockedFunction<typeof upsertStudyDataRows>;
const upsertResultsMock = upsertResultsDataRows as jest.MockedFunction<
  typeof upsertResultsDataRows
>;
const appendDecisionsMock = appendDecisionRows as jest.MockedFunction<typeof appendDecisionRows>;
const readDecisionsMock = readDecisionsByStudy as jest.MockedFunction<
  typeof readDecisionsByStudy
>;
const appendArmVersionMock = appendArmStructureVersion as jest.MockedFunction<
  typeof appendArmStructureVersion
>;
const readArmStructuresMock = readArmStructuresByStudy as jest.MockedFunction<
  typeof readArmStructuresByStudy
>;
const ensureChildFolderMock = ensureChildFolder as jest.MockedFunction<typeof ensureChildFolder>;
const getFileBinaryMock = getFileBinary as jest.MockedFunction<typeof getFileBinary>;
const getFileTextMock = getFileText as jest.MockedFunction<typeof getFileText>;
const getCurrentUserEmailMock = getCurrentUserEmail as jest.MockedFunction<
  typeof getCurrentUserEmail
>;

const ME = 'me@example.com';

function makeDocument(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  // フェーズ 1 は 1 文書 = 1 study。文書ごとに一意な study_id を自動採番する
  const documentId = overrides.documentId ?? 'doc-1';
  return {
    documentId,
    studyId: `study-${documentId}`,
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
    importedBy: ME,
    note: null,
    ...overrides,
  };
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
    bboxPage: null,
    bbox: null,
    relocatedFrom: null,
    ...overrides,
  };
}

function makeRun(overrides: Partial<ExtractionRun> = {}): ExtractionRun {
  return {
    runId: 'run-1',
    runType: 'pilot',
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
    fieldIds: null,
    ...overrides,
  };
}

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    decidedAt: 't-now',
    decidedBy: ME,
    studyId: 'study-doc-1',
    fieldId: 'f-total',
    entityKey: '-',
    annotator: ME,
    annotatorType: 'human_with_ai',
    schemaVersion: 1,
    action: 'accept',
    value: '120',
    note: null,
    ...overrides,
  };
}

function makePdf(): DisposablePdfDocument {
  return {
    numPages: 1,
    getPage: jest.fn().mockResolvedValue({
      getViewport: () => ({ width: 612, height: 792 }),
      getTextContent: async () => ({
        items: [
          { str: 'a total of 120', transform: [1, 0, 0, 1, 0, 700], width: 140, height: 10, hasEOL: false },
        ],
      }),
      cleanup: jest.fn(),
    }),
    destroy: jest.fn().mockResolvedValue(undefined),
  };
}

/** persistPilotRelocateQuote のテスト用最小 VerificationData（issue #94） */
function makeVerificationData(overrides: Partial<VerificationData> = {}): VerificationData {
  return {
    study: {
      studyId: 'study-doc-1',
      studyLabel: 'Smith 2020',
      registrationId: null,
      createdAt: 't0',
      createdBy: ME,
      note: null,
    },
    documents: [
      {
        document: makeDocument(),
        extractedPages: [{ page: 1, text: 'a total of 120 patients' }],
        extractedTextError: null,
      },
    ],
    fields: [makeField()],
    evidence: [makeEvidence()],
    decisions: [],
    annotator: ME,
    annotatorType: 'human_with_ai',
    schemaVersion: 1,
    armStructure: null,
    loadPdfView: jest.fn(),
    retryPdfView: jest.fn(),
    ...overrides,
  };
}

function makeQueue(): jest.Mocked<OfflineQueue<QueuedDecisionWrite>> {
  return {
    enqueue: jest.fn().mockResolvedValue(undefined),
    flush: jest.fn().mockResolvedValue({ flushedCount: 0, remainingCount: 0 }),
  };
}

function makeDeps(overrides: Partial<PilotServiceDeps> = {}): PilotServiceDeps {
  return {
    google: { fetch: jest.fn(), getAccessToken: jest.fn() },
    profile: { getProfileUserInfo: jest.fn() } as unknown as PilotServiceDeps['profile'],
    loadApiKey: jest.fn().mockResolvedValue('api-key'),
    buildProvider: jest.fn(),
    loadPdf: jest.fn().mockResolvedValue(makePdf()),
    decisionQueue: makeQueue(),
    newUuid: () => 'uuid-1',
    now: () => 't-now',
    ...overrides,
  };
}

/** documents から一意 study を導出する（テスト用の既定 studies） */
function studiesFor(documents: readonly DocumentRecord[]): StudyRecord[] {
  const ids = [...new Set(documents.map((d) => d.studyId))];
  return ids.map((studyId) => ({
    studyId,
    studyLabel: `label-${studyId}`,
    registrationId: null,
    createdAt: 't0',
    createdBy: ME,
    note: null,
  }));
}

function makeStore(patch: {
  withProject?: boolean;
  documents?: DocumentRecord[] | null;
  studies?: StudyRecord[] | null;
  fields?: SchemaField[] | null;
  pilot?: Partial<ReturnType<typeof createInitialState>['pilot']>;
  schemaModel?: string;
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
  state.pilot = { ...state.pilot, ...(patch.pilot ?? {}) };
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
  readDecisionsMock.mockResolvedValue([]);
  readStudiesMock.mockResolvedValue([]);
  readStudyDataSheetMock.mockResolvedValue({ fieldNames: [], rows: [] });
  readResultsDataRowsMock.mockResolvedValue([]);
  readArmStructuresMock.mockResolvedValue([]);
  getFileBinaryMock.mockResolvedValue(new ArrayBuffer(8));
  getFileTextMock.mockResolvedValue('');
  getCurrentUserEmailMock.mockResolvedValue(ME);
});

describe('initPilotSelection', () => {
  test('テキスト層のある先頭 3 study を既定選択し、S5 のモデル入力を引き継ぐ', () => {
    const docs = [
      makeDocument({ documentId: 'd1' }),
      makeDocument({ documentId: 'd2', textStatus: 'no_text_layer' }),
      makeDocument({ documentId: 'd3' }),
      makeDocument({ documentId: 'd4' }),
      makeDocument({ documentId: 'd5' }),
    ];
    const store = makeStore({ documents: docs, schemaModel: 'gemini-from-s5' });
    initPilotSelection(store);
    expect(store.getState().pilot.selectedStudyIds).toEqual(['study-d1', 'study-d3', 'study-d4']);
    expect(store.getState().pilot.model).toBe('gemini-from-s5');
    expect(store.getState().pilot.selectionInitialized).toBe(true);
  });

  test('既に初期化済み・文献未読込のときは何もしない', () => {
    const initializedStore = makeStore({
      documents: [makeDocument()],
      pilot: { selectionInitialized: true, selectedStudyIds: [] },
    });
    initPilotSelection(initializedStore);
    expect(initializedStore.getState().pilot.selectedStudyIds).toEqual([]);

    const unloadedStore = makeStore({ documents: null });
    initPilotSelection(unloadedStore);
    expect(unloadedStore.getState().pilot.selectionInitialized).toBe(false);
  });

  test('ユーザーが入力済みのモデル名は上書きしない', () => {
    const store = makeStore({
      documents: [makeDocument()],
      schemaModel: 'gemini-from-s5',
      pilot: { model: 'user-model' },
    });
    initPilotSelection(store);
    expect(store.getState().pilot.model).toBe('user-model');
  });
});

describe('togglePilotStudy / setPilotModel', () => {
  test('選択・解除・重複追加・4 件目の拒否', () => {
    const store = makeStore({ pilot: { selectedStudyIds: ['s1', 's2'] } });
    togglePilotStudy(store, 's3', true);
    expect(store.getState().pilot.selectedStudyIds).toEqual(['s1', 's2', 's3']);
    togglePilotStudy(store, 's3', true); // 重複は無視
    expect(store.getState().pilot.selectedStudyIds).toEqual(['s1', 's2', 's3']);
    togglePilotStudy(store, 's4', true); // 4 件目はトーストで拒否
    expect(store.getState().pilot.selectedStudyIds).toEqual(['s1', 's2', 's3']);
    togglePilotStudy(store, 's2', false);
    expect(store.getState().pilot.selectedStudyIds).toEqual(['s1', 's3']);
  });

  test('モデル名は trim して保存する', () => {
    const store = makeStore({});
    setPilotModel(store, '  gemini-x  ');
    expect(store.getState().pilot.model).toBe('gemini-x');
  });
});

describe('runPilot: 事前バリデーション', () => {
  test('プロジェクト未選択・実行中は何もしない', async () => {
    const noProject = makeStore({ withProject: false });
    await runPilot(noProject, makeDeps());
    expect(runExtractionMock).not.toHaveBeenCalled();

    const running = makeStore({ pilot: { running: true } });
    await runPilot(running, makeDeps());
    expect(runExtractionMock).not.toHaveBeenCalled();
  });

  test('スキーマ未読込（null / 空）はエラー文言を出す', async () => {
    for (const fields of [null, [] as SchemaField[]]) {
      const store = makeStore({ fields });
      await runPilot(store, makeDeps());
      expect(store.getState().pilot.runError).toContain('確定済みの表のデザインを読み込めていません');
    }
  });

  test('対象 0 本・モデル未入力・API キー未設定はエラー文言を出す', async () => {
    const noSelection = makeStore({ fields: [makeField()], pilot: { selectedStudyIds: [] } });
    await runPilot(noSelection, makeDeps());
    expect(noSelection.getState().pilot.runError).toContain('対象 study を 1〜3 件');

    const noModel = makeStore({
      fields: [makeField()],
      documents: [makeDocument()],
      pilot: { selectedStudyIds: ['study-doc-1'], model: '' },
    });
    await runPilot(noModel, makeDeps());
    expect(noModel.getState().pilot.runError).toContain('モデルを選択してください');

    const noKey = makeStore({
      fields: [makeField()],
      documents: [makeDocument()],
      pilot: { selectedStudyIds: ['study-doc-1'], model: 'gemini-test' },
    });
    await runPilot(noKey, makeDeps({ loadApiKey: jest.fn().mockResolvedValue(null) }));
    expect(noKey.getState().pilot.runError).toContain('Gemini API キーが未設定です');
  });
});

describe('runPilot: 実行', () => {
  function makeReadyStore(): Store {
    return makeStore({
      documents: [makeDocument(), makeDocument({ documentId: 'doc-2' })],
      fields: [makeField()],
      pilot: { selectedStudyIds: ['study-doc-1'], model: 'gemini-test' },
    });
  }

  function makeOutcome(
    overrides: { status?: 'done' | 'partial_failure'; studyIds?: string[]; evidence?: Evidence[] } = {},
  ) {
    const status = overrides.status ?? 'done';
    return {
      run: makeRun({ status, studyIds: overrides.studyIds ?? ['study-doc-1'] }),
      plan: {
        schemaVersion: 1,
        model: 'gemini-test',
        batches: [],
        inputMode: 'text_only' as const,
        tokensInEstimate: 100,
        tokensOutEstimate: 10,
        costEstimateUsd: 0.01,
        warnings: [],
      },
      result: {
        runId: 'run-1',
        status,
        evidence: overrides.evidence ?? [makeEvidence()],
        rejectedItems: [],
        batchFailures:
          status === 'partial_failure'
            ? [{ studyId: 'study-doc-1', section: null, reason: 'api_error' as const, detail: '500' }]
            : [],
        tokensIn: 100,
        tokensOut: 50,
        modelVersion: 'gemini-test-001',
      },
    };
  }

  test('runExtraction を pilot 設定で呼び、counts と run 結果を反映して検証データを読み込む', async () => {
    const store = makeReadyStore();
    runExtractionMock.mockResolvedValue(makeOutcome());
    await runPilot(store, makeDeps());

    expect(runExtractionMock).toHaveBeenCalledTimes(1);
    const [params] = runExtractionMock.mock.calls[0] as unknown as [
      Parameters<typeof runExtraction>[0],
    ];
    expect(params).toMatchObject({
      spreadsheetId: 'sheet-1',
      logsLlmFolderId: 'llm-id',
      runType: 'pilot',
      model: 'gemini-test',
      protocolContext: 'PROTOCOL TEXT',
    });
    expect(params.documents.map((doc) => doc.documentId)).toEqual(['doc-1']);
    // pdf_native（handoff-scanned-pdf-native-highlight.md §7.4 PR2）経路のため
    // loadDocumentPageImages も executeRun へ渡せるよう runExtraction へ注入する
    const runDeps = runExtractionMock.mock.calls[0]?.[1];
    expect(typeof runDeps?.loadDocumentPageImages).toBe('function');

    const state = store.getState();
    expect(state.counts).toMatchObject({ pilotRuns: 1, evidenceRows: 1, dataRows: 1 });
    expect(state.pilot.running).toBe(false);
    expect(state.pilot.run?.runId).toBe('run-1');
    expect(state.pilot.runFields).toEqual([makeField()]);
    expect(state.pilot.evidence).toEqual([makeEvidence()]);
    // 完了後に最初の study の検証データが読み込まれる（配下の全文書を連結表示）
    expect(state.pilot.verifyStudyId).toBe('study-doc-1');
    expect(state.pilot.verification).not.toBeNull();
    expect(state.pilot.verification?.annotator).toBe(ME);
    // v0.10 study/document モデル: 文書の軽量素材（extractedPages）は bundle 組み立て時に持つ。
    // PDF バイナリは読まれておらず（issue #28 案3）、loadPdfView を呼んで初めて取得できる
    expect(state.pilot.verification?.documents[0]?.extractedPages).toEqual([]);
    expect(getFileBinaryMock).not.toHaveBeenCalled();
    const loaded = await state.pilot.verification?.loadPdfView('doc-1');
    expect(loaded?.pdf).not.toBeNull();
    expect(getFileBinaryMock).toHaveBeenCalledTimes(1);
  });

  test('保存した OpenAI 互換接続をパイロット抽出へ渡す', async () => {
    const store = makeReadyStore();
    runExtractionMock.mockResolvedValue(makeOutcome());
    await runPilot(
      store,
      makeDeps({
        loadLlmConnectionSettings: async () => ({
          provider: 'openai_compatible',
          openAiCompatibleEndpoint: 'https://llm.example/v1/chat/completions',
        }),
        loadApiKey: jest.fn().mockResolvedValue('custom-key'),
      }),
    );
    const runDeps = runExtractionMock.mock.calls[0]?.[1];
    expect(runDeps).toMatchObject({
      apiKey: 'custom-key',
      provider: 'openai_compatible',
      endpoint: 'https://llm.example/v1/chat/completions',
    });
  });

  test('進捗コールバックが pilot.progress を更新する', async () => {
    const store = makeReadyStore();
    let observed: unknown = null;
    runExtractionMock.mockImplementation(async (params) => {
      params.onProgress?.({ totalBatches: 2, completedBatches: 1, studyId: 'study-doc-1', section: null, failure: null });
      observed = store.getState().pilot.progress;
      return makeOutcome();
    });
    await runPilot(store, makeDeps());
    expect(observed).toEqual({
      totalBatches: 2,
      completedBatches: 1,
      studyId: 'study-doc-1',
      section: null,
      failure: null,
    });
    expect(store.getState().pilot.progress).toBeNull();
  });

  test('partial_failure はバッチ失敗の内訳を保持する', async () => {
    const store = makeReadyStore();
    runExtractionMock.mockResolvedValue(makeOutcome({ status: 'partial_failure' }));
    await runPilot(store, makeDeps());
    expect(store.getState().pilot.batchFailures).toHaveLength(1);
    expect(store.getState().pilot.run?.status).toBe('partial_failure');
  });

  test('完了した run を履歴の先頭へ足し、historyInitialized を立てる', async () => {
    const existing = makeRun({ runId: 'run-0' });
    const store = makeStore({
      documents: [makeDocument()],
      fields: [makeField()],
      pilot: {
        selectedStudyIds: ['study-doc-1'],
        model: 'gemini-test',
        history: [existing],
        historyInitialized: false,
      },
    });
    runExtractionMock.mockResolvedValue(makeOutcome());
    await runPilot(store, makeDeps());
    const { pilot } = store.getState();
    expect(pilot.history?.map((run) => run.runId)).toEqual(['run-1', 'run-0']);
    expect(pilot.historyInitialized).toBe(true);
  });

  test('履歴未読込（null）のときは新 run だけの履歴になる', async () => {
    const store = makeReadyStore();
    runExtractionMock.mockResolvedValue(makeOutcome());
    await runPilot(store, makeDeps());
    expect(store.getState().pilot.history?.map((run) => run.runId)).toEqual(['run-1']);
  });

  test('documents / studies が未読込なら readDocuments / readStudies で解決する', async () => {
    const store = makeStore({
      documents: null,
      studies: null,
      fields: [makeField()],
      pilot: { selectedStudyIds: ['study-doc-1'], model: 'gemini-test' },
    });
    readDocumentsMock.mockResolvedValue([makeDocument()]);
    readStudiesMock.mockResolvedValue([
      {
        studyId: 'study-doc-1',
        studyLabel: 'label',
        registrationId: null,
        createdAt: 't0',
        createdBy: ME,
        note: null,
      },
    ]);
    runExtractionMock.mockResolvedValue(makeOutcome());
    await runPilot(store, makeDeps());
    expect(readDocumentsMock).toHaveBeenCalledWith('sheet-1', expect.anything());
    expect(readStudiesMock).toHaveBeenCalledWith('sheet-1', expect.anything());
    expect(store.getState().pilot.run).not.toBeNull();
  });

  test('抽出対象が空（studyIds なし）なら検証読み込みをスキップする', async () => {
    const store = makeReadyStore();
    runExtractionMock.mockResolvedValue(makeOutcome({ studyIds: [], evidence: [] }));
    await runPilot(store, makeDeps());
    expect(store.getState().pilot.verification).toBeNull();
    expect(readDecisionsMock).not.toHaveBeenCalled();
  });

  test('実行の失敗は runError に落ちる', async () => {
    const store = makeReadyStore();
    runExtractionMock.mockReset();
    runExtractionMock.mockRejectedValue(new Error('LLM 呼び出し失敗'));
    await runPilot(store, makeDeps());
    expect(store.getState().pilot).toMatchObject({
      running: false,
      progress: null,
      runError: 'LLM 呼び出し失敗',
    });
  });

  test('Error 以外の throw は文字列化して runError に出す', async () => {
    const store = makeReadyStore();
    runExtractionMock.mockReset();
    runExtractionMock.mockRejectedValue('壊れた応答');
    await runPilot(store, makeDeps());
    expect(store.getState().pilot.runError).toBe('壊れた応答');
  });

  test('now 未注入でも ISO 時刻で転記時刻を作る（既定の nowIso8601）', async () => {
    const store = makeReadyStore();
    runExtractionMock.mockResolvedValue(makeOutcome());
    await runPilot(store, makeDeps({ now: undefined }));
    expect(store.getState().pilot.run?.runId).toBe('run-1');
  });
});

describe('loadPilotVerification', () => {
  function makeRanStore(): Store {
    return makeStore({
      documents: [makeDocument(), makeDocument({ documentId: 'doc-2', driveFileId: 'drive-2' })],
      fields: [makeField()],
      pilot: {
        run: makeRun({ studyIds: ['study-doc-1', 'study-doc-2'] }),
        runFields: [makeField()],
        evidence: [
          makeEvidence(),
          makeEvidence({ evidenceId: 'ev-2', studyId: 'study-doc-2', documentId: 'doc-2' }),
        ],
      },
    });
  }

  test('run 未実行・プロジェクト未選択のときは何もしない', async () => {
    await loadPilotVerification(makeStore({ withProject: false }), makeDeps(), 'study-doc-1');
    await loadPilotVerification(makeStore({}), makeDeps(), 'study-doc-1');
    expect(readDecisionsMock).not.toHaveBeenCalled();
  });

  test('study が見つからないときは verifyError', async () => {
    const store = makeRanStore();
    await loadPilotVerification(store, makeDeps(), 'study-9');
    expect(store.getState().pilot.verifyError).toContain('study-9 が見つかりません');
  });

  test('検証データ束を組み立てる（当該 study の Evidence だけ / StudyData の自分の行）', async () => {
    const store = makeRanStore();
    readStudyDataSheetMock.mockResolvedValue({
      fieldNames: ['sample_size_total'],
      rows: [
        {
          studyId: 'study-doc-1',
          annotator: ME,
          annotatorType: 'human_with_ai',
          schemaVersion: 1,
          runId: null,
          updatedAt: 't0',
          values: { sample_size_total: '100' },
        },
      ],
    });
    await loadPilotVerification(store, makeDeps(), 'study-doc-1');
    const { pilot } = store.getState();
    expect(pilot.verifyLoading).toBe(false);
    expect(pilot.verification?.evidence.map((item) => item.evidenceId)).toEqual(['ev-1']);
    expect(pilot.verification?.documents.map((doc) => doc.document.documentId)).toEqual(['doc-1']);
    expect(pilot.studyValues).toEqual({ sample_size_total: '100' });
    // bundle 組み立て時点では PDF を読まない（issue #28 案3）。loadPdfView で初めて取得できる
    expect(getFileBinaryMock).not.toHaveBeenCalled();
    const loaded = await pilot.verification?.loadPdfView('doc-1');
    expect(loaded?.pdfError).toBeNull();
    // ビューア用ドキュメントは元 PDF のページをそのまま返す
    await expect(loaded?.pdf?.getPage(1)).resolves.toBeDefined();
    // レイアウトモードは検証データ束の読込時に settingsStore から読む（issue #38。未設定は既定 focus）
    expect(pilot.layoutMode).toBe('focus');
    // 楽観ロックのトークン（issue #64）は bundle の値をそのまま反映する
    expect(pilot.studyRowUpdatedAt).toBe('t0');
  });

  test('データ束読込のたびに楽観ロックのトークン・競合バナーをリセットしてから読み直す（issue #64）', async () => {
    const store = makeRanStore();
    store.setState({
      pilot: {
        ...store.getState().pilot,
        studyRowUpdatedAt: 'stale',
        resultsRowUpdatedAt: { stale: 'stale' },
        conflictMessage: '前回の競合メッセージ',
      },
    });
    await loadPilotVerification(store, makeDeps(), 'study-doc-1');
    const { pilot } = store.getState();
    expect(pilot.conflictMessage).toBeNull();
    expect(pilot.studyRowUpdatedAt).toBeNull(); // 自分の行が無いので null
    expect(pilot.resultsRowUpdatedAt).toEqual({});
  });

  test('自分の StudyData 行が無ければ空 values から始める。email 不明は空文字 annotator', async () => {
    const store = makeRanStore();
    getCurrentUserEmailMock.mockResolvedValue(null);
    await loadPilotVerification(store, makeDeps(), 'study-doc-1');
    expect(store.getState().pilot.studyValues).toEqual({});
    expect(store.getState().pilot.verification?.annotator).toBe('');
  });

  test('PDF の読み込み失敗は pdfError に留め、フォーム検証は続行できる', async () => {
    const store = makeRanStore();
    getFileBinaryMock.mockRejectedValue(new Error('404 not found'));
    await loadPilotVerification(store, makeDeps(), 'study-doc-1');
    const { verification } = store.getState().pilot;
    const loaded = await verification?.loadPdfView('doc-1');
    expect(loaded?.pdf).toBeNull();
    expect(loaded?.pdfError).toBe('404 not found');
    expect(loaded?.textPages).toEqual([]);
    expect(store.getState().pilot.verifyError).toBeNull();
  });

  test('Decisions の読み込み失敗は verifyError', async () => {
    const store = makeRanStore();
    readDecisionsMock.mockRejectedValue(new Error('権限がありません'));
    await loadPilotVerification(store, makeDeps(), 'study-doc-1');
    expect(store.getState().pilot.verifyError).toBe('権限がありません');
    expect(store.getState().pilot.verifyLoading).toBe(false);
  });

  test('study 切替時は前の PDF を破棄する（disposePdf）', async () => {
    const store = makeRanStore();
    const pdf = makePdf();
    const deps = makeDeps({ loadPdf: jest.fn().mockResolvedValue(pdf) });
    await loadPilotVerification(store, deps, 'study-doc-1');
    // 表示中文書の PDF を読み込む（bundle 組み立て自体は PDF を読まないため明示的に読み込む）
    await store.getState().pilot.verification?.loadPdfView('doc-1');
    expect(pdf.destroy).not.toHaveBeenCalled();
    await loadPilotVerification(store, deps, 'study-doc-2');
    expect(pdf.destroy).toHaveBeenCalledTimes(1);
    expect(store.getState().pilot.verifyStudyId).toBe('study-doc-2');
  });
});

describe('setPilotLayoutMode（issue #38）', () => {
  test('pilot.layoutMode を楽観反映し、settingsStore（deps 注入）へ永続化する', async () => {
    const store = makeStore({});
    const saveVerifyLayoutMode = jest.fn().mockResolvedValue(undefined);
    await setPilotLayoutMode(store, makeDeps({ saveVerifyLayoutMode }), 'list');
    expect(store.getState().pilot.layoutMode).toBe('list');
    expect(saveVerifyLayoutMode).toHaveBeenCalledWith('list');
  });
});

describe('persistPilotDecision', () => {
  function makeVerifyingStore(fields: SchemaField[] = [makeField()]): Store {
    return makeStore({
      fields,
      pilot: {
        run: makeRun(),
        runFields: fields,
        evidence: [makeEvidence()],
        studyValues: { country: 'Japan' },
      },
    });
  }

  test('プロジェクト未選択は何もしない', async () => {
    await persistPilotDecision(makeStore({ withProject: false }), makeDeps(), makeDecision());
    expect(appendDecisionsMock).not.toHaveBeenCalled();
  });

  test('スキーマに無い field_id はトーストだけ出して保存しない', async () => {
    const store = makeVerifyingStore();
    await persistPilotDecision(store, makeDeps(), makeDecision({ fieldId: 'f-ghost' }));
    expect(appendDecisionsMock).not.toHaveBeenCalled();
    expect(upsertStudyMock).not.toHaveBeenCalled();
  });

  test('study 項目: values 全量スナップショットで StudyData を upsert → Decisions 追記', async () => {
    const store = makeVerifyingStore();
    const deps = makeDeps();
    const decision = makeDecision();
    await persistPilotDecision(store, deps, decision);
    expect(upsertStudyMock).toHaveBeenCalledWith(
      'sheet-1',
      [
        {
          studyId: 'study-doc-1',
          annotator: ME,
          annotatorType: 'human_with_ai',
          schemaVersion: 1,
          runId: null,
          updatedAt: 't-now',
          values: { country: 'Japan', sample_size_total: '120' },
          // pilot.studyRowUpdatedAt 未設定（既定 null）＝「行がまだ無い」ことを期待する（issue #64）
          expectedUpdatedAt: null,
        },
      ],
      deps.google,
    );
    expect(appendDecisionsMock).toHaveBeenCalledWith('sheet-1', [decision], deps.google);
    expect(store.getState().pilot.studyValues).toEqual({
      country: 'Japan',
      sample_size_total: '120',
    });
    // 成功時は退避分を flush して残数を反映する
    expect(deps.decisionQueue?.flush).toHaveBeenCalled();
    expect(store.getState().pilot.queuedDecisions).toBe(0);
  });

  test('arm / outcome 項目: ResultsData を upsert（NR は value null + not_reported）', async () => {
    const armField = makeField({ fieldId: 'f-arm-n', fieldName: 'arm_n', entityLevel: 'arm' });
    const store = makeVerifyingStore([armField]);
    const deps = makeDeps();
    await persistPilotDecision(
      store,
      deps,
      makeDecision({ fieldId: 'f-arm-n', entityKey: 'arm:1', action: 'not_reported', value: 'NR' }),
    );
    expect(upsertResultsMock).toHaveBeenCalledWith(
      'sheet-1',
      [
        expect.objectContaining({
          studyId: 'study-doc-1',
          fieldId: 'f-arm-n',
          entityKey: 'arm:1',
          value: null,
          notReported: true,
        }),
      ],
      deps.google,
      { newUuid: deps.newUuid },
    );
    // studyValues は変わらない
    expect(store.getState().pilot.studyValues).toEqual({ country: 'Japan' });
  });

  test('studyValues 未読込（null）でも当該項目だけのスナップショットで保存する', async () => {
    const store = makeStore({
      fields: [makeField()],
      pilot: { run: makeRun(), runFields: [makeField()], evidence: [], studyValues: null },
    });
    await persistPilotDecision(store, makeDeps(), makeDecision());
    expect(upsertStudyMock).toHaveBeenCalledWith(
      'sheet-1',
      [expect.objectContaining({ values: { sample_size_total: '120' } })],
      expect.anything(),
    );
  });

  test('通常値の ResultsData 書き込みは value をそのまま送る', async () => {
    const armField = makeField({ fieldId: 'f-arm-n', fieldName: 'arm_n', entityLevel: 'arm' });
    const store = makeVerifyingStore([armField]);
    await persistPilotDecision(
      store,
      makeDeps(),
      makeDecision({ fieldId: 'f-arm-n', entityKey: 'arm:1', value: '50' }),
    );
    expect(upsertResultsMock).toHaveBeenCalledWith(
      'sheet-1',
      [expect.objectContaining({ value: '50', notReported: false })],
      expect.anything(),
      expect.anything(),
    );
  });

  test('保存失敗はオフラインキューへ退避し、件数とトーストを出す', async () => {
    const store = makeVerifyingStore();
    const deps = makeDeps();
    upsertStudyMock.mockRejectedValueOnce(new Error('offline'));
    const decision = makeDecision();
    await persistPilotDecision(store, deps, decision);
    expect(deps.decisionQueue?.enqueue).toHaveBeenCalledWith(
      'sheet-1',
      ME,
      expect.objectContaining({
        decision,
        fieldName: 'sample_size_total',
        entityLevel: 'study',
      }),
    );
    expect(store.getState().pilot.queuedDecisions).toBe(1);
    expect(deps.decisionQueue?.flush).not.toHaveBeenCalled();
  });

  test('flush の再送は保存経路を通し、残数を queuedDecisions へ反映する', async () => {
    const store = makeVerifyingStore();
    const deps = makeDeps();
    const queue = deps.decisionQueue as jest.Mocked<OfflineQueue<QueuedDecisionWrite>>;
    queue.flush.mockImplementation(async (_sheet, _email, save) => {
      await save({
        decision: makeDecision({ decidedAt: 't-old' }),
        fieldName: 'sample_size_total',
        entityLevel: 'study',
        studyValues: { sample_size_total: '99' },
      });
      return { flushedCount: 1, remainingCount: 2 };
    });
    await persistPilotDecision(store, deps, makeDecision());
    // 現在の判定 1 回 + 再送 1 回
    expect(upsertStudyMock).toHaveBeenCalledTimes(2);
    expect(appendDecisionsMock).toHaveBeenCalledTimes(2);
    expect(store.getState().pilot.queuedDecisions).toBe(2);
  });

  test('decisionQueue 未注入なら共有キューで動く（空キューの flush は no-op）', async () => {
    const store = makeVerifyingStore();
    const deps = makeDeps({ decisionQueue: undefined });
    await persistPilotDecision(store, deps, makeDecision());
    expect(appendDecisionsMock).toHaveBeenCalledTimes(1);
    expect(store.getState().pilot.queuedDecisions).toBe(0);
  });

  describe('楽観ロック（issue #64）', () => {
    test('study 項目は pilot.studyRowUpdatedAt を期待値として upsert へ渡す', async () => {
      const store = makeStore({
        fields: [makeField()],
        pilot: {
          run: makeRun(),
          runFields: [makeField()],
          evidence: [],
          studyValues: { country: 'Japan' },
          studyRowUpdatedAt: 't-study-0',
        },
      });
      await persistPilotDecision(store, makeDeps(), makeDecision());
      expect(upsertStudyMock).toHaveBeenCalledWith(
        'sheet-1',
        [expect.objectContaining({ expectedUpdatedAt: 't-study-0' })],
        expect.anything(),
      );
    });

    test('非 study 項目は resultsRowUpdatedAt のセルキーから期待値を解決する（無ければ null）', async () => {
      const armField = makeField({ fieldId: 'f-arm-n', fieldName: 'arm_n', entityLevel: 'arm' });
      const store = makeStore({
        fields: [armField],
        pilot: {
          run: makeRun(),
          runFields: [armField],
          evidence: [],
          resultsRowUpdatedAt: { [resultsCellKeyOf('arm:1', 'f-arm-n')]: 't-cell-0' },
        },
      });
      await persistPilotDecision(
        store,
        makeDeps(),
        makeDecision({ fieldId: 'f-arm-n', entityKey: 'arm:1', value: '50' }),
      );
      expect(upsertResultsMock).toHaveBeenCalledWith(
        'sheet-1',
        [expect.objectContaining({ expectedUpdatedAt: 't-cell-0' })],
        expect.anything(),
        expect.anything(),
      );

      await persistPilotDecision(
        store,
        makeDeps(),
        makeDecision({ fieldId: 'f-arm-n', entityKey: 'arm:2', value: '60' }),
      );
      expect(upsertResultsMock).toHaveBeenLastCalledWith(
        'sheet-1',
        [expect.objectContaining({ expectedUpdatedAt: null })],
        expect.anything(),
        expect.anything(),
      );
    });

    test('AnnotationConflictError（楽観ロック競合）はキューへ退避せず conflictMessage を立てる', async () => {
      const store = makeVerifyingStore();
      const conflict = new AnnotationConflictError({
        tab: 'StudyData',
        studyId: 'study-doc-1',
        annotator: ME,
        entityKey: null,
        fieldId: null,
        expectedUpdatedAt: 't-old',
        actualUpdatedAt: 't-new',
      });
      upsertStudyMock.mockRejectedValueOnce(conflict);
      const deps = makeDeps();
      await persistPilotDecision(store, deps, makeDecision());
      expect(store.getState().pilot.conflictMessage).toBe(conflict.message);
      expect(store.getState().pilot.queuedDecisions).toBe(0);
      expect(deps.decisionQueue?.enqueue).not.toHaveBeenCalled();
    });

    test('保存成功時は studyRowUpdatedAt を進める（study 項目）', async () => {
      const store = makeStore({
        fields: [makeField()],
        pilot: {
          run: makeRun(),
          runFields: [makeField()],
          evidence: [],
          studyValues: { country: 'Japan' },
          studyRowUpdatedAt: 't-study-0',
        },
      });
      const decision = makeDecision({ decidedAt: 't-study-1' });
      await persistPilotDecision(store, makeDeps(), decision);
      expect(store.getState().pilot.studyRowUpdatedAt).toBe('t-study-1');
    });

    test('保存成功時は resultsRowUpdatedAt のセルキーを進める（非 study 項目）', async () => {
      const armField = makeField({ fieldId: 'f-arm-n', fieldName: 'arm_n', entityLevel: 'arm' });
      const store = makeStore({
        fields: [armField],
        pilot: { run: makeRun(), runFields: [armField], evidence: [] },
      });
      const decision = makeDecision({
        fieldId: 'f-arm-n',
        entityKey: 'arm:1',
        value: '50',
        decidedAt: 't-cell-1',
      });
      await persistPilotDecision(store, makeDeps(), decision);
      expect(store.getState().pilot.resultsRowUpdatedAt).toEqual({
        [resultsCellKeyOf('arm:1', 'f-arm-n')]: 't-cell-1',
      });
    });
  });
});

describe('キュー項目のキー関数', () => {
  test('id は判定時刻 × field × entity、ソートキーは判定時刻', async () => {
    const { decisionWriteId, decisionWriteSortKey } = await import(
      '../../../../src/app/services/verificationService'
    );
    const item: QueuedDecisionWrite = {
      decision: makeDecision({ decidedAt: 't1', fieldId: 'f-x', entityKey: 'arm:1' }),
      fieldName: 'x',
      entityLevel: 'arm',
      studyValues: null,
    };
    expect(decisionWriteId(item)).toBe('t1|f-x|arm:1');
    expect(decisionWriteSortKey(item)).toBe('t1');
  });
});

describe('persistPilotArmConfirmation', () => {
  function makeVerificationStore(): Store {
    const store = makeStore({
      documents: [makeDocument()],
      fields: [makeField()],
      pilot: {
        run: makeRun(),
        runFields: [makeField()],
        evidence: [makeEvidence()],
      },
    });
    return store;
  }

  test('検証データ表示中は ArmStructures へ新 version を追記する', async () => {
    const store = makeVerificationStore();
    const deps = makeDeps();
    await loadPilotVerification(store, deps, 'study-doc-1');
    appendArmVersionMock.mockResolvedValue({
      version: 1,
      arms: [{ armKey: 'arm:1', armName: '介入群' }],
    });
    await persistPilotArmConfirmation(store, deps, [{ armKey: 'arm:1', armName: '介入群' }]);
    expect(appendArmVersionMock).toHaveBeenCalledWith(
      'sheet-1',
      {
        studyId: 'study-doc-1',
        arms: [{ armKey: 'arm:1', armName: '介入群' }],
        annotator: ME,
        annotatorType: 'human_with_ai',
        confirmedAt: 't-now',
      },
      deps.google,
    );
  });

  test('now 未注入は既定の nowIso8601 で確定時刻を作る', async () => {
    const store = makeVerificationStore();
    const deps = makeDeps({ now: undefined });
    await loadPilotVerification(store, deps, 'study-doc-1');
    appendArmVersionMock.mockResolvedValue({ version: 1, arms: [] });
    await persistPilotArmConfirmation(store, deps, [{ armKey: 'arm:1', armName: 'A' }]);
    const input = appendArmVersionMock.mock.calls.at(-1)?.[1];
    expect(input?.confirmedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('保存失敗はトーストのみで throw しない', async () => {
    const store = makeVerificationStore();
    const deps = makeDeps();
    await loadPilotVerification(store, deps, 'study-doc-1');
    appendArmVersionMock.mockRejectedValue(new Error('offline'));
    await expect(
      persistPilotArmConfirmation(store, deps, [{ armKey: 'arm:1', armName: 'A' }]),
    ).resolves.toBeUndefined();
    // Error 以外の throw も文字列化してトーストする
    appendArmVersionMock.mockRejectedValue('壊れた応答');
    await expect(
      persistPilotArmConfirmation(store, deps, [{ armKey: 'arm:1', armName: 'A' }]),
    ).resolves.toBeUndefined();
  });

  test('プロジェクト未選択・検証データ未読込は何もしない', async () => {
    appendArmVersionMock.mockClear();
    await persistPilotArmConfirmation(makeStore({ withProject: false }), makeDeps(), []);
    await persistPilotArmConfirmation(makeStore({}), makeDeps(), []);
    expect(appendArmVersionMock).not.toHaveBeenCalled();
  });

  test('検証データ束には自分の確定済み群構成（最新 version）が入る', async () => {
    const store = makeVerificationStore();
    readArmStructuresMock.mockResolvedValue([
      {
        studyId: 'study-doc-1',
        version: 1,
        armKey: 'arm:1',
        armName: '旧名',
        annotator: ME,
        annotatorType: 'human_with_ai',
        confirmedAt: 't0',
        note: null,
      },
      {
        studyId: 'study-doc-1',
        version: 2,
        armKey: 'arm:1',
        armName: '介入群',
        annotator: ME,
        annotatorType: 'human_with_ai',
        confirmedAt: 't1',
        note: null,
      },
      {
        studyId: 'study-doc-1',
        version: 9,
        armKey: 'arm:1',
        armName: '他人の確定',
        annotator: 'other@example.com',
        annotatorType: 'human_with_ai',
        confirmedAt: 't2',
        note: null,
      },
    ]);
    await loadPilotVerification(store, makeDeps(), 'study-doc-1');
    expect(store.getState().pilot.verification?.armStructure).toEqual({
      version: 2,
      arms: [{ armKey: 'arm:1', armName: '介入群' }],
    });
  });
});

describe('persistPilotInstanceDeclarations', () => {
  test('予約 Decision を Decisions へ追記し、ResultsData は更新しない', async () => {
    const decision = makeDecision({
      fieldId: '__entity_instance__',
      entityKey: 'outcome:mortality|arm:1',
      action: 'edit',
      value: 'outcome:mortality|arm:1',
      note: 'outcome_instance_declared',
    });
    await persistPilotInstanceDeclarations(makeStore({}), makeDeps(), [decision]);
    expect(appendDecisionsMock).toHaveBeenCalledWith('sheet-1', [decision], expect.anything());
    expect(upsertResultsMock).not.toHaveBeenCalled();
  });

  test('プロジェクト未選択なら何もしない', async () => {
    await persistPilotInstanceDeclarations(makeStore({ withProject: false }), makeDeps(), [
      makeDecision({ fieldId: '__entity_instance__' }),
    ]);
    expect(appendDecisionsMock).not.toHaveBeenCalled();
  });
});

describe('persistPilotRelocateQuote（issue #94）', () => {
  test('spreadsheetId / driveFolderId / 対象項目 / 出所文書の extracted_texts を解決して relocateQuote へ委譲する', async () => {
    const evidence = makeEvidence({ anchorStatus: 'failed', quote: null, page: null });
    relocateQuoteMock.mockResolvedValue({
      status: 'relocated',
      evidence: makeEvidence({ evidenceId: 'ev-relocated', relocatedFrom: evidence.evidenceId }),
    });
    const store = makeStore({ pilot: { verification: makeVerificationData({ evidence: [evidence] }) } });
    const outcome = await persistPilotRelocateQuote(store, makeDeps(), evidence);
    expect(outcome.status).toBe('relocated');
    expect(relocateQuoteMock).toHaveBeenCalledWith(
      {
        spreadsheetId: 'sheet-1',
        driveFolderId: 'folder-1',
        evidence,
        field: expect.objectContaining({ fieldId: 'f-total' }),
        documentPages: [{ page: 1, text: 'a total of 120 patients' }],
      },
      expect.anything(),
    );
  });

  test('プロジェクト未選択・検証データ未読込では relocateQuote を呼ばず not_found を返す', async () => {
    const evidence = makeEvidence();
    const outcome1 = await persistPilotRelocateQuote(
      makeStore({ withProject: false }),
      makeDeps(),
      evidence,
    );
    expect(outcome1).toEqual({
      status: 'not_found',
      message: 'プロジェクトまたは検証データが読み込まれていません',
    });
    const outcome2 = await persistPilotRelocateQuote(
      makeStore({ pilot: { verification: null } }),
      makeDeps(),
      evidence,
    );
    expect(outcome2.status).toBe('not_found');
    expect(relocateQuoteMock).not.toHaveBeenCalled();
  });

  test('対象項目・出所文書が見つからなければ relocateQuote を呼ばず not_found を返す', async () => {
    const evidence = makeEvidence({ fieldId: 'f-unknown' });
    const store = makeStore({ pilot: { verification: makeVerificationData() } });
    const outcome = await persistPilotRelocateQuote(store, makeDeps(), evidence);
    expect(outcome).toEqual({ status: 'not_found', message: '対象項目または出所文書が見つかりません' });
    expect(relocateQuoteMock).not.toHaveBeenCalled();

    const evidence2 = makeEvidence({ documentId: 'doc-unknown' });
    const outcome2 = await persistPilotRelocateQuote(store, makeDeps(), evidence2);
    expect(outcome2.status).toBe('not_found');
    expect(relocateQuoteMock).not.toHaveBeenCalled();
  });
});

describe('loadPilotHistory', () => {
  test('履歴を読み込んで history へ格納する', async () => {
    const store = makeStore({});
    readPilotRunsMock.mockResolvedValue([makeRun({ runId: 'run-1' })]);
    await loadPilotHistory(store, makeDeps());
    expect(readPilotRunsMock).toHaveBeenCalledWith('sheet-1', expect.anything());
    expect(store.getState().pilot.history?.map((run) => run.runId)).toEqual(['run-1']);
    expect(store.getState().pilot.historyLoading).toBe(false);
  });

  test('プロジェクト未選択 / 読込中は何もしない', async () => {
    await loadPilotHistory(makeStore({ withProject: false }), makeDeps());
    await loadPilotHistory(makeStore({ pilot: { historyLoading: true } }), makeDeps());
    expect(readPilotRunsMock).not.toHaveBeenCalled();
  });

  test('読込済み（history 非 null）は force がなければ再読込しない', async () => {
    const store = makeStore({ pilot: { history: [] } });
    await loadPilotHistory(store, makeDeps());
    expect(readPilotRunsMock).not.toHaveBeenCalled();
    readPilotRunsMock.mockResolvedValue([makeRun()]);
    await loadPilotHistory(store, makeDeps(), { force: true });
    expect(readPilotRunsMock).toHaveBeenCalledTimes(1);
    expect(store.getState().pilot.history).toHaveLength(1);
  });

  test('読み込み失敗は historyError に落とす', async () => {
    const store = makeStore({});
    readPilotRunsMock.mockRejectedValue(new Error('403'));
    await loadPilotHistory(store, makeDeps());
    expect(store.getState().pilot.historyError).toBe('403');
    expect(store.getState().pilot.historyLoading).toBe(false);
  });
});

describe('loadPilotRun', () => {
  const HIST_RUN = makeRun({ runId: 'run-1', studyIds: ['study-doc-1'], schemaVersion: 1 });

  function makeHistoryStore(pilot: Partial<ReturnType<typeof createInitialState>['pilot']> = {}): Store {
    return makeStore({ documents: [makeDocument()], pilot: { history: [HIST_RUN], ...pilot } });
  }

  test('プロジェクト未選択 / 実行中 / 別 run 読込中は何もしない', async () => {
    await loadPilotRun(makeStore({ withProject: false, pilot: { history: [HIST_RUN] } }), makeDeps(), 'run-1');
    await loadPilotRun(makeHistoryStore({ running: true }), makeDeps(), 'run-1');
    await loadPilotRun(makeHistoryStore({ loadingRunId: 'other' }), makeDeps(), 'run-1');
    expect(readEvidenceRowsMock).not.toHaveBeenCalled();
  });

  test('履歴に無い run_id は historyError（読込は起こさない）', async () => {
    const store = makeHistoryStore();
    await loadPilotRun(store, makeDeps(), 'ghost');
    expect(store.getState().pilot.historyError).toContain('run ghost が履歴に見つかりません');
    expect(readEvidenceRowsMock).not.toHaveBeenCalled();
  });

  test('Evidence を当該 run で絞り、schema 項目を解決して検証を開く', async () => {
    const store = makeHistoryStore();
    readEvidenceRowsMock.mockResolvedValue([
      makeEvidence({ evidenceId: 'ev-1', runId: 'run-1' }),
      makeEvidence({ evidenceId: 'ev-2', runId: 'run-other' }),
    ]);
    getSchemaFieldsByVersionMock.mockResolvedValue([makeField()]);
    await loadPilotRun(store, makeDeps(), 'run-1');
    const { pilot } = store.getState();
    expect(getSchemaFieldsByVersionMock).toHaveBeenCalledWith('sheet-1', 1, expect.anything());
    expect(pilot.run?.runId).toBe('run-1');
    expect(pilot.runFields).toEqual([makeField()]);
    expect(pilot.evidence?.map((item) => item.evidenceId)).toEqual(['ev-1']);
    expect(pilot.loadingRunId).toBeNull();
    expect(pilot.batchFailures).toEqual([]);
    expect(pilot.verifyStudyId).toBe('study-doc-1');
    expect(pilot.verification).not.toBeNull();
  });

  test('studyIds が空の run は検証読み込みをスキップする', async () => {
    const emptyRun = makeRun({ runId: 'run-empty', studyIds: [] });
    const store = makeStore({ documents: [makeDocument()], pilot: { history: [emptyRun] } });
    readEvidenceRowsMock.mockResolvedValue([]);
    getSchemaFieldsByVersionMock.mockResolvedValue([]);
    await loadPilotRun(store, makeDeps(), 'run-empty');
    expect(store.getState().pilot.run?.runId).toBe('run-empty');
    expect(store.getState().pilot.verification).toBeNull();
    expect(readDecisionsMock).not.toHaveBeenCalled();
  });

  test('読み込み失敗は historyError に落とし loadingRunId を戻す', async () => {
    const store = makeHistoryStore();
    readEvidenceRowsMock.mockRejectedValue(new Error('Evidence 読込失敗'));
    await loadPilotRun(store, makeDeps(), 'run-1');
    expect(store.getState().pilot.historyError).toBe('Evidence 読込失敗');
    expect(store.getState().pilot.loadingRunId).toBeNull();
  });

  test('読み込み前に表示中 PDF を破棄する（disposePdf）', async () => {
    const disposePdf = jest.fn().mockResolvedValue(undefined);
    const store = makeHistoryStore({
      verification: { disposePdf } as unknown as VerificationData,
    });
    readEvidenceRowsMock.mockResolvedValue([]);
    getSchemaFieldsByVersionMock.mockResolvedValue([makeField()]);
    await loadPilotRun(store, makeDeps(), 'run-1');
    expect(disposePdf).toHaveBeenCalledTimes(1);
  });
});

describe('autoLoadLatestPilotRun', () => {
  const LATEST = makeRun({ runId: 'run-1', studyIds: ['study-doc-1'] });

  test('historyInitialized 済み / history 未読込は何もしない', async () => {
    const initialized = makeStore({
      documents: [makeDocument()],
      pilot: { history: [LATEST], historyInitialized: true },
    });
    await autoLoadLatestPilotRun(initialized, makeDeps());
    expect(readEvidenceRowsMock).not.toHaveBeenCalled();

    const unloaded = makeStore({ documents: [makeDocument()], pilot: { history: null } });
    await autoLoadLatestPilotRun(unloaded, makeDeps());
    expect(unloaded.getState().pilot.historyInitialized).toBe(false);
    expect(readEvidenceRowsMock).not.toHaveBeenCalled();
  });

  test('空の履歴は初期化フラグだけ立てて読み込まない', async () => {
    const store = makeStore({ documents: [makeDocument()], pilot: { history: [] } });
    await autoLoadLatestPilotRun(store, makeDeps());
    expect(store.getState().pilot.historyInitialized).toBe(true);
    expect(readEvidenceRowsMock).not.toHaveBeenCalled();
  });

  test('既に run を持つときは初期化だけで上書きしない', async () => {
    const store = makeStore({
      documents: [makeDocument()],
      pilot: { history: [LATEST], run: makeRun({ runId: 'session-run' }) },
    });
    await autoLoadLatestPilotRun(store, makeDeps());
    expect(store.getState().pilot.historyInitialized).toBe(true);
    expect(store.getState().pilot.run?.runId).toBe('session-run');
    expect(readEvidenceRowsMock).not.toHaveBeenCalled();
  });

  test('最新 run を自動読込する', async () => {
    const store = makeStore({ documents: [makeDocument()], pilot: { history: [LATEST] } });
    readEvidenceRowsMock.mockResolvedValue([makeEvidence({ runId: 'run-1' })]);
    getSchemaFieldsByVersionMock.mockResolvedValue([makeField()]);
    await autoLoadLatestPilotRun(store, makeDeps());
    expect(store.getState().pilot.historyInitialized).toBe(true);
    expect(store.getState().pilot.run?.runId).toBe('run-1');
    expect(readEvidenceRowsMock).toHaveBeenCalled();
  });
});
