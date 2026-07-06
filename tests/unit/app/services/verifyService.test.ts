import {
  latestRunEvidenceByDocument,
  loadVerifyTargets,
  openVerifyDocument,
  persistVerifyArmConfirmation,
  persistVerifyDecision,
} from '../../../../src/app/services/verifyService';
import type {
  QueuedDecisionWrite,
  VerificationDeps,
} from '../../../../src/app/services/verificationService';
import { createInitialState, createStore, type Store, type VerifyTarget } from '../../../../src/app/store';
import type { Decision } from '../../../../src/domain/decision';
import type { DocumentRecord } from '../../../../src/domain/document';
import type { Evidence } from '../../../../src/domain/evidence';
import type { SchemaField } from '../../../../src/domain/schemaField';
import { readDocuments } from '../../../../src/features/documents/documentRepository';
import type { DisposablePdfDocument } from '../../../../src/features/documents/extractTextLayer';
import {
  readStudyDataSheet,
  upsertResultsDataRows,
  upsertStudyDataRows,
} from '../../../../src/features/extraction/annotationRepository';
import { readEvidenceRows } from '../../../../src/features/extraction/evidenceRepository';
import { readRunSchemaVersions } from '../../../../src/features/extraction/runRepository';
import { getSchemaFieldsByVersion } from '../../../../src/features/schema/schemaRepository';
import {
  appendArmStructureVersion,
  readArmStructuresByDocument,
} from '../../../../src/features/verification/armStructureRepository';
import {
  appendDecisionRows,
  readAllDecisions,
  readDecisionsByDocument,
} from '../../../../src/features/verification/decisionRepository';
import { getFileBinary } from '../../../../src/lib/google/drive';
import { getCurrentUserEmail } from '../../../../src/lib/google/identity';
import type { OfflineQueue } from '../../../../src/lib/storage/offlineQueue';

jest.mock('../../../../src/features/documents/documentRepository', () => ({
  readDocuments: jest.fn(),
}));
jest.mock('../../../../src/features/extraction/annotationRepository', () => ({
  readStudyDataSheet: jest.fn(),
  upsertResultsDataRows: jest.fn(),
  upsertStudyDataRows: jest.fn(),
}));
jest.mock('../../../../src/features/extraction/evidenceRepository', () => ({
  readEvidenceRows: jest.fn(),
}));
jest.mock('../../../../src/features/extraction/runRepository', () => ({
  readRunSchemaVersions: jest.fn(),
}));
jest.mock('../../../../src/features/schema/schemaRepository', () => ({
  getSchemaFieldsByVersion: jest.fn(),
}));
jest.mock('../../../../src/features/verification/decisionRepository', () => ({
  appendDecisionRows: jest.fn(),
  readAllDecisions: jest.fn(),
  readDecisionsByDocument: jest.fn(),
}));
jest.mock('../../../../src/features/verification/armStructureRepository', () => ({
  ...jest.requireActual('../../../../src/features/verification/armStructureRepository'),
  appendArmStructureVersion: jest.fn(),
  readArmStructuresByDocument: jest.fn(),
}));
jest.mock('../../../../src/lib/google/drive', () => ({
  getFileBinary: jest.fn(),
}));
jest.mock('../../../../src/lib/google/identity', () => ({
  getCurrentUserEmail: jest.fn(),
}));

const readDocumentsMock = readDocuments as jest.MockedFunction<typeof readDocuments>;
const readStudyDataSheetMock = readStudyDataSheet as jest.MockedFunction<typeof readStudyDataSheet>;
const upsertStudyMock = upsertStudyDataRows as jest.MockedFunction<typeof upsertStudyDataRows>;
const upsertResultsMock = upsertResultsDataRows as jest.MockedFunction<typeof upsertResultsDataRows>;
const readEvidenceRowsMock = readEvidenceRows as jest.MockedFunction<typeof readEvidenceRows>;
const readRunSchemaVersionsMock = readRunSchemaVersions as jest.MockedFunction<
  typeof readRunSchemaVersions
>;
const getSchemaFieldsMock = getSchemaFieldsByVersion as jest.MockedFunction<
  typeof getSchemaFieldsByVersion
>;
const appendDecisionsMock = appendDecisionRows as jest.MockedFunction<typeof appendDecisionRows>;
const readAllDecisionsMock = readAllDecisions as jest.MockedFunction<typeof readAllDecisions>;
const readDecisionsMock = readDecisionsByDocument as jest.MockedFunction<
  typeof readDecisionsByDocument
>;
const appendArmVersionMock = appendArmStructureVersion as jest.MockedFunction<
  typeof appendArmStructureVersion
>;
const readArmStructuresMock = readArmStructuresByDocument as jest.MockedFunction<
  typeof readArmStructuresByDocument
>;
const getFileBinaryMock = getFileBinary as jest.MockedFunction<typeof getFileBinary>;
const getCurrentUserEmailMock = getCurrentUserEmail as jest.MockedFunction<
  typeof getCurrentUserEmail
>;

const ME = 'me@example.com';

function makeDocument(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
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

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    decidedAt: 't-now',
    decidedBy: ME,
    documentId: 'doc-1',
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
          {
            str: 'a total of 120',
            transform: [1, 0, 0, 1, 0, 700],
            width: 140,
            height: 10,
            hasEOL: false,
          },
        ],
      }),
      cleanup: jest.fn(),
    }),
    destroy: jest.fn().mockResolvedValue(undefined),
  };
}

function makeQueue(): jest.Mocked<OfflineQueue<QueuedDecisionWrite>> {
  return {
    enqueue: jest.fn().mockResolvedValue(undefined),
    flush: jest.fn().mockResolvedValue({ flushedCount: 0, remainingCount: 0 }),
  };
}

function makeDeps(overrides: Partial<VerificationDeps> = {}): VerificationDeps {
  return {
    google: { fetch: jest.fn(), getAccessToken: jest.fn() },
    profile: { getProfileUserInfo: jest.fn() } as unknown as VerificationDeps['profile'],
    loadPdf: jest.fn().mockResolvedValue(makePdf()),
    decisionQueue: makeQueue(),
    newUuid: () => 'uuid-1',
    now: () => 't-now',
    ...overrides,
  };
}

function makeTarget(overrides: Partial<VerifyTarget> = {}): VerifyTarget {
  return {
    document: makeDocument(),
    evidence: [makeEvidence()],
    fields: [makeField()],
    schemaVersion: 1,
    progress: { decided: 0, total: 1 },
    ...overrides,
  };
}

function makeStore(patch: {
  withProject?: boolean;
  documents?: DocumentRecord[] | null;
  verify?: Partial<ReturnType<typeof createInitialState>['verify']>;
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
  state.documents = { ...state.documents, records: patch.documents ?? null };
  state.verify = { ...state.verify, ...(patch.verify ?? {}) };
  return createStore(state);
}

beforeEach(() => {
  readEvidenceRowsMock.mockResolvedValue([makeEvidence()]);
  readRunSchemaVersionsMock.mockResolvedValue(new Map([['run-1', 1]]));
  readAllDecisionsMock.mockResolvedValue([]);
  readDecisionsMock.mockResolvedValue([]);
  readStudyDataSheetMock.mockResolvedValue({ fieldNames: [], rows: [] });
  readArmStructuresMock.mockResolvedValue([]);
  getSchemaFieldsMock.mockResolvedValue([makeField()]);
  getCurrentUserEmailMock.mockResolvedValue(ME);
  getFileBinaryMock.mockResolvedValue(new ArrayBuffer(8));
});

describe('latestRunEvidenceByDocument', () => {
  test('document ごとに最後に現れた run の Evidence だけを残す', () => {
    const map = latestRunEvidenceByDocument(
      [
        makeEvidence({ evidenceId: 'a', runId: 'run-1' }),
        makeEvidence({ evidenceId: 'b', documentId: 'doc-2', runId: 'run-1' }),
        makeEvidence({ evidenceId: 'c', runId: 'run-2' }), // doc-1 の新しい run
        makeEvidence({ evidenceId: 'd', runId: 'run-2', fieldId: 'f-2' }),
      ],
      new Set(['run-1', 'run-2']),
    );
    expect(map.get('doc-1')?.runId).toBe('run-2');
    expect(map.get('doc-1')?.evidence.map((item) => item.evidenceId)).toEqual(['c', 'd']);
    expect(map.get('doc-2')?.runId).toBe('run-1');
  });

  test('ExtractionRuns に無い run の Evidence（孤児）は対象外とし、既知 run の最新を採る', () => {
    const map = latestRunEvidenceByDocument(
      [
        makeEvidence({ evidenceId: 'a', runId: 'run-1' }),
        makeEvidence({ evidenceId: 'b', runId: 'run-orphan' }), // 中断実行の孤児（最後に現れる）
        makeEvidence({ evidenceId: 'c', documentId: 'doc-2', runId: 'run-orphan' }),
      ],
      new Set(['run-1']),
    );
    // doc-1 は孤児を無視して既知の run-1 を表示、doc-2 は孤児しかないため未抽出扱い
    expect(map.get('doc-1')?.runId).toBe('run-1');
    expect(map.get('doc-1')?.evidence.map((item) => item.evidenceId)).toEqual(['a']);
    expect(map.has('doc-2')).toBe(false);
  });
});

describe('loadVerifyTargets', () => {
  test('Evidence がある document を進捗チップ付きで組み立てる（Evidence なし文献は除外）', async () => {
    const store = makeStore({
      documents: [makeDocument(), makeDocument({ documentId: 'doc-no-evidence' })],
    });
    readAllDecisionsMock.mockResolvedValue([
      makeDecision(),
      makeDecision({ documentId: 'doc-other' }), // 他文献の判定は数えない
      makeDecision({ annotator: 'other@example.com', fieldId: 'f-x' }), // 他人の判定は数えない
    ]);
    await loadVerifyTargets(store, makeDeps());
    const { verify } = store.getState();
    expect(verify.loading).toBe(false);
    expect(verify.targets).toHaveLength(1);
    expect(verify.targets?.[0]).toMatchObject({
      schemaVersion: 1,
      progress: { decided: 1, total: 1 },
    });
    expect(verify.targets?.[0]?.document.documentId).toBe('doc-1');
  });

  test('同じ schema_version の fields 読み出しはキャッシュする', async () => {
    const store = makeStore({
      documents: [makeDocument(), makeDocument({ documentId: 'doc-2' })],
    });
    readEvidenceRowsMock.mockResolvedValue([
      makeEvidence(),
      makeEvidence({ evidenceId: 'ev-2', documentId: 'doc-2' }),
    ]);
    await loadVerifyTargets(store, makeDeps());
    expect(getSchemaFieldsMock).toHaveBeenCalledTimes(1);
    expect(store.getState().verify.targets).toHaveLength(2);
  });

  test('文献一覧が未読込なら readDocuments で解決する', async () => {
    const store = makeStore({ documents: null });
    readDocumentsMock.mockResolvedValue([makeDocument()]);
    await loadVerifyTargets(store, makeDeps());
    expect(readDocumentsMock).toHaveBeenCalledWith('sheet-1', expect.anything());
    expect(store.getState().verify.targets).toHaveLength(1);
  });

  test('読込済み・読込中・プロジェクト未選択はスキップし、force で再読込する', async () => {
    await loadVerifyTargets(makeStore({ withProject: false }), makeDeps());
    expect(readEvidenceRowsMock).not.toHaveBeenCalled();

    const loading = makeStore({ verify: { loading: true } });
    await loadVerifyTargets(loading, makeDeps());
    expect(readEvidenceRowsMock).not.toHaveBeenCalled();

    const loaded = makeStore({ documents: [makeDocument()], verify: { targets: [] } });
    await loadVerifyTargets(loaded, makeDeps());
    expect(readEvidenceRowsMock).not.toHaveBeenCalled();
    await loadVerifyTargets(loaded, makeDeps(), { force: true });
    expect(readEvidenceRowsMock).toHaveBeenCalledTimes(1);
  });

  test('ExtractionRuns に無い run_id（孤児 Evidence）はエラーにせず未抽出として除外する', async () => {
    const store = makeStore({ documents: [makeDocument()] });
    readRunSchemaVersionsMock.mockResolvedValue(new Map());
    await loadVerifyTargets(store, makeDeps());
    expect(store.getState().verify.loadError).toBeNull();
    expect(store.getState().verify.targets).toHaveLength(0);
    expect(store.getState().verify.loading).toBe(false);
  });

  test('読み込み失敗は loadError（Error 以外は文字列化）', async () => {
    const store = makeStore({ documents: [makeDocument()] });
    readEvidenceRowsMock.mockRejectedValue('壊れた応答');
    await loadVerifyTargets(store, makeDeps());
    expect(store.getState().verify.loadError).toBe('壊れた応答');
  });

  test('email 不明（null）は空文字 annotator として進捗を数える', async () => {
    const store = makeStore({ documents: [makeDocument()] });
    getCurrentUserEmailMock.mockResolvedValue(null);
    readAllDecisionsMock.mockResolvedValue([makeDecision()]); // ME の判定は数えない
    await loadVerifyTargets(store, makeDeps());
    expect(store.getState().verify.targets?.[0]?.progress).toEqual({ decided: 0, total: 1 });
  });
});

describe('openVerifyDocument', () => {
  test('検証データ束を読み込み、selectedDocumentId と studyValues を反映する', async () => {
    const store = makeStore({ verify: { targets: [makeTarget()] } });
    readStudyDataSheetMock.mockResolvedValue({
      fieldNames: ['sample_size_total'],
      rows: [
        {
          documentId: 'doc-1',
          annotator: ME,
          annotatorType: 'human_with_ai',
          schemaVersion: 1,
          runId: null,
          updatedAt: 't0',
          values: { sample_size_total: '100' },
        },
      ],
    });
    await openVerifyDocument(store, makeDeps(), 'doc-1');
    const { verify } = store.getState();
    expect(verify.selectedDocumentId).toBe('doc-1');
    expect(verify.verifyLoading).toBe(false);
    expect(verify.verification?.annotator).toBe(ME);
    expect(verify.verification?.armStructure).toBeNull();
    expect(verify.studyValues).toEqual({ sample_size_total: '100' });
  });

  test('一覧に無い document_id は verifyError にして選び直せる', async () => {
    const store = makeStore({ verify: { targets: [makeTarget()] } });
    await openVerifyDocument(store, makeDeps(), 'doc-9');
    expect(store.getState().verify.verifyError).toContain('doc-9 が見つかりません');
    expect(readDecisionsMock).not.toHaveBeenCalled();
  });

  test('プロジェクト未選択・一覧未読込・読込中はスキップする', async () => {
    await openVerifyDocument(makeStore({ withProject: false }), makeDeps(), 'doc-1');
    await openVerifyDocument(makeStore({}), makeDeps(), 'doc-1');
    await openVerifyDocument(
      makeStore({ verify: { targets: [makeTarget()], verifyLoading: true } }),
      makeDeps(),
      'doc-1',
    );
    expect(readDecisionsMock).not.toHaveBeenCalled();
  });

  test('文献切替時は前の PDF を破棄する', async () => {
    const store = makeStore({
      verify: {
        targets: [
          makeTarget(),
          makeTarget({ document: makeDocument({ documentId: 'doc-2', driveFileId: 'drive-2' }) }),
        ],
      },
    });
    const pdf = makePdf();
    const deps = makeDeps({ loadPdf: jest.fn().mockResolvedValue(pdf) });
    await openVerifyDocument(store, deps, 'doc-1');
    expect(pdf.destroy).not.toHaveBeenCalled();
    await openVerifyDocument(store, deps, 'doc-2');
    expect(pdf.destroy).toHaveBeenCalledTimes(1);
    expect(store.getState().verify.selectedDocumentId).toBe('doc-2');
  });

  test('読み込み失敗は verifyError に落ちる', async () => {
    const store = makeStore({ verify: { targets: [makeTarget()] } });
    readDecisionsMock.mockRejectedValue(new Error('権限がありません'));
    await openVerifyDocument(store, makeDeps(), 'doc-1');
    expect(store.getState().verify.verifyError).toBe('権限がありません');
    expect(store.getState().verify.verifyLoading).toBe(false);
  });
});

describe('persistVerifyDecision', () => {
  function makeVerifyingStore(fields: SchemaField[] = [makeField()]): Store {
    return makeStore({
      verify: {
        targets: [makeTarget({ fields })],
        selectedDocumentId: 'doc-1',
        studyValues: { country: 'Japan' },
      },
    });
  }

  test('プロジェクト未選択は何もしない', async () => {
    await persistVerifyDecision(makeStore({ withProject: false }), makeDeps(), makeDecision());
    expect(appendDecisionsMock).not.toHaveBeenCalled();
  });

  test('スキーマに無い field_id はトーストだけ出して保存しない', async () => {
    const store = makeVerifyingStore();
    await persistVerifyDecision(store, makeDeps(), makeDecision({ fieldId: 'f-ghost' }));
    expect(appendDecisionsMock).not.toHaveBeenCalled();
  });

  test('study 項目: values 全量スナップショットで StudyData を upsert → Decisions 追記', async () => {
    const store = makeVerifyingStore();
    const deps = makeDeps();
    const decision = makeDecision();
    await persistVerifyDecision(store, deps, decision);
    expect(upsertStudyMock).toHaveBeenCalledWith(
      'sheet-1',
      [
        expect.objectContaining({
          documentId: 'doc-1',
          annotator: ME,
          values: { country: 'Japan', sample_size_total: '120' },
        }),
      ],
      deps.google,
    );
    expect(appendDecisionsMock).toHaveBeenCalledWith('sheet-1', [decision], deps.google);
    expect(store.getState().verify.studyValues).toEqual({
      country: 'Japan',
      sample_size_total: '120',
    });
    expect(store.getState().verify.queuedDecisions).toBe(0);
  });

  test('arm 項目: ResultsData を upsert（studyValues は変えない）', async () => {
    const armField = makeField({ fieldId: 'f-arm-n', fieldName: 'arm_n', entityLevel: 'arm' });
    const store = makeVerifyingStore([armField]);
    const deps = makeDeps();
    await persistVerifyDecision(
      store,
      deps,
      makeDecision({ fieldId: 'f-arm-n', entityKey: 'arm:1', value: '50' }),
    );
    expect(upsertResultsMock).toHaveBeenCalledWith(
      'sheet-1',
      [expect.objectContaining({ entityKey: 'arm:1', value: '50', notReported: false })],
      deps.google,
      { newUuid: deps.newUuid },
    );
    expect(store.getState().verify.studyValues).toEqual({ country: 'Japan' });
  });

  test('studyValues 未読込（null）でも当該項目だけのスナップショットで保存する', async () => {
    const store = makeStore({
      verify: { targets: [makeTarget()], selectedDocumentId: 'doc-1', studyValues: null },
    });
    await persistVerifyDecision(store, makeDeps(), makeDecision());
    expect(upsertStudyMock).toHaveBeenCalledWith(
      'sheet-1',
      [expect.objectContaining({ values: { sample_size_total: '120' } })],
      expect.anything(),
    );
  });

  test('保存失敗はオフラインキューへ退避して件数を増やす', async () => {
    const store = makeVerifyingStore();
    const deps = makeDeps();
    upsertStudyMock.mockRejectedValueOnce(new Error('offline'));
    await persistVerifyDecision(store, deps, makeDecision());
    expect(deps.decisionQueue?.enqueue).toHaveBeenCalled();
    expect(store.getState().verify.queuedDecisions).toBe(1);
  });

  test('保存成功後の flush 残数を queuedDecisions へ反映する', async () => {
    const store = makeVerifyingStore();
    const queue = makeQueue();
    queue.flush.mockResolvedValue({ flushedCount: 1, remainingCount: 3 });
    await persistVerifyDecision(store, makeDeps({ decisionQueue: queue }), makeDecision());
    expect(store.getState().verify.queuedDecisions).toBe(3);
  });
});

describe('persistVerifyArmConfirmation', () => {
  async function makeShowingStore(): Promise<Store> {
    const store = makeStore({ verify: { targets: [makeTarget()] } });
    await openVerifyDocument(store, makeDeps(), 'doc-1');
    return store;
  }

  test('表示中文献の群構成を ArmStructures へ追記する', async () => {
    const store = await makeShowingStore();
    const deps = makeDeps();
    appendArmVersionMock.mockResolvedValue({ version: 1, arms: [] });
    await persistVerifyArmConfirmation(store, deps, [{ armKey: 'arm:1', armName: '介入群' }]);
    expect(appendArmVersionMock).toHaveBeenCalledWith(
      'sheet-1',
      {
        documentId: 'doc-1',
        arms: [{ armKey: 'arm:1', armName: '介入群' }],
        annotator: ME,
        annotatorType: 'human_with_ai',
        confirmedAt: 't-now',
      },
      deps.google,
    );
  });

  test('now 未注入は既定の nowIso8601 を使う', async () => {
    const store = await makeShowingStore();
    appendArmVersionMock.mockResolvedValue({ version: 1, arms: [] });
    await persistVerifyArmConfirmation(store, makeDeps({ now: undefined }), [
      { armKey: 'arm:1', armName: 'A' },
    ]);
    expect(appendArmVersionMock.mock.calls.at(-1)?.[1].confirmedAt).toMatch(/^\d{4}-/);
  });

  test('プロジェクト未選択・検証データ未読込は何もしない', async () => {
    appendArmVersionMock.mockClear();
    await persistVerifyArmConfirmation(makeStore({ withProject: false }), makeDeps(), []);
    await persistVerifyArmConfirmation(makeStore({}), makeDeps(), []);
    expect(appendArmVersionMock).not.toHaveBeenCalled();
  });
});
