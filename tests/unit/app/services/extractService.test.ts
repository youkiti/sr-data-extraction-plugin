import {
  cancelExtractConfirm,
  initExtractSelection,
  loadExtractTargets,
  requestExtractRun,
  resetExtractFieldSelection,
  retryExtractStudy,
  runExtract,
  setExtractHighAccuracyImages,
  setExtractModel,
  toggleAllExtractStudies,
  toggleExtractField,
  toggleExtractFieldSection,
  toggleExtractFieldSectionCollapse,
  toggleExtractStudy,
  type ExtractServiceDeps,
} from '../../../../src/app/services/extractService';
import { runExtraction } from '../../../../src/app/services/extractionService';
import { resolveProtocol } from '../../../../src/app/services/schemaService';
import { createInitialState, createStore, type Store } from '../../../../src/app/store';
import type { DocumentRecord } from '../../../../src/domain/document';
import type { Evidence } from '../../../../src/domain/evidence';
import type { ExtractionRun, RunWarning } from '../../../../src/domain/extractionRun';
import type { SchemaField } from '../../../../src/domain/schemaField';
import type { StudyRecord } from '../../../../src/domain/study';
import { readDocuments } from '../../../../src/features/documents/documentRepository';
import { readStudies } from '../../../../src/features/documents/studyRepository';
import {
  readRunStudyCoverage,
  type CompletedRunStudySummary,
} from '../../../../src/features/extraction/runRepository';
import { getSchemaFieldsByVersion } from '../../../../src/features/schema/schemaRepository';
import { ensureChildFolder } from '../../../../src/lib/google/drive';

// extractService → makeLoadDocumentPageImages → lib/pdf/loadPdf 経由で
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
jest.mock('../../../../src/features/schema/schemaRepository', () => ({
  getSchemaFieldsByVersion: jest.fn(),
}));
jest.mock('../../../../src/lib/google/drive', () => ({
  ensureChildFolder: jest.fn(),
}));

const runExtractionMock = runExtraction as jest.MockedFunction<typeof runExtraction>;
const resolveProtocolMock = resolveProtocol as jest.MockedFunction<typeof resolveProtocol>;
const readDocumentsMock = readDocuments as jest.MockedFunction<typeof readDocuments>;
const readStudiesMock = readStudies as jest.MockedFunction<typeof readStudies>;
const readCoverageMock = readRunStudyCoverage as jest.MockedFunction<typeof readRunStudyCoverage>;
const getSchemaFieldsByVersionMock =
  getSchemaFieldsByVersion as jest.MockedFunction<typeof getSchemaFieldsByVersion>;
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
    excluded: false,
    exclusionReason: null,
    exclusionNote: null,
    excludedAt: null,
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
    bboxPage: null,
    bbox: null,
    relocatedFrom: null,
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
    fieldIds: null,
    warnings: null,
    ...overrides,
  };
}

function makeOutcome(
  overrides: {
    status?: 'done' | 'partial_failure';
    studyIds?: string[];
    evidence?: Evidence[];
    rejectedItems?: unknown[];
    armWarnings?: RunWarning[];
  } = {},
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
      rejectedItems: (overrides.rejectedItems ?? []) as never[],
      batchFailures: [],
      armWarnings: overrides.armWarnings ?? [],
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
  readCoverageMock.mockResolvedValue({
    extracted: new Set(),
    interrupted: new Set(),
    latestCompletedRunByStudy: new Map(),
  });
  readDocumentsMock.mockResolvedValue([]);
  readStudiesMock.mockResolvedValue([]);
  // バッジ注記素材（issue #80）。既定は完了 run なし = バッジなし
  getSchemaFieldsByVersionMock.mockResolvedValue([]);
});

describe('loadExtractTargets', () => {
  test('ExtractionRuns の study カバレッジをそのまま抽出済み / 中断 study にする', async () => {
    readCoverageMock.mockResolvedValue({
      extracted: new Set(['study-doc-1']),
      interrupted: new Set(['study-doc-2']),
      latestCompletedRunByStudy: new Map(),
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

  describe('fieldSubsetBadges（issue #80: 「直近 run は n/m 項目」バッジ注記の素材）', () => {
    function summary(overrides: Partial<CompletedRunStudySummary> = {}): CompletedRunStudySummary {
      return {
        runId: 'run-1',
        studyIds: ['study-doc-1'],
        schemaVersion: 1,
        startedAt: 't1',
        fieldIds: null,
        ...overrides,
      };
    }

    test('サブセット run が直近: schema の全 field 数を版ごとにキャッシュして読み、{selected, total} を持つ', async () => {
      readCoverageMock.mockResolvedValue({
        extracted: new Set(),
        interrupted: new Set(),
        latestCompletedRunByStudy: new Map([
          ['study-doc-1', summary({ fieldIds: ['f-1', 'f-2'], schemaVersion: 3 })],
        ]),
      });
      getSchemaFieldsByVersionMock.mockResolvedValue([
        makeField({ fieldId: 'f-1' }),
        makeField({ fieldId: 'f-2' }),
        makeField({ fieldId: 'f-3' }),
      ]);
      const store = makeStore({});
      await loadExtractTargets(store, makeDeps());
      expect(store.getState().extract.fieldSubsetBadges).toEqual({
        'study-doc-1': { selected: 2, total: 3 },
      });
      expect(getSchemaFieldsByVersionMock).toHaveBeenCalledWith('sheet-1', 3, expect.anything());
    });

    test('全項目 run が直近: バッジなし（キー自体を持たない）', async () => {
      readCoverageMock.mockResolvedValue({
        extracted: new Set(),
        interrupted: new Set(),
        latestCompletedRunByStudy: new Map([['study-doc-1', summary({ fieldIds: null })]]),
      });
      const store = makeStore({});
      await loadExtractTargets(store, makeDeps());
      expect(store.getState().extract.fieldSubsetBadges).toEqual({});
      expect(getSchemaFieldsByVersionMock).not.toHaveBeenCalled();
    });

    test('完了 run なし: バッジなし', async () => {
      readCoverageMock.mockResolvedValue({
        extracted: new Set(),
        interrupted: new Set(),
        latestCompletedRunByStudy: new Map(),
      });
      const store = makeStore({});
      await loadExtractTargets(store, makeDeps());
      expect(store.getState().extract.fieldSubsetBadges).toEqual({});
    });

    test('同一 schema_version の複数 study はキャッシュを再利用する（1 回だけ読む）', async () => {
      readCoverageMock.mockResolvedValue({
        extracted: new Set(),
        interrupted: new Set(),
        latestCompletedRunByStudy: new Map([
          ['study-a', summary({ studyIds: ['study-a'], fieldIds: ['f-1'], schemaVersion: 2 })],
          ['study-b', summary({ studyIds: ['study-b'], fieldIds: ['f-1', 'f-2'], schemaVersion: 2 })],
        ]),
      });
      getSchemaFieldsByVersionMock.mockResolvedValue([makeField({ fieldId: 'f-1' }), makeField({ fieldId: 'f-2' })]);
      const store = makeStore({});
      await loadExtractTargets(store, makeDeps());
      expect(getSchemaFieldsByVersionMock).toHaveBeenCalledTimes(1);
      expect(store.getState().extract.fieldSubsetBadges).toEqual({
        'study-a': { selected: 1, total: 2 },
        'study-b': { selected: 2, total: 2 },
      });
    });
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
  test('未抽出の全 study を既定選択し（テキスト層なしも pdf_native で選択対象）、S6 のモデル入力を引き継ぐ', () => {
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
    // d3（抽出済み）だけが既定選択から外れる。d2（テキスト層なし）も pdf_native で抽出できるため含む
    expect(store.getState().extract.selectedStudyIds).toEqual([
      studyIdOf('d1'),
      studyIdOf('d2'),
      studyIdOf('d4'),
    ]);
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

  test('除外文書は既定選択の候補から外れる（issue #181。全除外 study は候補ごと消え、一部除外は残る）', () => {
    const docs = [
      makeDocument({ documentId: 'd1' }),
      makeDocument({ documentId: 'd2', excluded: true, exclusionReason: 'ineligible' }),
      makeDocument({ documentId: 'd3' }),
    ];
    const store = makeStore({ documents: docs, extract: { extractedStudyIds: [] } });
    initExtractSelection(store);
    expect(store.getState().extract.selectedStudyIds).toEqual([studyIdOf('d1'), studyIdOf('d3')]);
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

describe('toggleAllExtractStudies（issue #180）', () => {
  test('selected=true: 未抽出 study をまとめて選択に追加する', () => {
    const store = makeStore({ extract: { selectedStudyIds: [] } });
    toggleAllExtractStudies(store, ['s1', 's2'], true);
    expect(store.getState().extract.selectedStudyIds).toEqual(['s1', 's2']);
  });

  test('selected=true: 既に選択済みの抽出済み study の選択を維持する（union・重複追加しない）', () => {
    // s-extracted は個別チェックで選択済みの抽出済み study。未抽出は s1 のみ
    const store = makeStore({ extract: { selectedStudyIds: ['s-extracted', 's1'] } });
    toggleAllExtractStudies(store, ['s1', 's2'], true);
    expect(store.getState().extract.selectedStudyIds).toEqual(['s-extracted', 's1', 's2']);
  });

  test('selected=false: 全 study の選択を一括解除する（抽出済みの個別選択も消える）', () => {
    const store = makeStore({ extract: { selectedStudyIds: ['s-extracted', 's1', 's2'] } });
    toggleAllExtractStudies(store, ['s1', 's2'], false);
    expect(store.getState().extract.selectedStudyIds).toEqual([]);
  });
});

describe('resetExtractFieldSelection / toggleExtractField / toggleExtractFieldSection / toggleExtractFieldSectionCollapse（issue #80）', () => {
  const fields = [
    makeField({ fieldId: 'f-1', section: 'methods' }),
    makeField({ fieldId: 'f-2', section: 'methods' }),
    makeField({ fieldId: 'f-3', section: 'results' }),
  ];

  test('resetExtractFieldSelection: 選択・折りたたみ・高精度読み取りモードを既定へ戻す（issue #176）', () => {
    const store = makeStore({
      fields,
      extract: {
        selectedFieldIds: ['f-1'],
        collapsedFieldSections: ['methods'],
        highAccuracyImages: true,
      },
    });
    resetExtractFieldSelection(store);
    expect(store.getState().extract.selectedFieldIds).toBeNull();
    expect(store.getState().extract.collapsedFieldSections).toEqual([]);
    expect(store.getState().extract.highAccuracyImages).toBe(false);
  });

  test('setExtractHighAccuracyImages: 高精度読み取りモードのトグル切替（issue #176）', () => {
    const store = makeStore({ fields, extract: { highAccuracyImages: false } });
    setExtractHighAccuracyImages(store, true);
    expect(store.getState().extract.highAccuracyImages).toBe(true);
    setExtractHighAccuracyImages(store, false);
    expect(store.getState().extract.highAccuracyImages).toBe(false);
  });

  test('toggleExtractField: 単一項目の選択解除・追加', () => {
    const store = makeStore({ fields, extract: { selectedFieldIds: null } });
    toggleExtractField(store, 'f-2', false);
    expect(store.getState().extract.selectedFieldIds?.sort()).toEqual(['f-1', 'f-3']);
    toggleExtractField(store, 'f-2', true);
    expect(store.getState().extract.selectedFieldIds).toBeNull(); // 全件そろって null へ正規化
  });

  test('toggleExtractFieldSection: section 単位の全選択 / 全解除', () => {
    const store = makeStore({ fields, extract: { selectedFieldIds: null } });
    toggleExtractFieldSection(store, ['f-1', 'f-2'], false);
    expect(store.getState().extract.selectedFieldIds).toEqual(['f-3']);
    toggleExtractFieldSection(store, ['f-1', 'f-2'], true);
    expect(store.getState().extract.selectedFieldIds).toBeNull();
  });

  test('toggleExtractFieldSectionCollapse: 折りたたみの切替', () => {
    const store = makeStore({ fields, extract: { collapsedFieldSections: [] } });
    toggleExtractFieldSectionCollapse(store, 'methods');
    expect(store.getState().extract.collapsedFieldSections).toEqual(['methods']);
    toggleExtractFieldSectionCollapse(store, 'methods');
    expect(store.getState().extract.collapsedFieldSections).toEqual([]);
  });

  test('toggleExtractField / toggleExtractFieldSection: スキーマ未読込（null）でも落ちない（防御分岐）', () => {
    // allFieldIds が空になるため、正規化により常に null（全選択）へ畳み込まれる
    const store = makeStore({ fields: null, extract: { selectedFieldIds: null } });
    toggleExtractField(store, 'f-1', false);
    expect(store.getState().extract.selectedFieldIds).toBeNull();
    toggleExtractFieldSection(store, ['f-1'], true);
    expect(store.getState().extract.selectedFieldIds).toBeNull();
  });
});

describe('requestExtractRun / cancelExtractConfirm', () => {
  test('検証を通れば確認カードを開く（runError はクリア）', async () => {
    const store = makeStore({
      documents: [makeDocument()],
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
      expect(store.getState().extract.runError).toContain('確定済みの表のデザインを読み込めていません');
    }

    const noSelection = makeStore({ fields: [makeField()], extract: { selectedStudyIds: [] } });
    await requestExtractRun(noSelection, makeDeps());
    expect(noSelection.getState().extract.runError).toContain('対象 study を 1 件以上');

    const noFieldsSelected = makeStore({
      documents: [makeDocument()],
      fields: [makeField()],
      extract: { selectedStudyIds: ['study-doc-1'], selectedFieldIds: [] },
    });
    await requestExtractRun(noFieldsSelected, makeDeps());
    expect(noFieldsSelected.getState().extract.runError).toContain('抽出項目を 1 つ以上選択してください');

    const noModel = makeStore({
      documents: [makeDocument()],
      fields: [makeField()],
      extract: { selectedStudyIds: ['study-doc-1'], model: '' },
    });
    await requestExtractRun(noModel, makeDeps());
    expect(noModel.getState().extract.runError).toContain('モデルを選択してください');

    const noKey = makeStore({
      documents: [makeDocument()],
      fields: [makeField()],
      extract: { selectedStudyIds: ['study-doc-1'], model: 'gemini-test' },
    });
    await requestExtractRun(noKey, makeDeps({ loadApiKey: jest.fn().mockResolvedValue(null) }));
    expect(noKey.getState().extract.runError).toContain('Gemini API キーが未設定です');
    expect(noKey.getState().extract.confirming).toBe(false);
  });

  test('選択済み study が全て抽出候補から除外されている場合もエラー（issue #181 PR レビュー対応）', async () => {
    const store = makeStore({
      documents: [makeDocument({ documentId: 'doc-1', excluded: true })],
      fields: [makeField()],
      extract: { selectedStudyIds: ['study-doc-1'], model: 'gemini-test' },
    });
    await requestExtractRun(store, makeDeps());
    expect(store.getState().extract.runError).toContain('対象 study を 1 件以上');
    expect(store.getState().extract.confirming).toBe(false);
  });

  test('キャンセルで確認カードを閉じる', () => {
    const store = makeStore({ extract: { confirming: true } });
    cancelExtractConfirm(store);
    expect(store.getState().extract.confirming).toBe(false);
  });

  // 画像非対応モデルの実行ブロック（実際に解決済みの provider で判定する defense in depth）
  describe('画像非対応モデルの実行ブロック', () => {
    test('画像入力（no_text_layer）文書 + 実測 unsupported モデルはインラインエラーで確認カードを開かない', async () => {
      const store = makeStore({
        documents: [makeDocument({ documentId: 'doc-1', textStatus: 'no_text_layer' })],
        fields: [makeField()],
        extract: {
          selectedStudyIds: ['study-doc-1'],
          model: 'qwen/qwen3-235b-a22b-2507',
        },
      });
      await requestExtractRun(store, makeDeps());
      expect(store.getState().extract.confirming).toBe(false);
      expect(store.getState().extract.runError).toContain('qwen/qwen3-235b-a22b-2507');
      expect(store.getState().extract.runError).toContain('画像入力');
    });

    test('画像入力文書が無ければ unsupported モデルでもブロックしない', async () => {
      const store = makeStore({
        documents: [makeDocument({ documentId: 'doc-1' })],
        fields: [makeField()],
        extract: {
          selectedStudyIds: ['study-doc-1'],
          model: 'qwen/qwen3-235b-a22b-2507',
        },
      });
      await requestExtractRun(store, makeDeps());
      expect(store.getState().extract.confirming).toBe(true);
    });

    test('unknown（カタログ外）モデルはブロックしない', async () => {
      const store = makeStore({
        documents: [makeDocument({ documentId: 'doc-1', textStatus: 'no_text_layer' })],
        fields: [makeField()],
        extract: { selectedStudyIds: ['study-doc-1'], model: 'mystery-model' },
      });
      await requestExtractRun(store, makeDeps());
      expect(store.getState().extract.confirming).toBe(true);
    });
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

  test('画像非対応モデルの実行ブロック（defense in depth）: 確認カードを開いたまま unsupported モデルへ変更されていたら実行しない', async () => {
    const store = makeStore({
      documents: [
        makeDocument({ documentId: 'doc-1', textStatus: 'no_text_layer' }),
        makeDocument({ documentId: 'doc-2' }),
      ],
      fields: [makeField()],
      extract: {
        selectedStudyIds: ['study-doc-1'],
        model: 'qwen/qwen3-235b-a22b-2507',
        confirming: true,
        extractedStudyIds: [],
      },
    });
    await runExtract(store, makeDeps());
    expect(store.getState().extract.confirming).toBe(false);
    expect(store.getState().extract.runError).toContain('qwen/qwen3-235b-a22b-2507');
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
      // 全選択（既定）時は fieldIds: null で渡す（issue #80）
      fieldIds: null,
    });
    expect(params.fields).toEqual([makeField()]);
    // 選択 study（study-doc-1）配下の文書だけが対象
    expect(params.documents.map((doc) => doc.documentId)).toEqual(['doc-1']);
    // pdf_native（handoff-scanned-pdf-native-highlight.md §7.4 PR2）経路のため
    // loadDocumentPageImages も executeRun へ渡せるよう runExtraction へ注入する
    const runDeps = runExtractionMock.mock.calls[0]?.[1];
    expect(typeof runDeps?.loadDocumentPageImages).toBe('function');

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
        failureKind: null,
      },
    ]);
  });

  test('除外文書は抽出対象から外れる（issue #181）: 除外 study を選択していても対象文書が渡らない', async () => {
    const store = makeStore({
      documents: [
        makeDocument({ documentId: 'doc-1', excluded: true, exclusionReason: 'duplicate' }),
        makeDocument({ documentId: 'doc-2' }),
      ],
      fields: [makeField()],
      extract: {
        selectedStudyIds: ['study-doc-1', 'study-doc-2'],
        model: 'gemini-test',
        confirming: true,
        extractedStudyIds: [],
      },
    });
    runExtractionMock.mockResolvedValue(makeOutcome());
    await runExtract(store, makeDeps());

    const [params] = runExtractionMock.mock.calls[0] as unknown as [
      Parameters<typeof runExtraction>[0],
    ];
    // study-doc-1（除外済み文書のみ）は候補から消えるため対象に含まれない
    expect(params.documents.map((doc) => doc.documentId)).toEqual(['doc-2']);
  });

  test('確認カード表示後に選択済み study が全て候補から外れていた場合、performRun を呼ばず errNoStudies を返す（issue #181 PR レビュー対応）', async () => {
    // 確認カードを開いた後、実行するボタンを押すまでの間に別タブ等で選択済み study の文書が
    // 全部除外された、という稀な競合ケースを模す
    const store = makeStore({
      documents: [makeDocument({ documentId: 'doc-1', excluded: true, exclusionReason: 'duplicate' })],
      fields: [makeField()],
      extract: {
        selectedStudyIds: ['study-doc-1'],
        model: 'gemini-test',
        confirming: true,
        extractedStudyIds: [],
      },
    });
    await runExtract(store, makeDeps());

    expect(runExtractionMock).not.toHaveBeenCalled();
    const state = store.getState();
    expect(state.extract.running).toBe(false);
    expect(state.extract.confirming).toBe(false);
    expect(state.extract.runError).toContain('対象 study を 1 件以上');
  });

  test('高精度読み取りモード（issue #176）: チェック時は highAccuracyImages: true を渡し、lastRunHighAccuracyImages に確定値を保持する', async () => {
    const store = makeReadyStore({ highAccuracyImages: true });
    runExtractionMock.mockResolvedValue(makeOutcome());
    await runExtract(store, makeDeps());
    const [params] = runExtractionMock.mock.calls[0] as unknown as [
      Parameters<typeof runExtraction>[0],
    ];
    expect(params.highAccuracyImages).toBe(true);
    expect(store.getState().extract.lastRunHighAccuracyImages).toBe(true);
  });

  test('高精度読み取りモード（issue #176）: 未チェック時は highAccuracyImages: false を渡す（既定挙動を変えない）', async () => {
    const store = makeReadyStore();
    runExtractionMock.mockResolvedValue(makeOutcome());
    await runExtract(store, makeDeps());
    const [params] = runExtractionMock.mock.calls[0] as unknown as [
      Parameters<typeof runExtraction>[0],
    ];
    expect(params.highAccuracyImages).toBe(false);
    expect(store.getState().extract.lastRunHighAccuracyImages).toBe(false);
  });

  test('保存した OpenAI 互換接続を本番抽出へ渡す', async () => {
    const store = makeReadyStore();
    runExtractionMock.mockResolvedValue(makeOutcome());
    await runExtract(
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

  test('サブセット選択時は絞った fields + 選択 field_ids を runExtraction へ渡す（issue #80）', async () => {
    const fields = [makeField({ fieldId: 'f-1' }), makeField({ fieldId: 'f-2' })];
    const store = makeStore({
      documents: [makeDocument()],
      fields,
      extract: {
        selectedStudyIds: ['study-doc-1'],
        model: 'gemini-test',
        confirming: true,
        extractedStudyIds: [],
        selectedFieldIds: ['f-2'],
      },
    });
    runExtractionMock.mockResolvedValue(makeOutcome());
    await runExtract(store, makeDeps());
    const [params] = runExtractionMock.mock.calls[0] as unknown as [
      Parameters<typeof runExtraction>[0],
    ];
    expect(params.fieldIds).toEqual(['f-2']);
    expect(params.fields.map((field) => field.fieldId)).toEqual(['f-2']);
    expect(store.getState().extract.lastRunFieldIds).toEqual(['f-2']);
  });

  test('lastRunFieldIds は performRun 呼び出し前に確定し、実行が失敗しても保持される（A-2 の引き継ぎ元）', async () => {
    const store = makeReadyStore({ selectedFieldIds: ['f-total'] });
    runExtractionMock.mockRejectedValue(new Error('boom'));
    await runExtract(store, makeDeps());
    expect(store.getState().extract.runError).toBe('boom');
    expect(store.getState().extract.lastRunFieldIds).toEqual(['f-total']);
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
        failure: {
          studyId: 'study-doc-2',
          section: null,
          reason: 'api_error',
          detail: '500',
          failureKind: null,
        },
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
        failureKind: null,
      },
      {
        studyId: 'study-doc-2',
        status: 'failed',
        completedBatches: 1,
        totalBatches: 1,
        detail: 'api_error（500）',
        failureKind: null,
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

  test('arm completeness 警告（issue #106）を armWarnings へ反映する（実行開始時にリセット）', async () => {
    const warning = {
      kind: 'arm_completeness' as const,
      studyId: 'study-doc-1',
      section: null,
      expectedArmKeys: ['arm:1', 'arm:2'],
      missingItems: [{ armKey: 'arm:2', fieldId: 'f-total' }],
    };
    const store = makeReadyStore({
      // 前回 run の警告が残っている状態から開始する
      armWarnings: [{ ...warning, studyId: 'study-stale' }],
    });
    let atStart: unknown = null;
    runExtractionMock.mockImplementation(async () => {
      atStart = store.getState().extract.armWarnings;
      return makeOutcome({ armWarnings: [warning] });
    });
    await runExtract(store, makeDeps());
    expect(atStart).toEqual([]); // 実行開始時に前回分をリセットする
    expect(store.getState().extract.armWarnings).toEqual([warning]);
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
            failureKind: null,
          },
          {
            studyId: 'study-doc-2',
            status: 'failed',
            completedBatches: 1,
            totalBatches: 1,
            detail: 'api_error（500）',
            failureKind: null,
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
    // lastRunFieldIds 未設定（元 run の記録がない）ときは全項目扱い
    expect(params.fieldIds).toBeNull();

    const state = store.getState();
    expect(state.extract.retryingStudyId).toBeNull();
    expect(state.extract.studyRows).toEqual([
      {
        studyId: 'study-doc-1',
        status: 'done',
        completedBatches: 1,
        totalBatches: 1,
        detail: null,
        failureKind: null,
      },
      {
        studyId: 'study-doc-2',
        status: 'done',
        completedBatches: 1,
        totalBatches: 1,
        detail: null,
        failureKind: null,
      },
    ]);
    expect(state.extract.extractedStudyIds?.sort()).toEqual(['study-doc-1', 'study-doc-2']);
    expect(state.counts).toMatchObject({ evidenceRows: 1, dataRows: 1 });
  });

  test('A-2: 元 run の fieldIds（lastRunFieldIds）を引き継ぐ。現在のチェックリスト選択は無視する', async () => {
    const store = makeFailedStore();
    // 元 run はサブセット（f-total のみ）だった。その後チェックリストで全選択に変えていても
    // 再試行は元 run の選択（lastRunFieldIds）を使う
    store.setState({
      extract: {
        ...store.getState().extract,
        lastRunFieldIds: ['f-total'],
        selectedFieldIds: null,
      },
    });
    runExtractionMock.mockResolvedValue(makeOutcome({ studyIds: ['study-doc-2'] }));
    await retryExtractStudy(store, makeDeps(), 'study-doc-2');
    const [params] = runExtractionMock.mock.calls[0] as unknown as [
      Parameters<typeof runExtraction>[0],
    ];
    expect(params.fieldIds).toEqual(['f-total']);
    expect(params.fields.map((field) => field.fieldId)).toEqual(['f-total']);
    // 引き継いだ値を維持したまま記録し続ける
    expect(store.getState().extract.lastRunFieldIds).toEqual(['f-total']);
  });

  test('A-2（issue #176）: 元 run の高精度読み取りモード（lastRunHighAccuracyImages）を引き継ぐ。現在のチェックボックス状態は無視する', async () => {
    const store = makeFailedStore();
    // 元 run は高精度読み取りモード有効だった。その後チェックボックスを外していても
    // 再試行は元 run の設定（lastRunHighAccuracyImages）を使う
    store.setState({
      extract: {
        ...store.getState().extract,
        lastRunHighAccuracyImages: true,
        highAccuracyImages: false,
      },
    });
    runExtractionMock.mockResolvedValue(makeOutcome({ studyIds: ['study-doc-2'] }));
    await retryExtractStudy(store, makeDeps(), 'study-doc-2');
    const [params] = runExtractionMock.mock.calls[0] as unknown as [
      Parameters<typeof runExtraction>[0],
    ];
    expect(params.highAccuracyImages).toBe(true);
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

  test('arm completeness 警告（issue #106）: 再試行は当該 study の警告だけを差し替える', async () => {
    const otherWarning = {
      kind: 'arm_completeness' as const,
      studyId: 'study-doc-1',
      section: null,
      expectedArmKeys: ['arm:1', 'arm:2'],
      missingItems: [{ armKey: 'arm:2', fieldId: 'f-total' }],
    };
    const staleWarning = { ...otherWarning, studyId: 'study-doc-2' };
    const newWarning = {
      ...otherWarning,
      studyId: 'study-doc-2',
      expectedArmKeys: ['arm:1', 'arm:2', 'arm:3'],
      missingItems: [{ armKey: 'arm:3', fieldId: 'f-total' }],
    };
    const store = makeFailedStore();
    store.setState({
      extract: { ...store.getState().extract, armWarnings: [otherWarning, staleWarning] },
    });
    runExtractionMock.mockResolvedValue(
      makeOutcome({ studyIds: ['study-doc-2'], armWarnings: [newWarning] }),
    );
    await retryExtractStudy(store, makeDeps(), 'study-doc-2');
    // 他 study の警告は残し、study-doc-2 の古い警告だけが新しい結果で置き換わる
    expect(store.getState().extract.armWarnings).toEqual([otherWarning, newWarning]);
  });

  test('除外文書は再試行の対象からも外れる（issue #181）: 対象 study の文書が全除外なら見つからない扱い', async () => {
    const store = makeFailedStore();
    store.setState({
      documents: {
        ...store.getState().documents,
        records: [
          makeDocument({ documentId: 'doc-1' }),
          makeDocument({ documentId: 'doc-2', excluded: true, exclusionReason: 'duplicate' }),
        ],
      },
    });
    await retryExtractStudy(store, makeDeps(), 'study-doc-2');
    expect(store.getState().extract.runError).toContain('study-doc-2 の文書が見つかりません');
    expect(runExtractionMock).not.toHaveBeenCalled();
  });

  // 画像非対応モデルの実行ブロック（issue #191 レビュー対応）: 失敗後にモデルを画像非対応モデルへ
  // 切り替えて再試行すると既知の 404 を踏む問題への対応
  describe('画像非対応モデルの実行ブロック', () => {
    function makeBlockableStore(): Store {
      return makeStore({
        documents: [
          makeDocument({ documentId: 'doc-1' }),
          makeDocument({ documentId: 'doc-2', textStatus: 'no_text_layer' }),
        ],
        fields: [makeField()],
        extract: {
          selectedStudyIds: ['study-doc-1', 'study-doc-2'],
          model: 'qwen/qwen3-235b-a22b-2507',
          extractedStudyIds: ['study-doc-1'],
          run: makeRun({ status: 'partial_failure' }),
          studyRows: [
            {
              studyId: 'study-doc-1',
              status: 'done',
              completedBatches: 1,
              totalBatches: 1,
              detail: null,
              failureKind: null,
            },
            {
              studyId: 'study-doc-2',
              status: 'failed',
              completedBatches: 1,
              totalBatches: 1,
              detail: 'api_error（500）',
              failureKind: null,
            },
          ],
          rejectedCount: 1,
        },
      });
    }

    test('画像入力（no_text_layer）文書 + 実測 unsupported モデルは run を開始せず runError を出す', async () => {
      const store = makeBlockableStore();
      await retryExtractStudy(store, makeDeps(), 'study-doc-2');
      expect(store.getState().extract.runError).toContain('qwen/qwen3-235b-a22b-2507');
      expect(store.getState().extract.runError).toContain('画像入力');
      expect(runExtractionMock).not.toHaveBeenCalled();
    });

    test('ブロック時は retryingStudyId を null のまま保ち、失敗行を running プレースホルダへ書き換えない', async () => {
      const store = makeBlockableStore();
      await retryExtractStudy(store, makeDeps(), 'study-doc-2');
      expect(store.getState().extract.retryingStudyId).toBeNull();
      // 失敗行の表示（failureKind・detail）を維持したまま返す
      expect(store.getState().extract.studyRows[1]).toEqual({
        studyId: 'study-doc-2',
        status: 'failed',
        completedBatches: 1,
        totalBatches: 1,
        detail: 'api_error（500）',
        failureKind: null,
      });
    });

    test('unknown（カタログ外）モデルはブロックしない', async () => {
      const store = makeBlockableStore();
      store.setState({ extract: { ...store.getState().extract, model: 'mystery-model' } });
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
      expect(runExtractionMock).toHaveBeenCalledTimes(1);
      expect(store.getState().extract.studyRows[1]).toMatchObject({ status: 'done' });
    });
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
      failureKind: null,
    });
    expect(failing.getState().extract.retryingStudyId).toBeNull();
  });
});
