import {
  acceptAllMatchingCells,
  addAdjudicateArmDraftRow,
  adjudicateCellChoice,
  adjudicateCellCustomValue,
  adjudicateCellNotReported,
  adjudicateCellStates,
  backToAdjudicateList,
  confirmAdjudicateArms,
  downloadAgreementCsv,
  loadAdjudicateTargets,
  loadAgreementReport,
  openAdjudicateStudy,
  removeAdjudicateArmDraftRow,
  setAdjudicateArmMapping,
  setAdjudicateMismatchOnlyFilter,
  setAdjudicatePairSelection,
  skipAdjudicateCell,
  undoAdjudicateCell,
  unskipAdjudicateCell,
  updateAdjudicateArmDraftRow,
  type AdjudicationServiceDeps,
} from '../../../../src/app/services/adjudicationService';
import { createInitialState, createStore, type AdjudicateWorking, type Store } from '../../../../src/app/store';
import type { ResultsDataRow, StudyDataRow } from '../../../../src/domain/annotation';
import { NOT_REPORTED_TOKEN } from '../../../../src/domain/annotation';
import type { ArmStructureRow } from '../../../../src/domain/armStructure';
import type { Decision } from '../../../../src/domain/decision';
import type { DocumentRecord } from '../../../../src/domain/document';
import type { Evidence } from '../../../../src/domain/evidence';
import type { SchemaField } from '../../../../src/domain/schemaField';
import type { SchemaVersion } from '../../../../src/domain/schemaVersion';
import type { StudyRecord } from '../../../../src/domain/study';
import { applyConsensusWrites } from '../../../../src/features/adjudication/consensusRepository';
import { readDocuments } from '../../../../src/features/documents/documentRepository';
import { readStudies } from '../../../../src/features/documents/studyRepository';
import { readResultsDataRows, readStudyDataSheet } from '../../../../src/features/extraction/annotationRepository';
import { readEvidenceRows } from '../../../../src/features/extraction/evidenceRepository';
import { readRunSchemaVersions } from '../../../../src/features/extraction/runRepository';
import { getSchemaFieldsByVersion, listSchemaVersions } from '../../../../src/features/schema/schemaRepository';
import {
  appendArmStructureVersion,
  readAllArmStructures,
} from '../../../../src/features/verification/armStructureRepository';
import { readAllDecisions } from '../../../../src/features/verification/decisionRepository';
import { createPdfViewCache } from '../../../../src/features/verification/pdfViewCache';
import { getCurrentUserEmail } from '../../../../src/lib/google/identity';
import type { OfflineQueue } from '../../../../src/lib/storage/offlineQueue';
import { downloadTextFile } from '../../../../src/app/ui/download';
import type { QueuedWrite } from '../../../../src/app/services/verificationService';

jest.mock('../../../../src/app/ui/download', () => ({ downloadTextFile: jest.fn() }));
jest.mock('../../../../src/features/documents/documentRepository', () => ({ readDocuments: jest.fn() }));
jest.mock('../../../../src/features/documents/studyRepository', () => ({
  // resolveActiveStudies は純粋関数なので実物を使う（buildStudySelection が依存する）
  ...jest.requireActual('../../../../src/features/documents/studyRepository'),
  readStudies: jest.fn(),
}));
jest.mock('../../../../src/features/extraction/annotationRepository', () => ({
  readStudyDataSheet: jest.fn(),
  readResultsDataRows: jest.fn(),
}));
jest.mock('../../../../src/features/extraction/evidenceRepository', () => ({ readEvidenceRows: jest.fn() }));
jest.mock('../../../../src/features/extraction/runRepository', () => ({ readRunSchemaVersions: jest.fn() }));
jest.mock('../../../../src/features/schema/schemaRepository', () => ({
  listSchemaVersions: jest.fn(),
  getSchemaFieldsByVersion: jest.fn(),
}));
jest.mock('../../../../src/features/verification/armStructureRepository', () => ({
  // latestArmStructure は純粋関数なので実物を使う
  ...jest.requireActual('../../../../src/features/verification/armStructureRepository'),
  readAllArmStructures: jest.fn(),
  appendArmStructureVersion: jest.fn(),
}));
jest.mock('../../../../src/features/verification/decisionRepository', () => ({ readAllDecisions: jest.fn() }));
jest.mock('../../../../src/features/verification/pdfViewCache', () => ({ createPdfViewCache: jest.fn() }));
jest.mock('../../../../src/lib/google/identity', () => ({ getCurrentUserEmail: jest.fn() }));
jest.mock('../../../../src/features/adjudication/consensusRepository', () => ({ applyConsensusWrites: jest.fn() }));

const readDocumentsMock = readDocuments as jest.MockedFunction<typeof readDocuments>;
const readStudiesMock = readStudies as jest.MockedFunction<typeof readStudies>;
const readStudyDataSheetMock = readStudyDataSheet as jest.MockedFunction<typeof readStudyDataSheet>;
const readResultsDataRowsMock = readResultsDataRows as jest.MockedFunction<typeof readResultsDataRows>;
const readEvidenceRowsMock = readEvidenceRows as jest.MockedFunction<typeof readEvidenceRows>;
const readRunSchemaVersionsMock = readRunSchemaVersions as jest.MockedFunction<typeof readRunSchemaVersions>;
const listSchemaVersionsMock = listSchemaVersions as jest.MockedFunction<typeof listSchemaVersions>;
const getSchemaFieldsMock = getSchemaFieldsByVersion as jest.MockedFunction<typeof getSchemaFieldsByVersion>;
const readAllArmStructuresMock = readAllArmStructures as jest.MockedFunction<typeof readAllArmStructures>;
const appendArmVersionMock = appendArmStructureVersion as jest.MockedFunction<typeof appendArmStructureVersion>;
const readAllDecisionsMock = readAllDecisions as jest.MockedFunction<typeof readAllDecisions>;
const createPdfViewCacheMock = createPdfViewCache as jest.MockedFunction<typeof createPdfViewCache>;
const getCurrentUserEmailMock = getCurrentUserEmail as jest.MockedFunction<typeof getCurrentUserEmail>;
const applyConsensusWritesMock = applyConsensusWrites as jest.MockedFunction<typeof applyConsensusWrites>;

const JUDGE = 'judge@example.com';
const A = 'a@example.com';
const B = 'b@example.com';
const C = 'c@example.com';

function makeDocument(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    documentId: 'doc-1',
    studyId: 'study-1',
    documentRole: 'article',
    driveFileId: 'drive-1',
    sourceFileId: 'src-1',
    filename: 'smith2020.pdf',
    pmid: null,
    doi: null,
    textRef: null,
    textStatus: 'ok',
    pageCount: 1,
    charCount: 100,
    importedAt: 't0',
    importedBy: JUDGE,
    note: null,
    excluded: false,
    exclusionReason: null,
    exclusionNote: null,
    excludedAt: null,
    ...overrides,
  };
}

function makeStudy(overrides: Partial<StudyRecord> = {}): StudyRecord {
  return {
    studyId: 'study-1',
    studyLabel: 'Smith 2020',
    registrationId: null,
    createdAt: 't0',
    createdBy: JUDGE,
    note: null,
    ...overrides,
  };
}

function makeField(overrides: Partial<SchemaField> = {}): SchemaField {
  return {
    schemaVersion: 1,
    fieldId: 'f-1',
    fieldIndex: 1,
    section: 'population',
    fieldName: 'sample_size',
    fieldLabel: '総サンプルサイズ',
    entityLevel: 'study',
    dataType: 'text',
    unit: null,
    allowedValues: null,
    required: false,
    extractionInstruction: '',
    example: null,
    aiGenerated: false,
    note: null,
    ...overrides,
  };
}

function makeSchemaVersion(overrides: Partial<SchemaVersion> = {}): SchemaVersion {
  return {
    schemaVersion: 1,
    parentVersion: null,
    protocolVersion: 1,
    createdByType: 'ai_draft',
    createdAt: 't0',
    createdBy: JUDGE,
    note: null,
    ...overrides,
  };
}

function makeStudyDataRow(overrides: Partial<StudyDataRow> = {}): StudyDataRow {
  return {
    studyId: 'study-1',
    annotator: A,
    annotatorType: 'human_with_ai',
    schemaVersion: 1,
    runId: null,
    updatedAt: 't0',
    values: { sample_size: '120' },
    ...overrides,
  };
}

function makeResultsRow(overrides: Partial<ResultsDataRow> = {}): ResultsDataRow {
  return {
    resultId: 'r-1',
    studyId: 'study-1',
    fieldId: 'f-1',
    annotator: A,
    annotatorType: 'human_with_ai',
    schemaVersion: 1,
    entityKey: '-',
    runId: null,
    value: '10',
    notReported: false,
    updatedAt: 't0',
    ...overrides,
  };
}

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    decidedAt: 't0',
    decidedBy: A,
    studyId: 'study-1',
    fieldId: 'f-1',
    entityKey: '-',
    annotator: A,
    annotatorType: 'human_with_ai',
    schemaVersion: 1,
    action: 'accept',
    value: '120',
    note: null,
    ...overrides,
  };
}

function makeArmRow(overrides: Partial<ArmStructureRow> = {}): ArmStructureRow {
  return {
    studyId: 'study-1',
    version: 1,
    armKey: 'arm:1',
    armName: '介入群',
    annotator: A,
    annotatorType: 'human_with_ai',
    confirmedAt: 't0',
    note: null,
    ...overrides,
  };
}

function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    evidenceId: 'ev-1',
    runId: 'run-1',
    studyId: 'study-1',
    fieldId: 'f-1',
    documentId: 'doc-1',
    entityKey: '-',
    value: '120',
    notReported: false,
    quote: '合計 120 例',
    page: 1,
    confidence: 'high',
    anchorStatus: 'exact',
    bboxPage: null,
    bbox: null,
    relocatedFrom: null,
    ...overrides,
  };
}

/** issue #63: adjudicationService.applyWrites が検証側と共有する 'decisions' キューのモック */
function makeQueue(): jest.Mocked<OfflineQueue<QueuedWrite>> {
  return {
    enqueue: jest.fn().mockResolvedValue(undefined),
    flush: jest.fn().mockResolvedValue({ flushedCount: 0, remainingCount: 0 }),
  };
}

function makeDeps(overrides: Partial<AdjudicationServiceDeps> = {}): AdjudicationServiceDeps {
  return {
    google: { fetch: jest.fn(), getAccessToken: jest.fn() },
    profile: { getProfileUserInfo: jest.fn() } as unknown as AdjudicationServiceDeps['profile'],
    loadPdf: jest.fn(),
    decisionQueue: makeQueue(),
    now: () => 't-now',
    ...overrides,
  };
}

/** 100% 完了とみなせる study 単位の判定セット（study レベル項目 1 つを両者が判定済み） */
function completeDecisionsFor(annotator: string): Decision[] {
  return [makeDecision({ annotator, decidedBy: annotator })];
}

function setupTwoAnnotatorsReady(): void {
  readDocumentsMock.mockResolvedValue([makeDocument()]);
  readStudiesMock.mockResolvedValue([makeStudy()]);
  readStudyDataSheetMock.mockResolvedValue({
    fieldNames: ['sample_size'],
    rows: [makeStudyDataRow({ annotator: A }), makeStudyDataRow({ annotator: B })],
  });
  readResultsDataRowsMock.mockResolvedValue([]);
  readAllDecisionsMock.mockResolvedValue([...completeDecisionsFor(A), ...completeDecisionsFor(B)]);
  readAllArmStructuresMock.mockResolvedValue([]);
  listSchemaVersionsMock.mockResolvedValue([makeSchemaVersion()]);
  getSchemaFieldsMock.mockResolvedValue([makeField()]);
}

/** 3 名の human annotator（A・B は検証完了、C は未完了）を持つ study のセットアップ（issue #63） */
function setupThreeAnnotators(): void {
  readDocumentsMock.mockResolvedValue([makeDocument()]);
  readStudiesMock.mockResolvedValue([makeStudy()]);
  readStudyDataSheetMock.mockResolvedValue({
    fieldNames: ['sample_size'],
    rows: [
      makeStudyDataRow({ annotator: A }),
      makeStudyDataRow({ annotator: B }),
      makeStudyDataRow({ annotator: C }),
    ],
  });
  readResultsDataRowsMock.mockResolvedValue([]);
  readAllDecisionsMock.mockResolvedValue([...completeDecisionsFor(A), ...completeDecisionsFor(B)]);
  readAllArmStructuresMock.mockResolvedValue([]);
  listSchemaVersionsMock.mockResolvedValue([makeSchemaVersion()]);
  getSchemaFieldsMock.mockResolvedValue([makeField()]);
}

/** arm 並べ替えマッピングの検証用: 群 2 本を互いに逆順で確定した 2 名のセットアップ（issue #63） */
function setupReversedArms(): void {
  const armFields = [
    makeField(),
    makeField({ fieldId: 'f-arm', fieldName: 'arm_name', fieldLabel: '群名', entityLevel: 'arm', fieldIndex: 2 }),
  ];
  const armComplete = (annotator: string): Decision[] => [
    makeDecision({ annotator, decidedBy: annotator }),
    makeDecision({ annotator, decidedBy: annotator, fieldId: 'f-arm', entityKey: 'arm:1' }),
    makeDecision({ annotator, decidedBy: annotator, fieldId: 'f-arm', entityKey: 'arm:2' }),
  ];
  readDocumentsMock.mockResolvedValue([makeDocument()]);
  readStudiesMock.mockResolvedValue([makeStudy()]);
  readStudyDataSheetMock.mockResolvedValue({
    fieldNames: ['sample_size'],
    rows: [makeStudyDataRow({ annotator: A }), makeStudyDataRow({ annotator: B })],
  });
  readResultsDataRowsMock.mockResolvedValue([
    makeResultsRow({ resultId: 'r-a1', fieldId: 'f-arm', annotator: A, entityKey: 'arm:1', value: 'プラセボ群' }),
    makeResultsRow({ resultId: 'r-a2', fieldId: 'f-arm', annotator: A, entityKey: 'arm:2', value: '介入群' }),
    makeResultsRow({ resultId: 'r-b1', fieldId: 'f-arm', annotator: B, entityKey: 'arm:1', value: '介入群' }),
    makeResultsRow({ resultId: 'r-b2', fieldId: 'f-arm', annotator: B, entityKey: 'arm:2', value: 'プラセボ群' }),
  ]);
  readAllDecisionsMock.mockResolvedValue([...armComplete(A), ...armComplete(B)]);
  readAllArmStructuresMock.mockResolvedValue([
    makeArmRow({ annotator: A, armKey: 'arm:1', armName: 'プラセボ群' }),
    makeArmRow({ annotator: A, armKey: 'arm:2', armName: '介入群' }),
    makeArmRow({ annotator: B, armKey: 'arm:1', armName: '介入群' }),
    makeArmRow({ annotator: B, armKey: 'arm:2', armName: 'プラセボ群' }),
  ]);
  listSchemaVersionsMock.mockResolvedValue([makeSchemaVersion()]);
  getSchemaFieldsMock.mockResolvedValue(armFields);
}

/**
 * B の素通しキー衝突検知（issue #117 件2）の検証用: A は arm:1（X）・arm:2（Y）、
 * B は確定 ArmStructures で arm:5（Y）・arm:6（X）を使う（既定マッピングで arm:6→arm:1・
 * arm:5→arm:2 になる）。B の ResultsData には確定構成に無い素通しキー 'arm:1'（辞書の写像先
 * 'arm:1' と文字列衝突する）を追加し、退避されないと B の arm:6 由来データが無言で潰れることを
 * 確認できるようにする
 */
function setupCollisionArms(): void {
  const armFields = [
    makeField(),
    makeField({ fieldId: 'f-arm', fieldName: 'arm_name', fieldLabel: '群名', entityLevel: 'arm', fieldIndex: 2 }),
  ];
  const armComplete = (annotator: string, armKeys: readonly string[]): Decision[] => [
    makeDecision({ annotator, decidedBy: annotator }),
    ...armKeys.map((entityKey) => makeDecision({ annotator, decidedBy: annotator, fieldId: 'f-arm', entityKey })),
  ];
  readDocumentsMock.mockResolvedValue([makeDocument()]);
  readStudiesMock.mockResolvedValue([makeStudy()]);
  readStudyDataSheetMock.mockResolvedValue({
    fieldNames: ['sample_size'],
    rows: [makeStudyDataRow({ annotator: A }), makeStudyDataRow({ annotator: B })],
  });
  readResultsDataRowsMock.mockResolvedValue([
    makeResultsRow({ resultId: 'r-a1', fieldId: 'f-arm', annotator: A, entityKey: 'arm:1', value: 'X値' }),
    makeResultsRow({ resultId: 'r-a2', fieldId: 'f-arm', annotator: A, entityKey: 'arm:2', value: 'Y値' }),
    makeResultsRow({ resultId: 'r-b5', fieldId: 'f-arm', annotator: B, entityKey: 'arm:5', value: 'B5値' }),
    makeResultsRow({ resultId: 'r-b6', fieldId: 'f-arm', annotator: B, entityKey: 'arm:6', value: 'B6値' }),
    // B の確定 ArmStructures（arm:5 / arm:6）に無い素通しキー（evidence 由来の旧データ想定）
    makeResultsRow({ resultId: 'r-b-stray', fieldId: 'f-arm', annotator: B, entityKey: 'arm:1', value: 'stray値' }),
  ]);
  readAllDecisionsMock.mockResolvedValue([
    ...armComplete(A, ['arm:1', 'arm:2']),
    ...armComplete(B, ['arm:5', 'arm:6']),
  ]);
  readAllArmStructuresMock.mockResolvedValue([
    makeArmRow({ annotator: A, armKey: 'arm:1', armName: 'X' }),
    makeArmRow({ annotator: A, armKey: 'arm:2', armName: 'Y' }),
    makeArmRow({ annotator: B, armKey: 'arm:5', armName: 'Y' }),
    makeArmRow({ annotator: B, armKey: 'arm:6', armName: 'X' }),
  ]);
  listSchemaVersionsMock.mockResolvedValue([makeSchemaVersion()]);
  getSchemaFieldsMock.mockResolvedValue(armFields);
}

function toastTexts(): string[] {
  return Array.from(document.querySelectorAll('.toast')).map((node) => node.textContent ?? '');
}

function makeFakePdfCache(): { load: jest.Mock; retry: jest.Mock; disposeAll: jest.Mock } {
  return {
    load: jest.fn().mockResolvedValue({ pdf: null, pdfError: 'stub', textPages: [] }),
    retry: jest.fn().mockResolvedValue({ pdf: null, pdfError: 'stub', textPages: [] }),
    disposeAll: jest.fn().mockResolvedValue(undefined),
  };
}

function seedStore(): Store {
  const state = createInitialState();
  state.currentProject = { projectId: 'p1', spreadsheetId: 'sheet-1', driveFolderId: 'f1', name: 'P' };
  return createStore(state);
}

beforeEach(() => {
  jest.clearAllMocks();
  document.body.innerHTML = ''; // issue #117 件2: トースト検証テストが前のテストの残骸を拾わないようにする
  getCurrentUserEmailMock.mockResolvedValue(JUDGE);
  createPdfViewCacheMock.mockReturnValue(makeFakePdfCache());
  applyConsensusWritesMock.mockResolvedValue(undefined);
  readEvidenceRowsMock.mockResolvedValue([]);
  readRunSchemaVersionsMock.mockResolvedValue(new Map());
  // issue #117 件3: collectReadyStudyInputs も readAllArmStructures を読むため既定は空配列にしておく
  // （arm マッピングを検証するテストは各自 mockResolvedValue で上書きする）
  readAllArmStructuresMock.mockResolvedValue([]);
});

describe('loadAdjudicateTargets', () => {
  test('プロジェクト未選択は no-op', async () => {
    const store = createStore();
    await loadAdjudicateTargets(store, makeDeps());
    expect(readDocumentsMock).not.toHaveBeenCalled();
  });

  test('読込済み（force なし）は再読込しない', async () => {
    const store = seedStore();
    setupTwoAnnotatorsReady();
    await loadAdjudicateTargets(store, makeDeps());
    expect(readDocumentsMock).toHaveBeenCalledTimes(1);
    await loadAdjudicateTargets(store, makeDeps());
    expect(readDocumentsMock).toHaveBeenCalledTimes(1);
  });

  test('force=true は再読込する', async () => {
    const store = seedStore();
    setupTwoAnnotatorsReady();
    await loadAdjudicateTargets(store, makeDeps());
    await loadAdjudicateTargets(store, makeDeps(), { force: true });
    expect(readDocumentsMock).toHaveBeenCalledTimes(2);
  });

  test('確定済みスキーマが無い（versions 空）と fields=[] のまま一覧を組む', async () => {
    const store = seedStore();
    readDocumentsMock.mockResolvedValue([makeDocument()]);
    readStudiesMock.mockResolvedValue([makeStudy()]);
    readStudyDataSheetMock.mockResolvedValue({ fieldNames: [], rows: [] });
    readResultsDataRowsMock.mockResolvedValue([]);
    readAllDecisionsMock.mockResolvedValue([]);
    readAllArmStructuresMock.mockResolvedValue([]);
    listSchemaVersionsMock.mockResolvedValue([]);
    await loadAdjudicateTargets(store, makeDeps());
    expect(getSchemaFieldsMock).not.toHaveBeenCalled();
    expect(store.getState().adjudicate.rows).toEqual([
      { study: makeStudy(), pair: { kind: 'waiting', annotators: [] }, gate: null, pairOptions: null },
    ]);
  });

  test('human annotator が 2 名そろい・両者 100% なら ready な gate を計算する', async () => {
    const store = seedStore();
    setupTwoAnnotatorsReady();
    await loadAdjudicateTargets(store, makeDeps());
    const rows = store.getState().adjudicate.rows;
    expect(rows).toHaveLength(1);
    expect(rows?.[0]?.pair).toEqual({ kind: 'ready', annotatorA: A, annotatorB: B });
    expect(rows?.[0]?.gate?.ready).toBe(true);
  });

  test('1 名以下は gate=null（waiting）', async () => {
    const store = seedStore();
    readDocumentsMock.mockResolvedValue([makeDocument()]);
    readStudiesMock.mockResolvedValue([makeStudy()]);
    readStudyDataSheetMock.mockResolvedValue({ fieldNames: [], rows: [makeStudyDataRow({ annotator: A })] });
    readResultsDataRowsMock.mockResolvedValue([]);
    readAllDecisionsMock.mockResolvedValue([]);
    readAllArmStructuresMock.mockResolvedValue([]);
    listSchemaVersionsMock.mockResolvedValue([makeSchemaVersion()]);
    getSchemaFieldsMock.mockResolvedValue([makeField()]);
    await loadAdjudicateTargets(store, makeDeps());
    expect(store.getState().adjudicate.rows?.[0]?.pair.kind).toBe('waiting');
    expect(store.getState().adjudicate.rows?.[0]?.gate).toBeNull();
  });

  test('3 名以上は selectable として全 2 名組合せのゲートを事前計算する（issue #63）', async () => {
    const store = seedStore();
    setupThreeAnnotators();
    await loadAdjudicateTargets(store, makeDeps());
    const row = store.getState().adjudicate.rows?.[0];
    expect(row?.pair.kind).toBe('selectable');
    expect(row?.gate).toBeNull();
    expect(row?.pairOptions?.map((o) => [o.annotatorA, o.annotatorB])).toEqual([
      [A, B],
      [A, C],
      [B, C],
    ]);
    // A・B は完了済み、C は未完了 → A×B のみ ready
    expect(row?.pairOptions?.[0]?.gate.ready).toBe(true);
    expect(row?.pairOptions?.[1]?.gate.ready).toBe(false);
    expect(row?.pairOptions?.[2]?.gate.ready).toBe(false);
  });

  test('documents / studies が documents スライスに読込済みならそれを使う（再読込しない）', async () => {
    const store = seedStore();
    store.setState({
      documents: { ...store.getState().documents, records: [makeDocument()], studies: [makeStudy()] },
    });
    readStudyDataSheetMock.mockResolvedValue({ fieldNames: [], rows: [] });
    readResultsDataRowsMock.mockResolvedValue([]);
    readAllDecisionsMock.mockResolvedValue([]);
    readAllArmStructuresMock.mockResolvedValue([]);
    listSchemaVersionsMock.mockResolvedValue([]);
    await loadAdjudicateTargets(store, makeDeps());
    expect(readDocumentsMock).not.toHaveBeenCalled();
    expect(readStudiesMock).not.toHaveBeenCalled();
  });

  test('読込失敗は loadError へ', async () => {
    const store = seedStore();
    readDocumentsMock.mockRejectedValue(new Error('boom'));
    await loadAdjudicateTargets(store, makeDeps());
    expect(store.getState().adjudicate.loadError).toBe('boom');
    expect(store.getState().adjudicate.loading).toBe(false);
  });

  test('Error インスタンスでない失敗も文字列化して loadError へ', async () => {
    const store = seedStore();
    readDocumentsMock.mockRejectedValue('boom-string');
    await loadAdjudicateTargets(store, makeDeps());
    expect(store.getState().adjudicate.loadError).toBe('boom-string');
  });

  test('読込中の重複呼び出しは無視する', async () => {
    const store = seedStore();
    let resolveRead: (value: DocumentRecord[]) => void = () => undefined;
    readDocumentsMock.mockReturnValue(
      new Promise((resolve) => {
        resolveRead = resolve;
      }),
    );
    const first = loadAdjudicateTargets(store, makeDeps());
    await loadAdjudicateTargets(store, makeDeps());
    expect(readDocumentsMock).toHaveBeenCalledTimes(1);
    resolveRead([]);
    readStudiesMock.mockResolvedValue([]);
    await first;
  });
});

describe('openAdjudicateStudy', () => {
  test('rows 未読込・プロジェクト未選択は no-op', async () => {
    const store = seedStore();
    await openAdjudicateStudy(store, makeDeps(), 'study-1');
    expect(store.getState().adjudicate.working).toBeNull();
  });

  test('存在しない study_id は「見つかりません」', async () => {
    const store = seedStore();
    setupTwoAnnotatorsReady();
    await loadAdjudicateTargets(store, makeDeps());
    await openAdjudicateStudy(store, makeDeps(), 'study-unknown');
    expect(store.getState().adjudicate.workingError).toBe('指定された研究が見つかりません');
    expect(store.getState().adjudicate.working).toBeNull();
  });

  test('pair が waiting の study は「両者の検証完了待ち」', async () => {
    const store = seedStore();
    readDocumentsMock.mockResolvedValue([makeDocument()]);
    readStudiesMock.mockResolvedValue([makeStudy()]);
    readStudyDataSheetMock.mockResolvedValue({ fieldNames: [], rows: [] });
    readResultsDataRowsMock.mockResolvedValue([]);
    readAllDecisionsMock.mockResolvedValue([]);
    readAllArmStructuresMock.mockResolvedValue([]);
    listSchemaVersionsMock.mockResolvedValue([]);
    await loadAdjudicateTargets(store, makeDeps());
    await openAdjudicateStudy(store, makeDeps(), 'study-1');
    expect(store.getState().adjudicate.workingError).toContain('両者の検証完了待ち');
  });

  test('selectable（3 名以上）で未選択のまま開くと「2 名のレビュアーを選択してください」（issue #63）', async () => {
    const store = seedStore();
    setupThreeAnnotators();
    await loadAdjudicateTargets(store, makeDeps());
    await openAdjudicateStudy(store, makeDeps(), 'study-1');
    expect(store.getState().adjudicate.workingError).toContain('裁定する 2 名のレビュアーを選択してください');
  });

  test('selectable: 選択が pairOptions に無い（無効な選択）も未選択と同じ案内', async () => {
    const store = seedStore();
    setupThreeAnnotators();
    await loadAdjudicateTargets(store, makeDeps());
    setAdjudicatePairSelection(store, 'study-1', { annotatorA: 'x@example.com', annotatorB: 'y@example.com' });
    await openAdjudicateStudy(store, makeDeps(), 'study-1');
    expect(store.getState().adjudicate.workingError).toContain('裁定する 2 名のレビュアーを選択してください');
  });

  test('selectable: pairOptions が null（想定外の不整合）でも選択案内で防御する', async () => {
    const store = seedStore();
    setupThreeAnnotators();
    await loadAdjudicateTargets(store, makeDeps());
    const rows = store.getState().adjudicate.rows ?? [];
    store.setState({
      adjudicate: {
        ...store.getState().adjudicate,
        rows: rows.map((row) => ({ ...row, pairOptions: null })),
      },
    });
    await openAdjudicateStudy(store, makeDeps(), 'study-1');
    expect(store.getState().adjudicate.workingError).toContain('裁定する 2 名のレビュアーを選択してください');
  });

  test('selectable: ゲート未達の組（C を含む）を選ぶと「まだ両者の検証が完了していない」', async () => {
    const store = seedStore();
    setupThreeAnnotators();
    await loadAdjudicateTargets(store, makeDeps());
    setAdjudicatePairSelection(store, 'study-1', { annotatorA: A, annotatorB: C });
    await openAdjudicateStudy(store, makeDeps(), 'study-1');
    expect(store.getState().adjudicate.workingError).toContain('まだ両者の検証が完了していない');
  });

  test('selectable: ゲート達成の組（A×B）を選ぶと選択ペアで working を組み立てる', async () => {
    const store = seedStore();
    setupThreeAnnotators();
    await loadAdjudicateTargets(store, makeDeps());
    setAdjudicatePairSelection(store, 'study-1', { annotatorA: A, annotatorB: B });
    await openAdjudicateStudy(store, makeDeps(), 'study-1');
    const working = store.getState().adjudicate.working;
    expect(working?.annotatorA).toBe(A);
    expect(working?.annotatorB).toBe(B);
    expect(store.getState().adjudicate.workingError).toBeNull();
  });

  test('ゲート未達（片方だけ完了）は「まだ両者の検証が完了していない」', async () => {
    const store = seedStore();
    readDocumentsMock.mockResolvedValue([makeDocument()]);
    readStudiesMock.mockResolvedValue([makeStudy()]);
    readStudyDataSheetMock.mockResolvedValue({
      fieldNames: ['sample_size'],
      rows: [makeStudyDataRow({ annotator: A }), makeStudyDataRow({ annotator: B })],
    });
    readResultsDataRowsMock.mockResolvedValue([]);
    readAllDecisionsMock.mockResolvedValue(completeDecisionsFor(A));
    readAllArmStructuresMock.mockResolvedValue([]);
    listSchemaVersionsMock.mockResolvedValue([makeSchemaVersion()]);
    getSchemaFieldsMock.mockResolvedValue([makeField()]);
    await loadAdjudicateTargets(store, makeDeps());
    await openAdjudicateStudy(store, makeDeps(), 'study-1');
    expect(store.getState().adjudicate.workingError).toContain('まだ両者の検証が完了していない');
  });

  test('ready な study を開くと working データを組み立てる（群構成 armsMatched・cells・consensusDecisions）', async () => {
    const store = seedStore();
    setupTwoAnnotatorsReady();
    readAllArmStructuresMock.mockResolvedValue([
      makeArmRow({ annotator: A, armName: '介入群' }),
      makeArmRow({ annotator: B, armName: '介入群' }),
      makeArmRow({ annotator: 'consensus', annotatorType: 'consensus', armName: '介入群（確定）' }),
    ]);
    await loadAdjudicateTargets(store, makeDeps());
    await openAdjudicateStudy(store, makeDeps(), 'study-1');
    const working = store.getState().adjudicate.working;
    expect(working).not.toBeNull();
    expect(working?.annotatorA).toBe(A);
    expect(working?.annotatorB).toBe(B);
    expect(working?.armsMatched).toBe(true);
    expect(working?.consensusArmStructure?.arms[0]?.armName).toBe('介入群（確定）');
    expect(working?.cells).toHaveLength(1);
    expect(store.getState().adjudicate.workingLoading).toBe(false);
    expect(store.getState().adjudicate.workingError).toBeNull();
  });

  test('working.evidence は表示する run（study の最新・既知 run）の Evidence のみを持つ（issue #63）', async () => {
    const store = seedStore();
    setupTwoAnnotatorsReady();
    readEvidenceRowsMock.mockResolvedValue([
      makeEvidence({ evidenceId: 'ev-old', runId: 'run-old' }), // 既知 run だが古い run（study-1 の最新は run-1）
      makeEvidence({ evidenceId: 'ev-1', runId: 'run-1' }),
      makeEvidence({ evidenceId: 'ev-orphan', runId: 'run-orphan', studyId: 'study-1' }), // 未知 run（孤児 Evidence）
      makeEvidence({ evidenceId: 'ev-other-study', runId: 'run-1', studyId: 'study-2' }),
    ]);
    readRunSchemaVersionsMock.mockResolvedValue(
      new Map([
        ['run-old', 1],
        ['run-1', 1],
      ]),
    );
    await loadAdjudicateTargets(store, makeDeps());
    await openAdjudicateStudy(store, makeDeps(), 'study-1');
    const working = store.getState().adjudicate.working;
    expect(working?.evidence).toEqual([makeEvidence({ evidenceId: 'ev-1', runId: 'run-1' })]);
  });

  test('working.evidence は AI 抽出が未実施（Evidence 0 件）の study では空配列（独立入力のみのペア）', async () => {
    const store = seedStore();
    setupTwoAnnotatorsReady();
    await loadAdjudicateTargets(store, makeDeps());
    await openAdjudicateStudy(store, makeDeps(), 'study-1');
    expect(store.getState().adjudicate.working?.evidence).toEqual([]);
  });

  test('cells の noteA / noteB は各 annotator の Decisions（study 内）の直近の note を畳み込む（issue #63）', async () => {
    const store = seedStore();
    setupTwoAnnotatorsReady();
    readAllDecisionsMock.mockResolvedValue([
      ...completeDecisionsFor(A),
      ...completeDecisionsFor(B),
      // A の f-1 セルへの判定履歴: 古い note → 新しい note（新しい方が採用される）
      makeDecision({ annotator: A, decidedBy: A, decidedAt: 't1', note: '古いメモ' }),
      makeDecision({ annotator: A, decidedBy: A, decidedAt: 't2', note: 'Table 2 を採用' }),
      // B の f-1 セルへの判定は note 無し
      makeDecision({ annotator: B, decidedBy: B, decidedAt: 't1', note: null }),
      // 他 study のノイズ（混入しないことを確認）
      makeDecision({ annotator: A, decidedBy: A, studyId: 'study-2', note: '別研究のメモ' }),
    ]);
    await loadAdjudicateTargets(store, makeDeps());
    await openAdjudicateStudy(store, makeDeps(), 'study-1');
    const cell = store.getState().adjudicate.working?.cells[0];
    expect(cell?.noteA).toBe('Table 2 を採用');
    expect(cell?.noteB).toBeNull();
  });

  test('annotator に StudyData 行が無ければその側は未入力（null）として扱う', async () => {
    const store = seedStore();
    readDocumentsMock.mockResolvedValue([makeDocument()]);
    readStudiesMock.mockResolvedValue([makeStudy()]);
    // B は StudyData 行を持たず、Decisions のみで human と認識される
    readStudyDataSheetMock.mockResolvedValue({
      fieldNames: ['sample_size'],
      rows: [makeStudyDataRow({ annotator: A })],
    });
    readResultsDataRowsMock.mockResolvedValue([]);
    readAllDecisionsMock.mockResolvedValue([...completeDecisionsFor(A), ...completeDecisionsFor(B)]);
    readAllArmStructuresMock.mockResolvedValue([]);
    listSchemaVersionsMock.mockResolvedValue([makeSchemaVersion()]);
    getSchemaFieldsMock.mockResolvedValue([makeField()]);
    await loadAdjudicateTargets(store, makeDeps());
    await openAdjudicateStudy(store, makeDeps(), 'study-1');
    const cell = store.getState().adjudicate.working?.cells[0];
    expect(cell?.valueA).toBe('120');
    expect(cell?.valueB).toBeNull();
  });

  test('A 側に StudyData 行が無い場合も同様に未入力（null）として扱う', async () => {
    const store = seedStore();
    readDocumentsMock.mockResolvedValue([makeDocument()]);
    readStudiesMock.mockResolvedValue([makeStudy()]);
    readStudyDataSheetMock.mockResolvedValue({
      fieldNames: ['sample_size'],
      rows: [makeStudyDataRow({ annotator: B })],
    });
    readResultsDataRowsMock.mockResolvedValue([]);
    readAllDecisionsMock.mockResolvedValue([...completeDecisionsFor(A), ...completeDecisionsFor(B)]);
    readAllArmStructuresMock.mockResolvedValue([]);
    listSchemaVersionsMock.mockResolvedValue([makeSchemaVersion()]);
    getSchemaFieldsMock.mockResolvedValue([makeField()]);
    await loadAdjudicateTargets(store, makeDeps());
    await openAdjudicateStudy(store, makeDeps(), 'study-1');
    const cell = store.getState().adjudicate.working?.cells[0];
    expect(cell?.valueA).toBeNull();
    expect(cell?.valueB).toBe('120');
  });

  test('確定済みスキーマが無ければ workingError に「確定済みの表のデザインがありません」', async () => {
    const store = seedStore();
    setupTwoAnnotatorsReady();
    await loadAdjudicateTargets(store, makeDeps());
    listSchemaVersionsMock.mockResolvedValue([]);
    await openAdjudicateStudy(store, makeDeps(), 'study-1');
    expect(store.getState().adjudicate.workingError).toBe('確定済みの表のデザインがありません');
  });

  test('workingLoading 中の再入は無視する', async () => {
    const store = seedStore();
    setupTwoAnnotatorsReady();
    await loadAdjudicateTargets(store, makeDeps());
    // loadAdjudicateTargets 自身が listSchemaVersions を 1 回呼ぶ。ここでの呼び出し回数を
    // 基準に、workingLoading 中の openAdjudicateStudy がそれ以上呼ばないことを確認する
    listSchemaVersionsMock.mockClear();
    store.setState({ adjudicate: { ...store.getState().adjudicate, workingLoading: true } });
    await openAdjudicateStudy(store, makeDeps(), 'study-1');
    expect(listSchemaVersionsMock).not.toHaveBeenCalled();
  });

  test('別 study を開くと前の study の PDF キャッシュを破棄する', async () => {
    const store = seedStore();
    setupTwoAnnotatorsReady();
    readDocumentsMock.mockResolvedValue([makeDocument({ documentId: 'doc-2', studyId: 'study-2' })]);
    readStudiesMock.mockResolvedValue([makeStudy({ studyId: 'study-2' })]);
    await loadAdjudicateTargets(store, makeDeps());
    // study-1 を開いた状態を手動で working にセット（disposePdf の呼び出し検証用）
    const dispose = jest.fn().mockResolvedValue(undefined);
    store.setState({
      adjudicate: {
        ...store.getState().adjudicate,
        working: { disposePdf: dispose } as unknown as AdjudicateWorking,
      },
    });
    await openAdjudicateStudy(store, makeDeps(), 'study-unknown');
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  test('読込エラーは workingError へ（workingLoading は false に戻る）', async () => {
    const store = seedStore();
    setupTwoAnnotatorsReady();
    await loadAdjudicateTargets(store, makeDeps());
    readStudyDataSheetMock.mockRejectedValue(new Error('sheets error'));
    await openAdjudicateStudy(store, makeDeps(), 'study-1');
    expect(store.getState().adjudicate.workingError).toBe('sheets error');
    expect(store.getState().adjudicate.workingLoading).toBe(false);
  });

  test('ゲート通過後に文書が解決できない（想定外の不整合）は workingError へ', async () => {
    const store = seedStore();
    setupTwoAnnotatorsReady();
    await loadAdjudicateTargets(store, makeDeps());
    // loadAdjudicateTargets 後、openAdjudicateStudy 内の再読込だけ空の documents/studies を返す
    readDocumentsMock.mockResolvedValueOnce([]);
    readStudiesMock.mockResolvedValueOnce([]);
    await openAdjudicateStudy(store, makeDeps(), 'study-1');
    expect(store.getState().adjudicate.workingError).toBe('study study-1 の文書が見つかりません');
  });

  test('loadPdfView / retryPdfView / disposePdf が pdfCache へ委譲される（documentId 不明は文書エラーを返す）', async () => {
    const store = seedStore();
    const cache = makeFakePdfCache();
    createPdfViewCacheMock.mockReturnValue(cache);
    setupTwoAnnotatorsReady();
    await loadAdjudicateTargets(store, makeDeps());
    await openAdjudicateStudy(store, makeDeps(), 'study-1');
    const working = store.getState().adjudicate.working as AdjudicateWorking;

    await working.loadPdfView('doc-1');
    expect(cache.load).toHaveBeenCalledWith('doc-1', 'drive-1');
    await working.retryPdfView('doc-1');
    expect(cache.retry).toHaveBeenCalledWith('doc-1', 'drive-1');
    await working.disposePdf();
    expect(cache.disposeAll).toHaveBeenCalledTimes(1);

    const missingLoad = await working.loadPdfView('doc-unknown');
    expect(missingLoad.pdf).toBeNull();
    expect(missingLoad.pdfError).toContain('doc-unknown');
    const missingRetry = await working.retryPdfView('doc-unknown');
    expect(missingRetry.pdf).toBeNull();
    expect(missingRetry.pdfError).toContain('doc-unknown');
  });
});

describe('backToAdjudicateList', () => {
  test('working を破棄して一覧表示へ戻す', async () => {
    const store = seedStore();
    const dispose = jest.fn().mockResolvedValue(undefined);
    store.setState({
      adjudicate: {
        ...store.getState().adjudicate,
        selectedStudyId: 'study-1',
        working: { disposePdf: dispose } as unknown as AdjudicateWorking,
        workingError: 'x',
      },
    });
    backToAdjudicateList(store);
    expect(store.getState().adjudicate.selectedStudyId).toBeNull();
    expect(store.getState().adjudicate.working).toBeNull();
    expect(store.getState().adjudicate.workingError).toBeNull();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  test('working が無くても安全に呼べる', () => {
    const store = seedStore();
    expect(() => backToAdjudicateList(store)).not.toThrow();
  });
});

async function openReadyStudy(
  store: Store,
  overrides: { armRows?: ArmStructureRow[]; fields?: SchemaField[]; resultsRows?: ResultsDataRow[] } = {},
): Promise<void> {
  setupTwoAnnotatorsReady();
  if (overrides.armRows) {
    readAllArmStructuresMock.mockResolvedValue(overrides.armRows);
  }
  if (overrides.fields) {
    getSchemaFieldsMock.mockResolvedValue(overrides.fields);
  }
  if (overrides.resultsRows) {
    readResultsDataRowsMock.mockResolvedValue(overrides.resultsRows);
  }
  await loadAdjudicateTargets(store, makeDeps());
  await openAdjudicateStudy(store, makeDeps(), 'study-1');
}

describe('群構成ドラフト編集（永続化なし）', () => {
  test('working が無ければ no-op', () => {
    const store = seedStore();
    expect(() => updateAdjudicateArmDraftRow(store, 0, 'x')).not.toThrow();
    expect(() => addAdjudicateArmDraftRow(store)).not.toThrow();
    expect(() => removeAdjudicateArmDraftRow(store, 0)).not.toThrow();
  });

  test('名称編集・追加・削除がドラフトへ反映される', async () => {
    const store = seedStore();
    // 群構成が必要になるよう arm レベル項目を混ぜる（両者ともまだ未確定 = armDraft は空から開始）
    await openReadyStudy(store, {
      fields: [makeField(), makeField({ fieldId: 'f-arm', fieldName: 'arm_name', entityLevel: 'arm' })],
    });
    expect(store.getState().adjudicate.working?.needsArmConfirmation).toBe(true);
    expect(store.getState().adjudicate.working?.armDraft).toEqual([]);

    addAdjudicateArmDraftRow(store);
    const afterAdd = store.getState().adjudicate.working?.armDraft ?? [];
    expect(afterAdd).toHaveLength(1);

    updateAdjudicateArmDraftRow(store, 0, '新名称');
    expect(store.getState().adjudicate.working?.armDraft[0]?.armName).toBe('新名称');

    addAdjudicateArmDraftRow(store);
    expect(store.getState().adjudicate.working?.armDraft).toHaveLength(2);

    // 2 件目（index 1）だけを編集し、1 件目（index 0）が変化しないことを確認する
    updateAdjudicateArmDraftRow(store, 1, '2 件目の名称');
    const afterSecondEdit = store.getState().adjudicate.working?.armDraft ?? [];
    expect(afterSecondEdit[0]?.armName).toBe('新名称');
    expect(afterSecondEdit[1]?.armName).toBe('2 件目の名称');

    removeAdjudicateArmDraftRow(store, 0);
    const afterRemove = store.getState().adjudicate.working?.armDraft ?? [];
    expect(afterRemove).toHaveLength(1);
    expect(afterRemove[0]?.armName).not.toBe('新名称');
  });

  test('行削除後の追加でも armKey が重複しない（最小の空き番号を採番。issue #63 の修正）', async () => {
    const store = seedStore();
    await openReadyStudy(store, {
      fields: [makeField(), makeField({ fieldId: 'f-arm', fieldName: 'arm_name', entityLevel: 'arm' })],
    });
    addAdjudicateArmDraftRow(store); // arm:1
    addAdjudicateArmDraftRow(store); // arm:2
    addAdjudicateArmDraftRow(store); // arm:3
    removeAdjudicateArmDraftRow(store, 0); // arm:2 / arm:3 が残る
    addAdjudicateArmDraftRow(store); // 空き番号 arm:1 を再利用
    const keys = store.getState().adjudicate.working?.armDraft.map((row) => row.armKey) ?? [];
    expect(keys).toEqual(['arm:2', 'arm:3', 'arm:1']);
    expect(new Set(keys).size).toBe(3);
  });
});

describe('setAdjudicatePairSelection（issue #63）', () => {
  test('組の選択と解除（null）が pairSelections へ反映される', () => {
    const store = seedStore();
    setAdjudicatePairSelection(store, 'study-1', { annotatorA: A, annotatorB: B });
    expect(store.getState().adjudicate.pairSelections).toEqual({
      'study-1': { annotatorA: A, annotatorB: B },
    });
    setAdjudicatePairSelection(store, 'study-2', { annotatorA: A, annotatorB: C });
    setAdjudicatePairSelection(store, 'study-1', null);
    expect(store.getState().adjudicate.pairSelections).toEqual({
      'study-2': { annotatorA: A, annotatorB: C },
    });
  });
});

describe('arm 並べ替えマッピング（issue #63）', () => {
  test('同名別順の群は既定マッピングが自動で並べ替え、セル突き合わせが正しく対応する', async () => {
    const store = seedStore();
    setupReversedArms();
    await loadAdjudicateTargets(store, makeDeps());
    await openAdjudicateStudy(store, makeDeps(), 'study-1');
    const working = store.getState().adjudicate.working;
    expect(working?.armMapping).toEqual(['arm:2', 'arm:1']);
    expect(working?.armsMatched).toBe(true);
    expect(working?.armDraft).toEqual([
      { armKey: 'arm:1', armName: 'プラセボ群' },
      { armKey: 'arm:2', armName: '介入群' },
    ]);
    // B の arm:1（介入群）は正準 arm:2 へ、arm:2（プラセボ群）は arm:1 へ写り、両セルとも一致する
    const armCells = (working?.cells ?? []).filter((cell) => cell.field.fieldId === 'f-arm');
    expect(armCells).toHaveLength(2);
    expect(armCells.every((cell) => cell.matches)).toBe(true);
  });

  test('setAdjudicateArmMapping: 対応の変更が 1:1 を保ちつつセル・一致判定・ドラフトへ反映される', async () => {
    const store = seedStore();
    setupReversedArms();
    await loadAdjudicateTargets(store, makeDeps());
    await openAdjudicateStudy(store, makeDeps(), 'study-1');
    // A[0]（プラセボ群）へ B の arm:1（介入群）を割り当てる → A[1] が持っていた arm:1 は自動解除
    setAdjudicateArmMapping(store, 0, 'arm:1');
    const working = store.getState().adjudicate.working;
    expect(working?.armMapping).toEqual(['arm:1', null]);
    expect(working?.armsMatched).toBe(false);
    // ドラフトは A の 2 群 + B のみ群（arm:2 プラセボ群 → 新キー arm:3）
    expect(working?.armDraft).toEqual([
      { armKey: 'arm:1', armName: 'プラセボ群' },
      { armKey: 'arm:2', armName: '介入群' },
      { armKey: 'arm:3', armName: 'プラセボ群' },
    ]);
    // セルは study 1 + arm 3 本ぶん（arm:1 / arm:2 / arm:3）に増える
    const armCells = (working?.cells ?? []).filter((cell) => cell.field.fieldId === 'f-arm');
    expect(armCells.map((cell) => cell.entityKey)).toEqual(['arm:1', 'arm:2', 'arm:3']);
  });

  test('setAdjudicateArmMapping: 対応なし（null）へ戻せる', async () => {
    const store = seedStore();
    setupReversedArms();
    await loadAdjudicateTargets(store, makeDeps());
    await openAdjudicateStudy(store, makeDeps(), 'study-1');
    setAdjudicateArmMapping(store, 0, null);
    expect(store.getState().adjudicate.working?.armMapping).toEqual([null, 'arm:1']);
    expect(store.getState().adjudicate.working?.armsMatched).toBe(false);
  });

  test('setAdjudicateArmMapping: working なし・範囲外 index・未知の armKey は no-op', async () => {
    const store = seedStore();
    expect(() => setAdjudicateArmMapping(store, 0, 'arm:1')).not.toThrow();

    setupReversedArms();
    await loadAdjudicateTargets(store, makeDeps());
    await openAdjudicateStudy(store, makeDeps(), 'study-1');
    const before = store.getState().adjudicate.working?.armMapping;
    setAdjudicateArmMapping(store, -1, 'arm:1');
    setAdjudicateArmMapping(store, 2, 'arm:1');
    setAdjudicateArmMapping(store, 0, 'arm:9');
    expect(store.getState().adjudicate.working?.armMapping).toEqual(before);
  });

  test('setAdjudicateArmMapping: consensus 群構成の確定後は変更不可（no-op）', async () => {
    const store = seedStore();
    setupReversedArms();
    readAllArmStructuresMock.mockResolvedValue([
      makeArmRow({ annotator: A, armKey: 'arm:1', armName: 'プラセボ群' }),
      makeArmRow({ annotator: A, armKey: 'arm:2', armName: '介入群' }),
      makeArmRow({ annotator: B, armKey: 'arm:1', armName: '介入群' }),
      makeArmRow({ annotator: B, armKey: 'arm:2', armName: 'プラセボ群' }),
      makeArmRow({ annotator: 'consensus', annotatorType: 'consensus', armKey: 'arm:1', armName: 'プラセボ群' }),
    ]);
    await loadAdjudicateTargets(store, makeDeps());
    await openAdjudicateStudy(store, makeDeps(), 'study-1');
    const before = store.getState().adjudicate.working?.armMapping;
    setAdjudicateArmMapping(store, 0, 'arm:1');
    expect(store.getState().adjudicate.working?.armMapping).toEqual(before);
  });

  test('確定済み consensus 版の note に辞書があれば復元してセル突き合わせへ適用する', async () => {
    const store = seedStore();
    setupReversedArms();
    readAllArmStructuresMock.mockResolvedValue([
      makeArmRow({ annotator: A, armKey: 'arm:1', armName: 'プラセボ群' }),
      makeArmRow({ annotator: A, armKey: 'arm:2', armName: '介入群' }),
      makeArmRow({ annotator: B, armKey: 'arm:1', armName: '介入群' }),
      makeArmRow({ annotator: B, armKey: 'arm:2', armName: 'プラセボ群' }),
      makeArmRow({
        annotator: 'consensus',
        annotatorType: 'consensus',
        armKey: 'arm:1',
        armName: 'プラセボ群',
        note: '裁定者: judge@example.com / arm_mapping:{"arm:1":"arm:2","arm:2":"arm:1"}',
      }),
    ]);
    await loadAdjudicateTargets(store, makeDeps());
    await openAdjudicateStudy(store, makeDeps(), 'study-1');
    const working = store.getState().adjudicate.working;
    expect(working?.armMapping).toEqual(['arm:2', 'arm:1']);
    const armCells = (working?.cells ?? []).filter((cell) => cell.field.fieldId === 'f-arm');
    expect(armCells.every((cell) => cell.matches)).toBe(true);
  });

  test('confirmAdjudicateArms は note へ辞書を直列化して残す', async () => {
    const store = seedStore();
    setupReversedArms();
    await loadAdjudicateTargets(store, makeDeps());
    await openAdjudicateStudy(store, makeDeps(), 'study-1');
    appendArmVersionMock.mockResolvedValue({
      version: 1,
      arms: [
        { armKey: 'arm:1', armName: 'プラセボ群' },
        { armKey: 'arm:2', armName: '介入群' },
      ],
    });
    await confirmAdjudicateArms(store, makeDeps(), store.getState().adjudicate.working?.armDraft ?? []);
    const input = appendArmVersionMock.mock.calls[0]?.[1] as { note: string | null };
    expect(input.note).toBe(`裁定者: ${JUDGE} / arm_mapping:{"arm:2":"arm:1","arm:1":"arm:2"}`);
  });
});

describe('B の素通しキー衝突検知（issue #117 件2）', () => {
  test('辞書に無い B の素通しキーが写像先と衝突すると退避キーへ差し替え、データを潰さない', async () => {
    const store = seedStore();
    setupCollisionArms();
    await loadAdjudicateTargets(store, makeDeps());
    await openAdjudicateStudy(store, makeDeps(), 'study-1');
    const working = store.getState().adjudicate.working;
    const armCells = (working?.cells ?? []).filter((cell) => cell.field.fieldId === 'f-arm');
    // B の arm:6（正規の対応先 arm:1）由来の値が、素通しキー 'arm:1' に無言で上書きされていない
    const arm1Cell = armCells.find((cell) => cell.entityKey === 'arm:1');
    expect(arm1Cell?.valueA).toBe('X値');
    expect(arm1Cell?.valueB).toBe('B6値');
    // 素通しキーは退避先の新規キーへ移り、値も保持される（A 側には対応が無いので valueA は null）
    const escapedCell = armCells.find((cell) => cell.entityKey === 'arm:3');
    expect(escapedCell?.valueA).toBeNull();
    expect(escapedCell?.valueB).toBe('stray値');
    // 衝突を検知した旨をトーストで知らせる
    expect(toastTexts()).toContain(
      'B 側に群構成外の項目キー（arm:1）が見つかったため、別キーへ退避して突き合わせました。データの見落としがないか確認してください',
    );
  });

  test('衝突が無ければ従来どおり突き合わせされ、警告トーストは出さない', async () => {
    const store = seedStore();
    setupReversedArms();
    await loadAdjudicateTargets(store, makeDeps());
    await openAdjudicateStudy(store, makeDeps(), 'study-1');
    expect(
      toastTexts().some((text) => text.includes('群構成外の項目キー')),
    ).toBe(false);
  });

  test('setAdjudicateArmMapping でマッピングを変更したときも衝突検知が再適用される', async () => {
    const store = seedStore();
    setupCollisionArms();
    await loadAdjudicateTargets(store, makeDeps());
    await openAdjudicateStudy(store, makeDeps(), 'study-1');
    document.body.innerHTML = ''; // 初期表示ぶんのトーストをクリアしてから再検証する
    // A[0] へ対応する B 群を明示的に選び直しても、辞書の写像先集合は変わらず衝突は再検知される
    setAdjudicateArmMapping(store, 0, 'arm:6');
    expect(toastTexts()).toContain(
      'B 側に群構成外の項目キー（arm:1）が見つかったため、別キーへ退避して突き合わせました。データの見落としがないか確認してください',
    );
  });
});

describe('confirmAdjudicateArms', () => {
  test('working が無ければ no-op', async () => {
    const store = seedStore();
    await confirmAdjudicateArms(store, makeDeps(), [{ armKey: 'arm:1', armName: 'x' }]);
    expect(appendArmVersionMock).not.toHaveBeenCalled();
  });

  test('空・名称未入力は保存せずトースト', async () => {
    const store = seedStore();
    await openReadyStudy(store);
    await confirmAdjudicateArms(store, makeDeps(), []);
    await confirmAdjudicateArms(store, makeDeps(), [{ armKey: 'arm:1', armName: '  ' }]);
    expect(appendArmVersionMock).not.toHaveBeenCalled();
  });

  test('成功: annotator=consensus で追記し working.consensusArmStructure / armDraft を更新する', async () => {
    const store = seedStore();
    await openReadyStudy(store);
    appendArmVersionMock.mockResolvedValue({ version: 1, arms: [{ armKey: 'arm:1', armName: '介入群' }] });
    await confirmAdjudicateArms(store, makeDeps(), [{ armKey: 'arm:1', armName: '介入群' }]);
    expect(appendArmVersionMock).toHaveBeenCalledWith(
      'sheet-1',
      expect.objectContaining({ studyId: 'study-1', annotator: 'consensus', annotatorType: 'consensus' }),
      expect.anything(),
    );
    expect(store.getState().adjudicate.working?.consensusArmStructure).toEqual({
      version: 1,
      arms: [{ armKey: 'arm:1', armName: '介入群' }],
    });
  });

  test('email が取得できない・now 未注入でもフォールバックで動作する', async () => {
    const store = seedStore();
    await openReadyStudy(store);
    getCurrentUserEmailMock.mockResolvedValueOnce(null);
    appendArmVersionMock.mockResolvedValue({ version: 1, arms: [{ armKey: 'arm:1', armName: '介入群' }] });
    await confirmAdjudicateArms(store, makeDeps({ now: undefined }), [{ armKey: 'arm:1', armName: '介入群' }]);
    const call = appendArmVersionMock.mock.calls[0]?.[1] as { note: string | null; confirmedAt: string };
    // arm 無しの study では辞書は空（issue #63: note には常に辞書を直列化して残す）
    expect(call.note).toBe('裁定者:  / arm_mapping:{}');
    expect(typeof call.confirmedAt).toBe('string');
    expect(call.confirmedAt.length).toBeGreaterThan(0);
  });

  test('別 study へ切り替わっていた場合は working を上書きしない', async () => {
    const store = seedStore();
    await openReadyStudy(store);
    const working = store.getState().adjudicate.working;
    appendArmVersionMock.mockImplementation(async () => {
      // 保存中に別 study へ切替わった状態を模す
      store.setState({
        adjudicate: {
          ...store.getState().adjudicate,
          working: { ...(working as AdjudicateWorking), study: { ...(working as AdjudicateWorking).study, studyId: 'study-2' } },
        },
      });
      return { version: 1, arms: [{ armKey: 'arm:1', armName: '介入群' }] };
    });
    await confirmAdjudicateArms(store, makeDeps(), [{ armKey: 'arm:1', armName: '介入群' }]);
    expect(store.getState().adjudicate.working?.study.studyId).toBe('study-2');
  });

  test('失敗はトーストのみ（working は変化しない）', async () => {
    const store = seedStore();
    await openReadyStudy(store);
    appendArmVersionMock.mockRejectedValue(new Error('write failed'));
    const before = store.getState().adjudicate.working;
    await confirmAdjudicateArms(store, makeDeps(), [{ armKey: 'arm:1', armName: '介入群' }]);
    expect(store.getState().adjudicate.working).toBe(before);
  });
});

describe('skip / unskip', () => {
  test('working が無ければ no-op', () => {
    const store = seedStore();
    expect(() => skipAdjudicateCell(store, 'key')).not.toThrow();
    expect(() => unskipAdjudicateCell(store, 'key')).not.toThrow();
  });

  test('スキップ → 取り消しが往復できる（二重スキップは no-op）', async () => {
    const store = seedStore();
    await openReadyStudy(store);
    const cellKey = (store.getState().adjudicate.working?.cells[0] as { cellKey: string }).cellKey;
    skipAdjudicateCell(store, cellKey);
    expect(store.getState().adjudicate.working?.skippedCellKeys).toEqual([cellKey]);
    skipAdjudicateCell(store, cellKey); // 二重スキップは no-op
    expect(store.getState().adjudicate.working?.skippedCellKeys).toEqual([cellKey]);
    unskipAdjudicateCell(store, cellKey);
    expect(store.getState().adjudicate.working?.skippedCellKeys).toEqual([]);
    unskipAdjudicateCell(store, cellKey); // 二重取り消しも no-op
    expect(store.getState().adjudicate.working?.skippedCellKeys).toEqual([]);
  });
});

describe('setAdjudicateMismatchOnlyFilter', () => {
  test('フィルタの ON/OFF を切り替える', () => {
    const store = seedStore();
    expect(store.getState().adjudicate.mismatchOnlyFilter).toBe(true);
    setAdjudicateMismatchOnlyFilter(store, false);
    expect(store.getState().adjudicate.mismatchOnlyFilter).toBe(false);
  });
});

describe('adjudicateCellStates', () => {
  test('consensus 自身の判定履歴を畳み込む', async () => {
    const store = seedStore();
    await openReadyStudy(store);
    const working = store.getState().adjudicate.working as AdjudicateWorking;
    expect(adjudicateCellStates(working).size).toBe(0);
  });
});

describe('acceptAllMatchingCells', () => {
  test('working が無ければ no-op', async () => {
    const store = seedStore();
    await acceptAllMatchingCells(store, makeDeps());
    expect(applyConsensusWritesMock).not.toHaveBeenCalled();
  });

  test('一致セルが無ければトーストのみで書き込まない', async () => {
    const store = seedStore();
    await openReadyStudy(store); // 両側とも '120' で一致するセルが 1 つある
    // 一致値を不一致にしておく
    getSchemaFieldsMock.mockResolvedValue([makeField()]);
    readStudyDataSheetMock.mockResolvedValue({
      fieldNames: ['sample_size'],
      rows: [
        makeStudyDataRow({ annotator: A, values: { sample_size: '120' } }),
        makeStudyDataRow({ annotator: B, values: { sample_size: '999' } }),
      ],
    });
    await openAdjudicateStudy(store, makeDeps(), 'study-1');
    await acceptAllMatchingCells(store, makeDeps());
    expect(applyConsensusWritesMock).not.toHaveBeenCalled();
  });

  test('一致セルを一括採用すると applyConsensusWrites が呼ばれ、consensusDecisions が更新される', async () => {
    const store = seedStore();
    await openReadyStudy(store);
    await acceptAllMatchingCells(store, makeDeps());
    expect(applyConsensusWritesMock).toHaveBeenCalledTimes(1);
    const [, writes, params] = applyConsensusWritesMock.mock.calls[0] as unknown as Parameters<typeof applyConsensusWrites>;
    expect(writes).toEqual([{ field: makeField(), entityKey: '-', action: 'accept', value: '120' }]);
    expect(params.decidedBy).toBe(JUDGE);
    expect(store.getState().adjudicate.working?.consensusDecisions).toHaveLength(1);
  });

  test('email が取得できない・now 未注入でもフォールバックで動作する', async () => {
    const store = seedStore();
    await openReadyStudy(store);
    getCurrentUserEmailMock.mockResolvedValueOnce(null);
    await acceptAllMatchingCells(store, makeDeps({ now: undefined }));
    const [, , params] = applyConsensusWritesMock.mock.calls[0] as unknown as Parameters<typeof applyConsensusWrites>;
    expect(params.decidedBy).toBe('');
    expect(typeof params.decidedAt).toBe('string');
    expect(params.decidedAt.length).toBeGreaterThan(0);
  });

  test('既に consensus 判定済みのセルは再度対象にしない（冪等）', async () => {
    const store = seedStore();
    await openReadyStudy(store);
    await acceptAllMatchingCells(store, makeDeps());
    applyConsensusWritesMock.mockClear();
    await acceptAllMatchingCells(store, makeDeps());
    expect(applyConsensusWritesMock).not.toHaveBeenCalled();
  });

  test('保存中の重複呼び出しは無視する（saving ガード）', async () => {
    const store = seedStore();
    await openReadyStudy(store);
    let resolveWrite: () => void = () => undefined;
    applyConsensusWritesMock.mockReturnValue(
      new Promise((resolve) => {
        resolveWrite = () => resolve(undefined);
      }),
    );
    const first = acceptAllMatchingCells(store, makeDeps());
    await acceptAllMatchingCells(store, makeDeps());
    expect(applyConsensusWritesMock).toHaveBeenCalledTimes(1);
    resolveWrite();
    await first;
  });

  test('書き込み失敗はオフラインキューへ退避し、consensusDecisions は楽観反映する（issue #63）', async () => {
    const store = seedStore();
    await openReadyStudy(store);
    applyConsensusWritesMock.mockRejectedValue(new Error('write failed'));
    const queue = makeQueue();
    await acceptAllMatchingCells(store, makeDeps({ decisionQueue: queue }));
    expect(store.getState().adjudicate.saving).toBe(false);
    // 検証パネルと同じ「キュー退避でも人間の判断は確定済み」の原則で楽観反映する
    expect(store.getState().adjudicate.working?.consensusDecisions).toHaveLength(1);
    expect(store.getState().adjudicate.working?.consensusDecisions[0]).toMatchObject({
      annotator: 'consensus',
      action: 'accept',
    });
    expect(store.getState().adjudicate.queuedWrites).toBe(1);
    expect(queue.enqueue).toHaveBeenCalledTimes(1);
    const [spreadsheetId, userEmail, item] = queue.enqueue.mock.calls[0] as unknown as [string, string, { consensusWrites: unknown[]; consensusParams: { studyId: string } }];
    expect(spreadsheetId).toBe('sheet-1');
    expect(userEmail).toBe(JUDGE); // decidedBy = 裁定者
    expect(item.consensusParams.studyId).toBe('study-1');
    expect(item.consensusWrites).toHaveLength(1);
  });

  test('キュー退避後に別の裁定操作が成功すると、キューに残っていた分もあわせて再送する', async () => {
    const store = seedStore();
    await openReadyStudy(store);
    const queue = makeQueue();
    queue.flush.mockResolvedValue({ flushedCount: 1, remainingCount: 0 });
    await acceptAllMatchingCells(store, makeDeps({ decisionQueue: queue }));
    expect(queue.flush).toHaveBeenCalledTimes(1);
    expect(store.getState().adjudicate.queuedWrites).toBe(0);
  });

  test('decisionQueue 未注入なら検証側と共有するモジュール共有キューで動く（空キューの flush は no-op）', async () => {
    const store = seedStore();
    await openReadyStudy(store);
    await expect(
      acceptAllMatchingCells(store, makeDeps({ decisionQueue: undefined })),
    ).resolves.toBeUndefined();
    expect(store.getState().adjudicate.saving).toBe(false);
    expect(store.getState().adjudicate.working?.consensusDecisions).toHaveLength(1);
  });

  test('想定外の例外（getCurrentUserEmail が失敗）はトーストのみで consensusDecisions は変化しない', async () => {
    const store = seedStore();
    await openReadyStudy(store);
    getCurrentUserEmailMock.mockRejectedValueOnce(new Error('profile error'));
    await acceptAllMatchingCells(store, makeDeps());
    expect(store.getState().adjudicate.saving).toBe(false);
    expect(store.getState().adjudicate.working?.consensusDecisions).toHaveLength(0);
    expect(applyConsensusWritesMock).not.toHaveBeenCalled();
  });

  test('保存完了までに別 study へ切り替わっていたら working を上書きしない', async () => {
    const store = seedStore();
    await openReadyStudy(store);
    const working = store.getState().adjudicate.working as AdjudicateWorking;
    applyConsensusWritesMock.mockImplementation(async () => {
      store.setState({
        adjudicate: { ...store.getState().adjudicate, working: { ...working, study: { ...working.study, studyId: 'study-2' } } },
      });
    });
    await acceptAllMatchingCells(store, makeDeps());
    expect(store.getState().adjudicate.working?.study.studyId).toBe('study-2');
    expect(store.getState().adjudicate.saving).toBe(false);
  });

  test('群構成未確定の一致 arm セルは一括採用の対象から除外する（個別裁定と同じロック）', async () => {
    const store = seedStore();
    await openReadyStudy(store, {
      fields: [makeField(), makeField({ fieldId: 'f-arm', fieldName: 'arm_name', entityLevel: 'arm' })],
      resultsRows: [
        makeResultsRow({ annotator: A, fieldId: 'f-arm', entityKey: 'arm:1', value: '介入群' }),
        makeResultsRow({ annotator: B, fieldId: 'f-arm', entityKey: 'arm:1', value: '介入群' }),
      ],
    });
    expect(store.getState().adjudicate.working?.consensusArmStructure).toBeNull();
    await acceptAllMatchingCells(store, makeDeps());
    // 一致するのは study レベルの f-1 セルのみ（arm レベルはロック中のため対象外）
    const writes = applyConsensusWritesMock.mock.calls[0]?.[1] as readonly { field: { fieldId: string } }[];
    expect(writes.map((write) => write.field.fieldId)).toEqual(['f-1']);
  });
});

describe('セル単位の個別裁定', () => {
  test('working / cell が無ければ no-op', async () => {
    const store = seedStore();
    await adjudicateCellChoice(store, makeDeps(), 'nope', 'A');
    await adjudicateCellCustomValue(store, makeDeps(), 'nope', 'x');
    await adjudicateCellNotReported(store, makeDeps(), 'nope');
    await undoAdjudicateCell(store, makeDeps(), 'nope');
    expect(applyConsensusWritesMock).not.toHaveBeenCalled();
  });

  test('A を採用すると action=edit で valueA が書き込まれる', async () => {
    const store = seedStore();
    await openReadyStudy(store);
    const cellKey = (store.getState().adjudicate.working?.cells[0] as { cellKey: string }).cellKey;
    await adjudicateCellChoice(store, makeDeps(), cellKey, 'A');
    expect(applyConsensusWritesMock).toHaveBeenCalledTimes(1);
    const [, writes] = applyConsensusWritesMock.mock.calls[0] as unknown as Parameters<typeof applyConsensusWrites>;
    expect(writes).toEqual([{ field: makeField(), entityKey: '-', action: 'edit', value: '120' }]);
  });

  test('B を採用すると valueB が書き込まれる', async () => {
    const store = seedStore();
    await openReadyStudy(store);
    const cellKey = (store.getState().adjudicate.working?.cells[0] as { cellKey: string }).cellKey;
    await adjudicateCellChoice(store, makeDeps(), cellKey, 'B');
    const [, writes] = applyConsensusWritesMock.mock.calls[0] as unknown as Parameters<typeof applyConsensusWrites>;
    expect(writes[0]?.value).toBe('120');
  });

  test('第 3 の値を入力して確定できる', async () => {
    const store = seedStore();
    await openReadyStudy(store);
    const cellKey = (store.getState().adjudicate.working?.cells[0] as { cellKey: string }).cellKey;
    await adjudicateCellCustomValue(store, makeDeps(), cellKey, ' 第三 ');
    const [, writes] = applyConsensusWritesMock.mock.calls[0] as unknown as Parameters<typeof applyConsensusWrites>;
    expect(writes[0]?.value).toBe('第三');
  });

  test('not_reported 裁定ができる', async () => {
    const store = seedStore();
    await openReadyStudy(store);
    const cellKey = (store.getState().adjudicate.working?.cells[0] as { cellKey: string }).cellKey;
    await adjudicateCellNotReported(store, makeDeps(), cellKey);
    const [, writes] = applyConsensusWritesMock.mock.calls[0] as unknown as Parameters<typeof applyConsensusWrites>;
    expect(writes[0]).toEqual({ field: makeField(), entityKey: '-', action: 'not_reported', value: NOT_REPORTED_TOKEN });
  });

  test('群構成未確定の arm / outcome_result セルは裁定できずトーストのみ', async () => {
    const store = seedStore();
    // ゲート（study レベル項目 1 件）を満たしつつ、arm レベル項目も持たせる
    await openReadyStudy(store, {
      fields: [makeField(), makeField({ fieldId: 'f-arm', fieldName: 'arm_name', entityLevel: 'arm' })],
      resultsRows: [
        makeResultsRow({ annotator: A, entityKey: 'arm:1', value: '介入群' }),
        makeResultsRow({ annotator: B, entityKey: 'arm:1', value: '介入群' }),
      ],
    });
    expect(store.getState().adjudicate.working?.needsArmConfirmation).toBe(true);
    expect(store.getState().adjudicate.working?.consensusArmStructure).toBeNull();
    const armCell = store.getState().adjudicate.working?.cells.find((cell) => cell.field.entityLevel === 'arm');
    const cellKey = (armCell as { cellKey: string }).cellKey;
    await adjudicateCellChoice(store, makeDeps(), cellKey, 'A');
    await adjudicateCellCustomValue(store, makeDeps(), cellKey, '手入力');
    await adjudicateCellNotReported(store, makeDeps(), cellKey);
    expect(applyConsensusWritesMock).not.toHaveBeenCalled();
  });

  test('undo: consensus 未判定セルは書き込まない', async () => {
    const store = seedStore();
    await openReadyStudy(store);
    const cellKey = (store.getState().adjudicate.working?.cells[0] as { cellKey: string }).cellKey;
    await undoAdjudicateCell(store, makeDeps(), cellKey);
    expect(applyConsensusWritesMock).not.toHaveBeenCalled();
  });

  test('undo: 判定済みセルを 1 件取り消す', async () => {
    const store = seedStore();
    await openReadyStudy(store);
    const cellKey = (store.getState().adjudicate.working?.cells[0] as { cellKey: string }).cellKey;
    await adjudicateCellNotReported(store, makeDeps(), cellKey);
    expect(store.getState().adjudicate.working?.consensusDecisions).toHaveLength(1);
    await undoAdjudicateCell(store, makeDeps(), cellKey);
    expect(store.getState().adjudicate.working?.consensusDecisions).toHaveLength(2);
    const last = store.getState().adjudicate.working?.consensusDecisions.slice(-1)[0];
    expect(last?.action).toBe('undo');
    expect(last?.value).toBeNull();
  });
});

describe('loadAgreementReport（issue #66）', () => {
  test('プロジェクト未選択は no-op', async () => {
    const store = createStore();
    await loadAgreementReport(store, makeDeps());
    expect(readDocumentsMock).not.toHaveBeenCalled();
    expect(store.getState().adjudicate.agreement).toBeNull();
  });

  test('ready ペアの study があれば項目単位のレポートを組み立てる', async () => {
    const store = seedStore();
    setupTwoAnnotatorsReady();
    await loadAgreementReport(store, makeDeps());
    const { agreement, agreementLoading, agreementError } = store.getState().adjudicate;
    expect(agreementLoading).toBe(false);
    expect(agreementError).toBeNull();
    expect(agreement?.studyCount).toBe(1);
    expect(agreement?.fields).toHaveLength(1);
    // setupTwoAnnotatorsReady は A・B とも sample_size='120' なので完全一致・単一カテゴリ（κ=null）
    expect(agreement?.fields[0]).toEqual(
      expect.objectContaining({ fieldId: 'f-1', pairCount: 1, agreementCount: 1, agreementRate: 1, kappa: null }),
    );
  });

  test('確定済みスキーマが無い（versions 空）は studyCount=0 の空レポート（エラーにしない）', async () => {
    const store = seedStore();
    readDocumentsMock.mockResolvedValue([makeDocument()]);
    readStudiesMock.mockResolvedValue([makeStudy()]);
    readStudyDataSheetMock.mockResolvedValue({ fieldNames: [], rows: [] });
    readResultsDataRowsMock.mockResolvedValue([]);
    readAllDecisionsMock.mockResolvedValue([]);
    listSchemaVersionsMock.mockResolvedValue([]);
    await loadAgreementReport(store, makeDeps());
    expect(getSchemaFieldsMock).not.toHaveBeenCalled();
    expect(store.getState().adjudicate.agreementError).toBeNull();
    expect(store.getState().adjudicate.agreement).toEqual({
      studyCount: 0,
      fields: [],
      overall: { pairCount: 0, agreementCount: 0, agreementRate: null, kappa: null },
      disagreements: [],
    });
  });

  test('ready ペアが 0 件（1 名以下）は studyCount=0 の空レポート（エラーにしない）', async () => {
    const store = seedStore();
    readDocumentsMock.mockResolvedValue([makeDocument()]);
    readStudiesMock.mockResolvedValue([makeStudy()]);
    readStudyDataSheetMock.mockResolvedValue({ fieldNames: [], rows: [makeStudyDataRow({ annotator: A })] });
    readResultsDataRowsMock.mockResolvedValue([]);
    readAllDecisionsMock.mockResolvedValue([]);
    listSchemaVersionsMock.mockResolvedValue([makeSchemaVersion()]);
    getSchemaFieldsMock.mockResolvedValue([makeField()]);
    await loadAgreementReport(store, makeDeps());
    expect(store.getState().adjudicate.agreementError).toBeNull();
    expect(store.getState().adjudicate.agreement?.studyCount).toBe(0);
  });

  test('documents / studies が documents スライスに読込済みならそれを使う（再読込しない）', async () => {
    const store = seedStore();
    store.setState({
      documents: { ...store.getState().documents, records: [makeDocument()], studies: [makeStudy()] },
    });
    readStudyDataSheetMock.mockResolvedValue({ fieldNames: [], rows: [] });
    readResultsDataRowsMock.mockResolvedValue([]);
    readAllDecisionsMock.mockResolvedValue([]);
    listSchemaVersionsMock.mockResolvedValue([]);
    await loadAgreementReport(store, makeDeps());
    expect(readDocumentsMock).not.toHaveBeenCalled();
    expect(readStudiesMock).not.toHaveBeenCalled();
  });

  test('ready ペアが ResultsData 経由でのみ解決される study は StudyData 行が無くても arm レベルのセルを組み立てる', async () => {
    const store = seedStore();
    const armField = makeField({ fieldId: 'f-arm', fieldName: 'arm_name', entityLevel: 'arm' });
    readDocumentsMock.mockResolvedValue([makeDocument()]);
    readStudiesMock.mockResolvedValue([makeStudy()]);
    // StudyData 行は無し（studyDataRowA / studyDataRowB は ?? null のフォールバックへ）
    readStudyDataSheetMock.mockResolvedValue({ fieldNames: [], rows: [] });
    readResultsDataRowsMock.mockResolvedValue([
      makeResultsRow({ fieldId: 'f-arm', annotator: A, entityKey: 'arm:1', value: '介入群' }),
      makeResultsRow({ fieldId: 'f-arm', annotator: B, entityKey: 'arm:1', value: '対照群' }),
    ]);
    readAllDecisionsMock.mockResolvedValue([]);
    listSchemaVersionsMock.mockResolvedValue([makeSchemaVersion()]);
    getSchemaFieldsMock.mockResolvedValue([armField]);
    await loadAgreementReport(store, makeDeps());
    const agreement = store.getState().adjudicate.agreement;
    expect(agreement?.studyCount).toBe(1);
    expect(agreement?.fields[0]).toEqual(
      expect.objectContaining({ fieldId: 'f-arm', pairCount: 1, agreementCount: 0, agreementRate: 0 }),
    );
  });

  test('issue #117 件3: consensus 群構成に永続化された arm マッピングを一致度統計にも適用し、裁定画面と統計を揃える', async () => {
    const store = seedStore();
    const armField = makeField({ fieldId: 'f-arm', fieldName: 'arm_name', entityLevel: 'arm' });
    readDocumentsMock.mockResolvedValue([makeDocument()]);
    readStudiesMock.mockResolvedValue([makeStudy()]);
    readStudyDataSheetMock.mockResolvedValue({ fieldNames: [], rows: [] });
    readResultsDataRowsMock.mockResolvedValue([
      makeResultsRow({ resultId: 'r-a', fieldId: 'f-arm', annotator: A, entityKey: 'arm:1', value: '介入群' }),
      // B は自身の確定 ArmStructures では arm:2 として同じ群を宣言している想定
      makeResultsRow({ resultId: 'r-b', fieldId: 'f-arm', annotator: B, entityKey: 'arm:2', value: '介入群' }),
    ]);
    readAllDecisionsMock.mockResolvedValue([]);
    // 裁定画面で群構成を確定した際に永続化された辞書（B の arm:2 → 正準 arm:1）
    readAllArmStructuresMock.mockResolvedValue([
      makeArmRow({
        annotator: 'consensus',
        annotatorType: 'consensus',
        armKey: 'arm:1',
        armName: '介入群',
        note: `裁定者: ${JUDGE} / arm_mapping:{"arm:2":"arm:1"}`,
      }),
    ]);
    listSchemaVersionsMock.mockResolvedValue([makeSchemaVersion()]);
    getSchemaFieldsMock.mockResolvedValue([armField]);
    await loadAgreementReport(store, makeDeps());
    const agreement = store.getState().adjudicate.agreement;
    // マッピング適用で B の 'arm:2' が A と同じ 'arm:1' へ書き換わり、1 セルとして一致判定される
    // （マッピング未適用だと片側ずつ null の 2 セルに分かれ pairCount=0 になっていた = 旧挙動）
    expect(agreement?.fields[0]).toEqual(
      expect.objectContaining({ fieldId: 'f-arm', pairCount: 1, agreementCount: 1, agreementRate: 1 }),
    );
    expect(agreement?.disagreements).toEqual([]);
  });

  test('issue #117 件3: consensus 群構成が未確定（マッピング未保存）の study は従来どおり B の生キーで比較する', async () => {
    const store = seedStore();
    const armField = makeField({ fieldId: 'f-arm', fieldName: 'arm_name', entityLevel: 'arm' });
    readDocumentsMock.mockResolvedValue([makeDocument()]);
    readStudiesMock.mockResolvedValue([makeStudy()]);
    readStudyDataSheetMock.mockResolvedValue({ fieldNames: [], rows: [] });
    readResultsDataRowsMock.mockResolvedValue([
      makeResultsRow({ resultId: 'r-a', fieldId: 'f-arm', annotator: A, entityKey: 'arm:1', value: '介入群' }),
      makeResultsRow({ resultId: 'r-b', fieldId: 'f-arm', annotator: B, entityKey: 'arm:2', value: '介入群' }),
    ]);
    readAllDecisionsMock.mockResolvedValue([]);
    readAllArmStructuresMock.mockResolvedValue([]); // consensus 群構成が無い（マッピング未保存）
    listSchemaVersionsMock.mockResolvedValue([makeSchemaVersion()]);
    getSchemaFieldsMock.mockResolvedValue([armField]);
    await loadAgreementReport(store, makeDeps());
    const agreement = store.getState().adjudicate.agreement;
    // 生キーのまま突き合わせるため片側ずつ null の 2 セルに分かれ、両方とも対象外（pairCount=0）
    expect(agreement?.fields[0]).toEqual(
      expect.objectContaining({ fieldId: 'f-arm', pairCount: 0, agreementCount: 0, agreementRate: null }),
    );
    expect(agreement?.disagreements).toHaveLength(2);
  });

  test('読込失敗は agreementError へ（agreement は変更しない）', async () => {
    const store = seedStore();
    readDocumentsMock.mockRejectedValue(new Error('boom'));
    await loadAgreementReport(store, makeDeps());
    expect(store.getState().adjudicate.agreementError).toBe('boom');
    expect(store.getState().adjudicate.agreementLoading).toBe(false);
    expect(store.getState().adjudicate.agreement).toBeNull();
  });

  test('Error インスタンスでない失敗も文字列化して agreementError へ', async () => {
    const store = seedStore();
    readDocumentsMock.mockRejectedValue('boom-string');
    await loadAgreementReport(store, makeDeps());
    expect(store.getState().adjudicate.agreementError).toBe('boom-string');
  });

  test('読込中の重複呼び出しは無視する', async () => {
    const store = seedStore();
    let resolveRead: (value: DocumentRecord[]) => void = () => undefined;
    listSchemaVersionsMock.mockResolvedValue([makeSchemaVersion()]);
    getSchemaFieldsMock.mockResolvedValue([makeField()]);
    readDocumentsMock.mockReturnValue(
      new Promise((resolve) => {
        resolveRead = resolve;
      }),
    );
    // 1 回目は agreementLoading=true を同期的に立ててから非同期処理に入る
    const first = loadAgreementReport(store, makeDeps());
    expect(store.getState().adjudicate.agreementLoading).toBe(true);
    // 2 回目はガードにより即 no-op（readDocuments 等は一切呼ばない）
    await loadAgreementReport(store, makeDeps());
    expect(store.getState().adjudicate.agreementLoading).toBe(true);

    resolveRead([]);
    readStudiesMock.mockResolvedValue([]);
    readStudyDataSheetMock.mockResolvedValue({ fieldNames: [], rows: [] });
    readResultsDataRowsMock.mockResolvedValue([]);
    readAllDecisionsMock.mockResolvedValue([]);
    await first;
    expect(readDocumentsMock).toHaveBeenCalledTimes(1);
  });
});

describe('downloadAgreementCsv（issue #66）', () => {
  test('レポート未計算（agreement === null）は no-op', () => {
    const store = seedStore();
    const download = jest.fn();
    downloadAgreementCsv(store, makeDeps(), 'summary', download);
    expect(download).not.toHaveBeenCalled();
  });

  test('summary は buildAgreementSummaryCsv の内容をタイムスタンプ付きファイル名で保存する', async () => {
    const store = seedStore();
    setupTwoAnnotatorsReady();
    await loadAgreementReport(store, makeDeps());
    const download = jest.fn();
    downloadAgreementCsv(store, makeDeps({ now: () => '2026-07-12T03:04:05.000Z' }), 'summary', download);
    expect(download).toHaveBeenCalledTimes(1);
    const [filename, content, mimeType] = download.mock.calls[0] as [string, string, string];
    expect(filename).toBe('agreement_summary_20260712-030405.csv');
    expect(content).toContain('field_id,field_name,field_label,pair_count,agreement_count,agreement_rate,kappa');
    expect(mimeType).toBe('text/csv');
  });

  test('disagreements は buildAgreementDisagreementsCsv の内容を保存する', async () => {
    const store = seedStore();
    // A・B で不一致になるよう study データを用意する
    readDocumentsMock.mockResolvedValue([makeDocument()]);
    readStudiesMock.mockResolvedValue([makeStudy()]);
    readStudyDataSheetMock.mockResolvedValue({
      fieldNames: ['sample_size'],
      rows: [makeStudyDataRow({ annotator: A, values: { sample_size: '120' } }), makeStudyDataRow({ annotator: B, values: { sample_size: '130' } })],
    });
    readResultsDataRowsMock.mockResolvedValue([]);
    readAllDecisionsMock.mockResolvedValue([]);
    listSchemaVersionsMock.mockResolvedValue([makeSchemaVersion()]);
    getSchemaFieldsMock.mockResolvedValue([makeField()]);
    await loadAgreementReport(store, makeDeps());
    const download = jest.fn();
    downloadAgreementCsv(store, makeDeps({ now: () => '2026-07-12T03:04:05.000Z' }), 'disagreements', download);
    const [filename, content] = download.mock.calls[0] as [string, string, string];
    expect(filename).toBe('agreement_disagreements_20260712-030405.csv');
    expect(content).toContain('study_id,study_label,entity_key,field_id,field_label,value_a,value_b');
    expect(content).toContain('120');
    expect(content).toContain('130');
  });

  test('now / download を省略すると既定実装（nowIso8601 / downloadTextFile）を使う', async () => {
    const store = seedStore();
    setupTwoAnnotatorsReady();
    await loadAgreementReport(store, makeDeps());
    downloadAgreementCsv(store, makeDeps({ now: undefined }), 'summary');
    expect(downloadTextFile).toHaveBeenCalledTimes(1);
    const [filename] = (downloadTextFile as jest.Mock).mock.calls[0] as [string, string, string];
    expect(filename).toMatch(/^agreement_summary_\d{8}-\d{6}\.csv$/);
  });
});
