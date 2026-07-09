import { loadDashboard } from '../../../../src/app/services/dashboardService';
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
import { readStudies } from '../../../../src/features/documents/studyRepository';

jest.mock('../../../../src/app/services/verifyService', () => ({
  readVerifyTargetMaterials: jest.fn(),
}));
jest.mock('../../../../src/features/documents/studyRepository', () => ({
  // studyLabelMap は純粋関数なので実物を使う
  ...jest.requireActual('../../../../src/features/documents/studyRepository'),
  readStudies: jest.fn(),
}));

const readMaterialsMock = readVerifyTargetMaterials as jest.MockedFunction<
  typeof readVerifyTargetMaterials
>;
const readStudiesMock = readStudies as jest.MockedFunction<typeof readStudies>;

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
    ...overrides,
  };
}

function makeMaterial(): VerifyTargetMaterial {
  return {
    target: {
      document: makeDocument(),
      evidence: [makeEvidence()],
      fields: [makeField()],
      schemaVersion: 1,
      progress: { decided: 0, total: 1, byTab: [{ tab: 'study', decided: 0, total: 1 }] },
    },
    ownDecisions: [],
    armStructure: null,
  };
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
  readMaterialsMock.mockResolvedValue([makeMaterial()]);
  readStudiesMock.mockReset();
  readStudiesMock.mockResolvedValue([makeStudy()]);
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
      documentId: 'doc-1',
      progress: { decided: 0, total: 1 },
    });
  });

  test('Studies にラベルが無い study は study_id をそのまま表示ラベルにする', async () => {
    const store = makeStore();
    readStudiesMock.mockResolvedValue([]); // 該当 study のラベルが引けない
    await loadDashboard(store, makeDeps());
    expect(store.getState().dashboard.data?.rows[0]?.studyLabel).toBe('study-doc-1');
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
