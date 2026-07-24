import { invalidateDashboard, loadDashboard } from '../../../../src/app/services/dashboardService';
import type { VerificationDeps } from '../../../../src/app/services/verificationService';
import {
  readVerifyTargetMaterials,
  type VerifyTargetMaterial,
} from '../../../../src/app/services/verifyService';
import { createInitialState, createStore, type Store } from '../../../../src/app/store';
import type { DocumentRecord } from '../../../../src/domain/document';
import type { Evidence } from '../../../../src/domain/evidence';
import type { SchemaField } from '../../../../src/domain/schemaField';
import type { StudyRecord } from '../../../../src/domain/study';

jest.mock('../../../../src/app/services/verifyService', () => ({
  readVerifyTargetMaterials: jest.fn(),
}));

const readMaterialsMock = readVerifyTargetMaterials as jest.MockedFunction<
  typeof readVerifyTargetMaterials
>;

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
    textRef: 'ref',
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

function makeStudy(overrides: Partial<StudyRecord> = {}): StudyRecord {
  return {
    studyId: 'study-doc-1',
    studyLabel: 'Smith 2020',
    registrationId: null,
    createdAt: 't0',
    createdBy: 'me@example.com',
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

function makeMaterial(): VerifyTargetMaterial {
  return {
    target: {
      study: makeStudy(),
      documents: [makeDocument()],
      evidence: [makeEvidence()],
      fields: [makeField()],
      schemaVersion: 1,
      progress: { decided: 0, total: 1, byTab: [{ tab: 'study', decided: 0, total: 1 }] },
      armWarnings: [],
      aiExtractionStatus: 'extracted',
    },
    ownDecisions: [],
    armStructure: null,
  };
}

/** readVerifyTargetMaterials の既定モック応答（materials 1 件 + 空の runStartedAt） */
function makeMaterialsResult(materials: VerifyTargetMaterial[]) {
  return { materials, runStartedAt: new Map<string, string | null>() };
}

function makeDeps(): VerificationDeps {
  return {
    google: { fetch: jest.fn(), getAccessToken: jest.fn() },
    profile: { getProfileUserInfo: jest.fn() } as unknown as VerificationDeps['profile'],
    loadPdf: jest.fn(),
  };
}

function makeStore(patch: {
  withProject?: boolean;
  dashboard?: Partial<ReturnType<typeof createInitialState>['dashboard']>;
} = {}): Store {
  const state = createInitialState();
  if (patch.withProject !== false) {
    state.currentProject = {
      projectId: 'p1',
      spreadsheetId: 'sheet-1',
      driveFolderId: 'folder-1',
      name: 'テスト SR',
    };
  }
  state.dashboard = { ...state.dashboard, ...(patch.dashboard ?? {}) };
  return createStore(state);
}

beforeEach(() => {
  readMaterialsMock.mockReset();
  readMaterialsMock.mockResolvedValue(makeMaterialsResult([makeMaterial()]));
});

describe('invalidateDashboard', () => {
  test('data / loadError をリセットする（PR #190: 抽出完了時に呼ぶ）。loading は触らない', () => {
    const store = makeStore({
      dashboard: {
        loading: true,
        loadError: '前回の読込エラー',
        data: {
          sections: ['methods'],
          rows: [],
          totals: {
            progress: { decided: 0, total: 0 },
            accuracy: { accept: 0, edit: 0, reject: 0, notReported: 0, decided: 0 },
            anchor: { numerator: 0, denominator: 0 },
            notReported: { numerator: 0, denominator: 0 },
          },
        },
      },
    });
    invalidateDashboard(store);
    const { dashboard } = store.getState();
    expect(dashboard.data).toBeNull();
    expect(dashboard.loadError).toBeNull();
    // loading は触らない
    expect(dashboard.loading).toBe(true);
  });
});

describe('loadDashboard', () => {
  test('検証素材を読み込み、マトリクスへ畳み込んで data に置く', async () => {
    const store = makeStore();
    await loadDashboard(store, makeDeps());
    const { dashboard } = store.getState();
    expect(readMaterialsMock).toHaveBeenCalledWith(store, expect.anything(), 'sheet-1');
    expect(dashboard.loading).toBe(false);
    expect(dashboard.data?.sections).toEqual(['methods']);
    expect(dashboard.data?.rows[0]).toMatchObject({
      studyId: 'study-doc-1',
      studyLabel: 'Smith 2020',
      progress: { decided: 0, total: 1 },
    });
  });

  test('AI 抽出結果なし（Evidence 0 件）の study の手入力は buildDashboard で AI 精度内訳に加算されない', async () => {
    const material = makeMaterial();
    material.target.aiExtractionStatus = 'no_result';
    material.target.evidence = [];
    material.ownDecisions = [
      {
        decidedAt: 't-now',
        decidedBy: 'me@example.com',
        studyId: 'study-doc-1',
        fieldId: 'f-total',
        entityKey: '-',
        annotator: 'me@example.com',
        annotatorType: 'human_with_ai',
        schemaVersion: 1,
        action: 'accept',
        value: '120',
        note: null,
      },
    ];
    readMaterialsMock.mockResolvedValue(makeMaterialsResult([material]));
    const store = makeStore();
    await loadDashboard(store, makeDeps());
    const { dashboard } = store.getState();
    expect(dashboard.data?.rows[0]?.progress).toEqual({ decided: 1, total: 1 });
    expect(dashboard.data?.rows[0]?.accuracy).toEqual({
      accept: 0,
      edit: 0,
      reject: 0,
      notReported: 0,
      decided: 0,
    });
  });

  test('readVerifyTargetMaterials の runStartedAt を buildDashboard へそのまま渡す（PR #190 レビュー対応: セル単位の AI 精度算入判定）', async () => {
    const material = makeMaterial(); // evidence の runId は既定 'run-1'
    material.ownDecisions = [
      {
        decidedAt: '2026-07-19T00:00:00Z', // 表示 run の started_at より前 = 未算入
        decidedBy: 'me@example.com',
        studyId: 'study-doc-1',
        fieldId: 'f-total',
        entityKey: '-',
        annotator: 'me@example.com',
        annotatorType: 'human_with_ai',
        schemaVersion: 1,
        action: 'accept',
        value: '120',
        note: null,
      },
    ];
    readMaterialsMock.mockResolvedValue({
      materials: [material],
      runStartedAt: new Map([['run-1', '2026-07-20T00:00:00Z']]),
    });
    const store = makeStore();
    await loadDashboard(store, makeDeps());
    const { dashboard } = store.getState();
    expect(dashboard.data?.rows[0]?.progress).toEqual({ decided: 1, total: 1 });
    expect(dashboard.data?.rows[0]?.accuracy).toEqual({
      accept: 0,
      edit: 0,
      reject: 0,
      notReported: 0,
      decided: 0,
    });
  });

  test('プロジェクト未選択・読込中・読込済みはスキップし、force で再読込する', async () => {
    await loadDashboard(makeStore({ withProject: false }), makeDeps());
    expect(readMaterialsMock).not.toHaveBeenCalled();

    await loadDashboard(makeStore({ dashboard: { loading: true } }), makeDeps());
    expect(readMaterialsMock).not.toHaveBeenCalled();

    const loaded = makeStore({
      dashboard: {
        data: {
          sections: [],
          rows: [],
          totals: {
            progress: { decided: 0, total: 0 },
            accuracy: { accept: 0, edit: 0, reject: 0, notReported: 0, decided: 0 },
            anchor: { numerator: 0, denominator: 0 },
            notReported: { numerator: 0, denominator: 0 },
          },
        },
      },
    });
    await loadDashboard(loaded, makeDeps());
    expect(readMaterialsMock).not.toHaveBeenCalled();
    await loadDashboard(loaded, makeDeps(), { force: true });
    expect(readMaterialsMock).toHaveBeenCalledTimes(1);
    expect(loaded.getState().dashboard.data?.rows).toHaveLength(1);
  });

  test('読み込み失敗は loadError（Error 以外は文字列化）', async () => {
    const store = makeStore();
    readMaterialsMock.mockRejectedValue(new Error('権限がありません'));
    await loadDashboard(store, makeDeps());
    expect(store.getState().dashboard.loadError).toBe('権限がありません');
    expect(store.getState().dashboard.loading).toBe(false);

    const store2 = makeStore();
    readMaterialsMock.mockRejectedValue('壊れた応答');
    await loadDashboard(store2, makeDeps());
    expect(store2.getState().dashboard.loadError).toBe('壊れた応答');
  });
});
