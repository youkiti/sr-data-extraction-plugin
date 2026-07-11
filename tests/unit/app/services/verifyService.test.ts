import {
  latestRunEvidenceByStudy,
  loadVerifyTargets,
  openVerifyStudy,
  persistVerifyArmConfirmation,
  persistVerifyDecision,
  persistVerifyInstanceDeclarations,
  readVerifyTargetMaterials,
  setVerifyLayoutMode,
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
import type { SchemaVersion } from '../../../../src/domain/schemaVersion';
import type { StudyRecord } from '../../../../src/domain/study';
import { readDocuments } from '../../../../src/features/documents/documentRepository';
import { readStudies } from '../../../../src/features/documents/studyRepository';
import type { DisposablePdfDocument } from '../../../../src/features/documents/extractTextLayer';
import {
  readStudyDataSheet,
  upsertResultsDataRows,
  upsertStudyDataRows,
} from '../../../../src/features/extraction/annotationRepository';
import { readEvidenceRows } from '../../../../src/features/extraction/evidenceRepository';
import { readRunSchemaVersions } from '../../../../src/features/extraction/runRepository';
import {
  getSchemaFieldsByVersion,
  listSchemaVersions,
} from '../../../../src/features/schema/schemaRepository';
import {
  appendArmStructureVersion,
  readAllArmStructures,
  readArmStructuresByStudy,
} from '../../../../src/features/verification/armStructureRepository';
import {
  appendDecisionRows,
  readAllDecisions,
  readDecisionsByStudy,
} from '../../../../src/features/verification/decisionRepository';
import { getFileBinary, getFileText } from '../../../../src/lib/google/drive';
import { getCurrentUserEmail } from '../../../../src/lib/google/identity';
import type { OfflineQueue } from '../../../../src/lib/storage/offlineQueue';

jest.mock('../../../../src/features/documents/documentRepository', () => ({
  readDocuments: jest.fn(),
}));
jest.mock('../../../../src/features/documents/studyRepository', () => ({
  // resolveActiveStudies は純粋関数なので実物を使う（buildStudySelection が依存する）
  ...jest.requireActual('../../../../src/features/documents/studyRepository'),
  readStudies: jest.fn(),
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
  listSchemaVersions: jest.fn(),
}));
jest.mock('../../../../src/features/verification/decisionRepository', () => ({
  appendDecisionRows: jest.fn(),
  readAllDecisions: jest.fn(),
  readDecisionsByStudy: jest.fn(),
}));
jest.mock('../../../../src/features/verification/armStructureRepository', () => ({
  ...jest.requireActual('../../../../src/features/verification/armStructureRepository'),
  appendArmStructureVersion: jest.fn(),
  readAllArmStructures: jest.fn(),
  readArmStructuresByStudy: jest.fn(),
}));
jest.mock('../../../../src/lib/google/drive', () => ({
  getFileBinary: jest.fn(),
  getFileText: jest.fn(),
}));
jest.mock('../../../../src/lib/google/identity', () => ({
  getCurrentUserEmail: jest.fn(),
}));

const readDocumentsMock = readDocuments as jest.MockedFunction<typeof readDocuments>;
const readStudiesMock = readStudies as jest.MockedFunction<typeof readStudies>;
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
const listSchemaVersionsMock = listSchemaVersions as jest.MockedFunction<typeof listSchemaVersions>;
const appendDecisionsMock = appendDecisionRows as jest.MockedFunction<typeof appendDecisionRows>;
const readAllDecisionsMock = readAllDecisions as jest.MockedFunction<typeof readAllDecisions>;
const readDecisionsMock = readDecisionsByStudy as jest.MockedFunction<
  typeof readDecisionsByStudy
>;
const appendArmVersionMock = appendArmStructureVersion as jest.MockedFunction<
  typeof appendArmStructureVersion
>;
const readAllArmStructuresMock = readAllArmStructures as jest.MockedFunction<
  typeof readAllArmStructures
>;
const readArmStructuresMock = readArmStructuresByStudy as jest.MockedFunction<
  typeof readArmStructuresByStudy
>;
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

function makeStudy(overrides: Partial<StudyRecord> = {}): StudyRecord {
  return {
    studyId: 'study-doc-1',
    studyLabel: 'Smith 2020',
    registrationId: null,
    createdAt: 't0',
    createdBy: ME,
    note: null,
    ...overrides,
  };
}

/** documents から一意 study_id を作成順に拾って Studies 行を作る（1 文書 = 1 study） */
function studiesFor(documents: readonly DocumentRecord[]): StudyRecord[] {
  return [...new Set(documents.map((doc) => doc.studyId))].map((studyId) => makeStudy({ studyId }));
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

function makeSchemaVersion(overrides: Partial<SchemaVersion> = {}): SchemaVersion {
  return {
    schemaVersion: 1,
    parentVersion: null,
    protocolVersion: 1,
    createdByType: 'ai_draft',
    createdAt: 't0',
    createdBy: ME,
    note: null,
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
    study: makeStudy(),
    documents: [makeDocument()],
    evidence: [makeEvidence()],
    fields: [makeField()],
    schemaVersion: 1,
    progress: { decided: 0, total: 1, byTab: [] },
    ...overrides,
  };
}

function makeStore(patch: {
  withProject?: boolean;
  documents?: DocumentRecord[] | null;
  studies?: StudyRecord[] | null;
  verify?: Partial<ReturnType<typeof createInitialState>['verify']>;
  role?: ReturnType<typeof createInitialState>['role']['role'];
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
  // studies 未指定なら documents から導出してキャッシュ（readStudies を呼ばない）。
  // documents が null のときは studies も null（readStudies 経路のテスト用）
  const studies =
    patch.studies !== undefined ? patch.studies : records === null ? null : studiesFor(records);
  state.documents = { ...state.documents, records, studies };
  state.verify = { ...state.verify, ...(patch.verify ?? {}) };
  if (patch.role !== undefined) {
    state.role = { ...state.role, role: patch.role };
  }
  return createStore(state);
}

beforeEach(() => {
  readEvidenceRowsMock.mockResolvedValue([makeEvidence()]);
  readRunSchemaVersionsMock.mockResolvedValue(new Map([['run-1', 1]]));
  readAllDecisionsMock.mockResolvedValue([]);
  readDecisionsMock.mockResolvedValue([]);
  readStudyDataSheetMock.mockResolvedValue({ fieldNames: [], rows: [] });
  readAllArmStructuresMock.mockResolvedValue([]);
  readArmStructuresMock.mockResolvedValue([]);
  getSchemaFieldsMock.mockResolvedValue([makeField()]);
  listSchemaVersionsMock.mockResolvedValue([]);
  getCurrentUserEmailMock.mockResolvedValue(ME);
  getFileBinaryMock.mockResolvedValue(new ArrayBuffer(8));
  getFileTextMock.mockResolvedValue('');
  readStudiesMock.mockResolvedValue([makeStudy()]);
});

describe('latestRunEvidenceByStudy', () => {
  test('study ごとに最後に現れた run の Evidence だけを残す', () => {
    const map = latestRunEvidenceByStudy(
      [
        makeEvidence({ evidenceId: 'a', studyId: 'study-1', runId: 'run-1' }),
        makeEvidence({ evidenceId: 'b', studyId: 'study-2', runId: 'run-1' }),
        makeEvidence({ evidenceId: 'c', studyId: 'study-1', runId: 'run-2' }), // study-1 の新しい run
        makeEvidence({ evidenceId: 'd', studyId: 'study-1', runId: 'run-2', fieldId: 'f-2' }),
      ],
      new Set(['run-1', 'run-2']),
    );
    expect(map.get('study-1')?.runId).toBe('run-2');
    expect(map.get('study-1')?.evidence.map((item) => item.evidenceId)).toEqual(['c', 'd']);
    expect(map.get('study-2')?.runId).toBe('run-1');
  });

  test('ExtractionRuns に無い run の Evidence（孤児）は対象外とし、既知 run の最新を採る', () => {
    const map = latestRunEvidenceByStudy(
      [
        makeEvidence({ evidenceId: 'a', studyId: 'study-1', runId: 'run-1' }),
        makeEvidence({ evidenceId: 'b', studyId: 'study-1', runId: 'run-orphan' }), // 中断の孤児（最後に現れる）
        makeEvidence({ evidenceId: 'c', studyId: 'study-2', runId: 'run-orphan' }),
      ],
      new Set(['run-1']),
    );
    // study-1 は孤児を無視して既知の run-1 を表示、study-2 は孤児しかないため未抽出扱い
    expect(map.get('study-1')?.runId).toBe('run-1');
    expect(map.get('study-1')?.evidence.map((item) => item.evidenceId)).toEqual(['a']);
    expect(map.has('study-2')).toBe(false);
  });
});

describe('loadVerifyTargets', () => {
  test('Evidence がある study を進捗チップ付きで組み立てる（Evidence なし study は除外）', async () => {
    const store = makeStore({
      documents: [makeDocument(), makeDocument({ documentId: 'doc-no-evidence' })],
    });
    readAllDecisionsMock.mockResolvedValue([
      makeDecision(),
      makeDecision({ studyId: 'study-doc-other' }), // 他 study の判定は数えない
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
    expect(verify.targets?.[0]?.study.studyId).toBe('study-doc-1');
    expect(verify.targets?.[0]?.documents.map((doc) => doc.documentId)).toEqual(['doc-1']);
  });

  test('同じ schema_version の fields 読み出しはキャッシュする', async () => {
    const store = makeStore({
      documents: [makeDocument(), makeDocument({ documentId: 'doc-2' })],
    });
    readEvidenceRowsMock.mockResolvedValue([
      makeEvidence(),
      makeEvidence({ evidenceId: 'ev-2', studyId: 'study-doc-2', documentId: 'doc-2' }),
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
    expect(store.getState().verify.targets?.[0]?.progress).toEqual({
      decided: 0,
      total: 1,
      byTab: [{ tab: 'study', decided: 0, total: 1 }],
    });
  });

  test('ArmStructures の確定 arm を進捗分母に含める', async () => {
    const store = makeStore({ documents: [makeDocument()] });
    getSchemaFieldsMock.mockResolvedValue([
      makeField({ fieldId: 'f-arm', fieldName: 'arm_n', entityLevel: 'arm' }),
    ]);
    readEvidenceRowsMock.mockResolvedValue([makeEvidence({ fieldId: 'f-total' })]);
    readAllArmStructuresMock.mockResolvedValue([
      {
        studyId: 'study-doc-1',
        version: 1,
        armKey: 'arm:1',
        armName: '介入群',
        annotator: ME,
        annotatorType: 'human_with_ai',
        confirmedAt: 't0',
        note: null,
      },
    ]);
    await loadVerifyTargets(store, makeDeps());
    expect(store.getState().verify.targets?.[0]?.progress).toEqual({
      decided: 0,
      total: 1,
      byTab: [{ tab: 'arm', decided: 0, total: 1 }],
    });
  });
});

describe('readVerifyTargetMaterials: 独立入力モード（reviewer_independent。design §5.1）', () => {
  test('Evidence / ExtractionRuns を読まず、Studies × 最新確定スキーマから対象一覧を組む', async () => {
    const store = makeStore({ documents: [makeDocument()], role: 'reviewer_independent' });
    listSchemaVersionsMock.mockResolvedValue([
      makeSchemaVersion({ schemaVersion: 2 }),
      makeSchemaVersion({ schemaVersion: 1 }),
    ]);
    const materials = await readVerifyTargetMaterials(store, makeDeps(), 'sheet-1');
    expect(readEvidenceRowsMock).not.toHaveBeenCalled();
    expect(readRunSchemaVersionsMock).not.toHaveBeenCalled();
    // 最新版（先頭行）で解決する
    expect(getSchemaFieldsMock).toHaveBeenCalledWith('sheet-1', 2, expect.anything());
    expect(materials).toHaveLength(1);
    expect(materials[0]?.target.evidence).toEqual([]);
    expect(materials[0]?.target.schemaVersion).toBe(2);
    expect(materials[0]?.target.study.studyId).toBe('study-doc-1');
  });

  test('確定済みスキーマが 1 つも無ければ空配列（画面側が空状態メッセージを出す）', async () => {
    const store = makeStore({ documents: [makeDocument()], role: 'reviewer_independent' });
    listSchemaVersionsMock.mockResolvedValue([]);
    const materials = await readVerifyTargetMaterials(store, makeDeps(), 'sheet-1');
    expect(materials).toEqual([]);
    expect(getSchemaFieldsMock).not.toHaveBeenCalled();
  });

  test('アクティブ study が 0 件（Studies 未参照）なら空配列', async () => {
    const store = makeStore({ documents: [], role: 'reviewer_independent' });
    listSchemaVersionsMock.mockResolvedValue([makeSchemaVersion()]);
    const materials = await readVerifyTargetMaterials(store, makeDeps(), 'sheet-1');
    expect(materials).toEqual([]);
  });

  test('自分の判定・確定済み群構成を進捗へ反映する', async () => {
    const store = makeStore({ documents: [makeDocument()], role: 'reviewer_independent' });
    listSchemaVersionsMock.mockResolvedValue([makeSchemaVersion()]);
    readAllDecisionsMock.mockResolvedValue([makeDecision()]);
    readAllArmStructuresMock.mockResolvedValue([
      {
        studyId: 'study-doc-1',
        version: 1,
        armKey: 'arm:1',
        armName: '介入群',
        annotator: ME,
        annotatorType: 'human_independent',
        confirmedAt: 't0',
        note: null,
      },
      // 他 study の行は自分の study の armStructure に混ざらないことを確認する
      {
        studyId: 'study-doc-other',
        version: 1,
        armKey: 'arm:1',
        armName: '他 study の群',
        annotator: ME,
        annotatorType: 'human_independent',
        confirmedAt: 't0',
        note: null,
      },
    ]);
    const materials = await readVerifyTargetMaterials(store, makeDeps(), 'sheet-1');
    expect(materials[0]?.target.progress).toEqual({
      decided: 1,
      total: 1,
      byTab: [{ tab: 'study', decided: 1, total: 1 }],
    });
    expect(materials[0]?.armStructure).toEqual({
      version: 1,
      arms: [{ armKey: 'arm:1', armName: '介入群' }],
    });
  });

  test('owner / reviewer_with_ai は従来どおり Evidence 起点（role 省略時は owner）', async () => {
    const store = makeStore({ documents: [makeDocument()] });
    await readVerifyTargetMaterials(store, makeDeps(), 'sheet-1');
    expect(readEvidenceRowsMock).toHaveBeenCalled();
    expect(listSchemaVersionsMock).not.toHaveBeenCalled();
  });

  test('email 不明（null）は空文字 annotator として進捗を数える', async () => {
    const store = makeStore({ documents: [makeDocument()], role: 'reviewer_independent' });
    listSchemaVersionsMock.mockResolvedValue([makeSchemaVersion()]);
    getCurrentUserEmailMock.mockResolvedValue(null);
    readAllDecisionsMock.mockResolvedValue([makeDecision()]); // ME の判定は数えない
    const materials = await readVerifyTargetMaterials(store, makeDeps(), 'sheet-1');
    expect(materials[0]?.target.progress).toEqual({
      decided: 0,
      total: 1,
      byTab: [{ tab: 'study', decided: 0, total: 1 }],
    });
  });
});

describe('openVerifyStudy', () => {
  test('検証データ束を読み込み、selectedStudyId と studyValues を反映する', async () => {
    const store = makeStore({ verify: { targets: [makeTarget()] } });
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
    await openVerifyStudy(store, makeDeps(), 'study-doc-1');
    const { verify } = store.getState();
    expect(verify.selectedStudyId).toBe('study-doc-1');
    expect(verify.verifyLoading).toBe(false);
    expect(verify.verification?.annotator).toBe(ME);
    expect(verify.verification?.armStructure).toBeNull();
    expect(verify.verification?.documents.map((doc) => doc.document.documentId)).toEqual(['doc-1']);
    expect(verify.studyValues).toEqual({ sample_size_total: '100' });
    // bundle 組み立て時点では PDF を 1 件も読まない（issue #28 案3）。extracted_texts のみ先読み
    expect(getFileBinaryMock).not.toHaveBeenCalled();
    expect(getFileTextMock).toHaveBeenCalled();
    // レイアウトモードは検証データ束の読込時に settingsStore から読む（issue #38。未設定は既定 focus）
    expect(verify.layoutMode).toBe('focus');
  });

  test('extracted_texts を全文書ぶん先読みし、ページ別テキストへ復元する', async () => {
    const store = makeStore({ verify: { targets: [makeTarget()] } });
    getFileTextMock.mockResolvedValue('page one\fpage two');
    await openVerifyStudy(store, makeDeps(), 'study-doc-1');
    const { verification } = store.getState().verify;
    expect(getFileTextMock).toHaveBeenCalledWith('txt-1', expect.anything());
    expect(verification?.documents[0]?.extractedPages).toEqual([
      { page: 1, text: 'page one' },
      { page: 2, text: 'page two' },
    ]);
  });

  test('textRef が null（no_text_layer）の文書は extracted_texts を読まず空配列にする', async () => {
    const doc = makeDocument({ textRef: null, textStatus: 'no_text_layer' });
    const store = makeStore({
      documents: [doc],
      verify: { targets: [makeTarget({ documents: [doc] })] },
    });
    await openVerifyStudy(store, makeDeps(), 'study-doc-1');
    const { verification } = store.getState().verify;
    expect(getFileTextMock).not.toHaveBeenCalled();
    expect(verification?.documents[0]?.extractedPages).toEqual([]);
    expect(verification?.documents[0]?.extractedTextError).toBeNull();
  });

  test('extracted_texts の読込失敗は空配列 + extractedTextError に留め、bundle 全体は失敗させない', async () => {
    const store = makeStore({ verify: { targets: [makeTarget()] } });
    getFileTextMock.mockRejectedValue(new Error('403 forbidden'));
    await openVerifyStudy(store, makeDeps(), 'study-doc-1');
    const { verify } = store.getState();
    expect(verify.verifyError).toBeNull();
    expect(verify.verification?.documents[0]?.extractedPages).toEqual([]);
    expect(verify.verification?.documents[0]?.extractedTextError).toBe('403 forbidden');
  });

  test('loadPdfView / retryPdfView は同じ documentId への複数回呼び出しでも Drive を都度読まない', async () => {
    const store = makeStore({ verify: { targets: [makeTarget()] } });
    await openVerifyStudy(store, makeDeps(), 'study-doc-1');
    const { verification } = store.getState().verify;
    await verification?.loadPdfView('doc-1');
    await verification?.loadPdfView('doc-1');
    expect(getFileBinaryMock).toHaveBeenCalledTimes(1);
    getFileBinaryMock.mockRejectedValueOnce(new Error('一時的なエラー'));
    // retryPdfView はキャッシュを無視して読み直す
    const retried = await verification?.retryPdfView('doc-1');
    expect(retried?.pdfError).toBe('一時的なエラー');
    expect(getFileBinaryMock).toHaveBeenCalledTimes(2);
  });

  test('一覧に無い study_id は verifyError にして選び直せる', async () => {
    const store = makeStore({ verify: { targets: [makeTarget()] } });
    await openVerifyStudy(store, makeDeps(), 'study-9');
    expect(store.getState().verify.verifyError).toContain('study-9 が見つかりません');
    expect(readDecisionsMock).not.toHaveBeenCalled();
  });

  test('プロジェクト未選択・一覧未読込・読込中はスキップする', async () => {
    await openVerifyStudy(makeStore({ withProject: false }), makeDeps(), 'study-doc-1');
    await openVerifyStudy(makeStore({}), makeDeps(), 'study-doc-1');
    await openVerifyStudy(
      makeStore({ verify: { targets: [makeTarget()], verifyLoading: true } }),
      makeDeps(),
      'study-doc-1',
    );
    expect(readDecisionsMock).not.toHaveBeenCalled();
  });

  test('study 切替時は前の PDF を破棄する', async () => {
    const store = makeStore({
      verify: {
        targets: [
          makeTarget(),
          makeTarget({
            study: makeStudy({ studyId: 'study-doc-2' }),
            documents: [
              makeDocument({ documentId: 'doc-2', studyId: 'study-doc-2', driveFileId: 'drive-2' }),
            ],
          }),
        ],
      },
    });
    const pdf = makePdf();
    const deps = makeDeps({ loadPdf: jest.fn().mockResolvedValue(pdf) });
    await openVerifyStudy(store, deps, 'study-doc-1');
    // 表示中文書の PDF を読み込む（loadVerificationBundle 自体は PDF を読まないため明示的に読み込む）
    await store.getState().verify.verification?.loadPdfView('doc-1');
    expect(pdf.destroy).not.toHaveBeenCalled();
    await openVerifyStudy(store, deps, 'study-doc-2');
    expect(pdf.destroy).toHaveBeenCalledTimes(1);
    expect(store.getState().verify.selectedStudyId).toBe('study-doc-2');
  });

  test('読み込み失敗は verifyError に落ちる', async () => {
    const store = makeStore({ verify: { targets: [makeTarget()] } });
    readDecisionsMock.mockRejectedValue(new Error('権限がありません'));
    await openVerifyStudy(store, makeDeps(), 'study-doc-1');
    expect(store.getState().verify.verifyError).toBe('権限がありません');
    expect(store.getState().verify.verifyLoading).toBe(false);
  });

  test('role=reviewer_independent は annotatorType=human_independent の束を組み立てる（独立入力モード §5.2）', async () => {
    const store = makeStore({
      verify: { targets: [makeTarget()] },
      role: 'reviewer_independent',
    });
    await openVerifyStudy(store, makeDeps(), 'study-doc-1');
    expect(store.getState().verify.verification?.annotatorType).toBe('human_independent');
  });

  test('role 省略（owner 相当）は annotatorType=human_with_ai の束を組み立てる', async () => {
    const store = makeStore({ verify: { targets: [makeTarget()] } });
    await openVerifyStudy(store, makeDeps(), 'study-doc-1');
    expect(store.getState().verify.verification?.annotatorType).toBe('human_with_ai');
  });
});

describe('persistVerifyDecision', () => {
  function makeVerifyingStore(fields: SchemaField[] = [makeField()]): Store {
    return makeStore({
      verify: {
        targets: [makeTarget({ fields })],
        selectedStudyId: 'study-doc-1',
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
          studyId: 'study-doc-1',
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
      verify: { targets: [makeTarget()], selectedStudyId: 'study-doc-1', studyValues: null },
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
    await openVerifyStudy(store, makeDeps(), 'study-doc-1');
    return store;
  }

  test('表示中 study の群構成を ArmStructures へ追記する', async () => {
    const store = await makeShowingStore();
    const deps = makeDeps();
    appendArmVersionMock.mockResolvedValue({ version: 1, arms: [] });
    await persistVerifyArmConfirmation(store, deps, [{ armKey: 'arm:1', armName: '介入群' }]);
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

  test('独立入力モード（reviewer_independent）は annotatorType=human_independent で追記する（design §5.3）', async () => {
    const store = makeStore({ verify: { targets: [makeTarget()] }, role: 'reviewer_independent' });
    await openVerifyStudy(store, makeDeps(), 'study-doc-1');
    const deps = makeDeps();
    appendArmVersionMock.mockResolvedValue({ version: 1, arms: [] });
    await persistVerifyArmConfirmation(store, deps, [{ armKey: 'arm:1', armName: '介入群' }]);
    expect(appendArmVersionMock).toHaveBeenCalledWith(
      'sheet-1',
      expect.objectContaining({ annotatorType: 'human_independent' }),
      deps.google,
    );
  });
});

describe('persistVerifyInstanceDeclarations', () => {
  test('予約 Decision を Decisions へ追記する', async () => {
    const store = makeStore({});
    const decision = makeDecision({
      fieldId: '__entity_instance__',
      entityKey: 'outcome:mortality|arm:1',
      action: 'edit',
      value: 'outcome:mortality|arm:1',
      note: 'outcome_instance_declared',
    });
    await persistVerifyInstanceDeclarations(store, makeDeps(), [decision]);
    expect(appendDecisionsMock).toHaveBeenCalledWith('sheet-1', [decision], expect.anything());
    expect(upsertResultsMock).not.toHaveBeenCalled();
    expect(upsertStudyMock).not.toHaveBeenCalled();
  });

  test('プロジェクト未選択なら何もしない', async () => {
    await persistVerifyInstanceDeclarations(makeStore({ withProject: false }), makeDeps(), [
      makeDecision({ fieldId: '__entity_instance__' }),
    ]);
    expect(appendDecisionsMock).not.toHaveBeenCalled();
  });
});

describe('setVerifyLayoutMode（issue #38）', () => {
  test('verify.layoutMode を楽観反映し、settingsStore（deps 注入）へ永続化する', async () => {
    const store = makeStore({});
    const saveVerifyLayoutMode = jest.fn().mockResolvedValue(undefined);
    await setVerifyLayoutMode(store, makeDeps({ saveVerifyLayoutMode }), 'list');
    expect(store.getState().verify.layoutMode).toBe('list');
    expect(saveVerifyLayoutMode).toHaveBeenCalledWith('list');
  });
});
