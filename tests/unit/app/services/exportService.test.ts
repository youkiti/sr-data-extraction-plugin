import {
  cancelExportWarning,
  changeMethodsLanguage,
  changeMethodsWorkflow,
  confirmExportGenerate,
  copyMethodsText,
  downloadExportResult,
  loadExportData,
  requestExportGenerate,
  selectExportFormat,
  timestampForFilename,
  type ExportServiceDeps,
} from '../../../../src/app/services/exportService';
import { createInitialState, createStore, type ExportState, type Store } from '../../../../src/app/store';
import { readDocuments } from '../../../../src/features/documents/documentRepository';
import { readStudies } from '../../../../src/features/documents/studyRepository';
import {
  readResultsDataRows,
  readStudyDataSheet,
} from '../../../../src/features/extraction/annotationRepository';
import { readEvidenceRows } from '../../../../src/features/extraction/evidenceRepository';
import { readMethodsRunFacts, readRunAuditInfos } from '../../../../src/features/extraction/runRepository';
import type { BuiltExport, ClassicExportFormat } from '../../../../src/features/export/buildExport';
import { appendExportLog } from '../../../../src/features/export/exportLogRepository';
import type { BuiltRSet, RSetFile, RSetMaterials } from '../../../../src/features/export/rset/buildRSet';
import {
  getSchemaFieldsByVersion,
  listSchemaVersions,
} from '../../../../src/features/schema/schemaRepository';
import { readAllDecisions } from '../../../../src/features/verification/decisionRepository';
import { readAllArmStructures } from '../../../../src/features/verification/armStructureRepository';
import { ensureChildFolder, uploadTextFile } from '../../../../src/lib/google/drive';
import { getCurrentUserEmail } from '../../../../src/lib/google/identity';
import { downloadTextFile } from '../../../../src/app/ui/download';
import { installChromeMock, type ChromeMock } from '../../../setup/chrome-mock';

jest.mock('../../../../src/features/documents/documentRepository', () => ({
  readDocuments: jest.fn(),
}));
jest.mock('../../../../src/features/documents/studyRepository', () => ({
  // resolveActiveStudies は純粋関数なので実物を使う
  ...jest.requireActual('../../../../src/features/documents/studyRepository'),
  readStudies: jest.fn(),
}));
jest.mock('../../../../src/features/extraction/annotationRepository', () => ({
  readStudyDataSheet: jest.fn(),
  readResultsDataRows: jest.fn(),
}));
jest.mock('../../../../src/features/extraction/evidenceRepository', () => ({
  readEvidenceRows: jest.fn(),
}));
jest.mock('../../../../src/features/extraction/runRepository', () => ({
  readRunAuditInfos: jest.fn(),
  readMethodsRunFacts: jest.fn(),
}));
jest.mock('../../../../src/features/export/exportLogRepository', () => ({
  appendExportLog: jest.fn(),
}));
jest.mock('../../../../src/features/schema/schemaRepository', () => ({
  listSchemaVersions: jest.fn(),
  getSchemaFieldsByVersion: jest.fn(),
}));
jest.mock('../../../../src/features/verification/decisionRepository', () => ({
  readAllDecisions: jest.fn(),
}));
jest.mock('../../../../src/features/verification/armStructureRepository', () => ({
  readAllArmStructures: jest.fn(),
}));
jest.mock('../../../../src/lib/google/drive', () => ({
  ensureChildFolder: jest.fn(),
  uploadTextFile: jest.fn(),
}));
jest.mock('../../../../src/lib/google/identity', () => ({
  getCurrentUserEmail: jest.fn(),
}));
jest.mock('../../../../src/app/ui/download', () => ({
  downloadTextFile: jest.fn(),
}));
jest.mock('../../../../src/utils/uuid', () => ({
  generateUuid: jest.fn(() => 'uuid-default'),
}));
jest.mock('../../../../src/utils/iso8601', () => ({
  nowIso8601: jest.fn(() => '2026-07-03T09:00:00.000Z'),
}));

const readDocumentsMock = readDocuments as jest.Mock;
const readStudiesMock = readStudies as jest.Mock;
const readStudyDataSheetMock = readStudyDataSheet as jest.Mock;
const readResultsDataRowsMock = readResultsDataRows as jest.Mock;
const readEvidenceRowsMock = readEvidenceRows as jest.Mock;
const readRunAuditInfosMock = readRunAuditInfos as jest.Mock;
const readMethodsRunFactsMock = readMethodsRunFacts as jest.Mock;
const readAllDecisionsMock = readAllDecisions as jest.Mock;
const readAllArmStructuresMock = readAllArmStructures as jest.Mock;
const listSchemaVersionsMock = listSchemaVersions as jest.Mock;
const getSchemaFieldsByVersionMock = getSchemaFieldsByVersion as jest.Mock;
const ensureChildFolderMock = ensureChildFolder as jest.Mock;
const uploadTextFileMock = uploadTextFile as jest.Mock;
const getCurrentUserEmailMock = getCurrentUserEmail as jest.Mock;
const appendExportLogMock = appendExportLog as jest.Mock;
const downloadTextFileMock = downloadTextFile as jest.Mock;

function makeDeps(overrides: Partial<ExportServiceDeps> = {}): ExportServiceDeps {
  return {
    google: { fetch: jest.fn(), getAccessToken: jest.fn() },
    profile: { getProfileUserInfo: jest.fn() },
    ...overrides,
  };
}

function makeBuilt(format: ClassicExportFormat, overrides: Partial<BuiltExport> = {}): BuiltExport {
  return {
    format,
    csv: '﻿a,b\r\n1,2\r\n',
    header: ['a', 'b'],
    previewRows: [['1', '2']],
    rowCount: 1,
    studyCount: 1,
    unverifiedCellCount: 0,
    skippedStudyLabels: [],
    droppedRowCount: 0,
    ...overrides,
  };
}

function makeBuiltAll(
  overrides: Partial<Record<ClassicExportFormat, Partial<BuiltExport>>> = {},
): Record<ClassicExportFormat, BuiltExport> {
  return {
    study_wide: makeBuilt('study_wide', overrides.study_wide ?? {}),
    results_long: makeBuilt('results_long', { unverifiedCellCount: null, ...(overrides.results_long ?? {}) }),
    audit: makeBuilt('audit', overrides.audit ?? {}),
  };
}

/** R セットの 8 ファイルを最小構成で持つ fake（データ行 1 件・未検証 0 件が既定） */
function makeRSetFile(name: string, rowCount: number, content = 'a,b\r\n1,2\r\n'): RSetFile {
  return { name, content, rowCount };
}

function makeBuiltRSet(overrides: Partial<BuiltRSet> = {}): BuiltRSet {
  return {
    files: [
      makeRSetFile('tab1.csv', 1),
      makeRSetFile('tab1_status.csv', 1),
      makeRSetFile('ma.csv', 1),
      makeRSetFile('ma_status.csv', 1),
      makeRSetFile('rob.csv', 0),
      makeRSetFile('data_dictionary.csv', 1),
      makeRSetFile('export_issues.csv', 0),
      makeRSetFile('export_manifest.json', 0, '{}\n'),
    ],
    issues: [],
    manifest: {
      export_format_version: '1.0',
      schema_version: 2,
      exported_at: '2026-07-03T09:00:00.000Z',
      app_version: '1.2.3',
      review_mode: 'single_with_ai',
      final_annotator_rule: 'consensus が 1 件ならそれ、なければ唯一の human 行',
      files: {},
      issues_summary: {},
    },
    ...overrides,
  };
}

/** generateRSetExport が実行する buildRSet 呼び出し用の空素材（gate 判定は state.export.rSet 側で行う） */
function emptyRSetMaterials(): RSetMaterials {
  return {
    studies: [],
    studyRows: [],
    resultsRows: [],
    decisions: [],
    evidences: [],
    armStructureRows: [],
    documentStudyIds: [],
    fields: [],
  };
}

function makeStore(patch: {
  withProject?: boolean;
  export?: Partial<ExportState>;
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
  state.export = { ...state.export, ...(patch.export ?? {}) };
  return createStore(state);
}

beforeEach(() => {
  readDocumentsMock.mockResolvedValue([]);
  readStudiesMock.mockResolvedValue([]);
  readStudyDataSheetMock.mockResolvedValue({ fieldNames: [], rows: [] });
  readResultsDataRowsMock.mockResolvedValue([]);
  readEvidenceRowsMock.mockResolvedValue([]);
  readAllDecisionsMock.mockResolvedValue([]);
  readAllArmStructuresMock.mockResolvedValue([]);
  readRunAuditInfosMock.mockResolvedValue([]);
  readMethodsRunFactsMock.mockResolvedValue([]);
  listSchemaVersionsMock.mockResolvedValue([{ schemaVersion: 2 }]);
  getSchemaFieldsByVersionMock.mockResolvedValue([]);
  ensureChildFolderMock.mockResolvedValue({ id: 'exports-folder', webViewLink: 'https://drive/folder' });
  uploadTextFileMock.mockResolvedValue({ id: 'file-1', webViewLink: 'https://drive/file-1' });
  getCurrentUserEmailMock.mockResolvedValue('me@example.com');
  appendExportLogMock.mockResolvedValue(undefined);
});

describe('timestampForFilename', () => {
  test('ISO 8601 を YYYYMMDD-HHMMSS へ落とす', () => {
    expect(timestampForFilename('2026-07-03T09:05:30.123Z')).toBe('20260703-090530');
  });
});

describe('loadExportData', () => {
  test('8 種の素材を読み込み、最新版の項目で 3 形式 + R セットを構築する', async () => {
    const store = makeStore();
    await loadExportData(store, makeDeps());
    const exportState = store.getState().export;
    expect(readDocumentsMock).toHaveBeenCalledWith('sheet-1', expect.anything());
    expect(readAllArmStructuresMock).toHaveBeenCalledWith('sheet-1', expect.anything());
    expect(getSchemaFieldsByVersionMock).toHaveBeenCalledWith('sheet-1', 2, expect.anything());
    expect(exportState.loading).toBe(false);
    expect(exportState.schemaVersion).toBe(2);
    expect(exportState.built?.study_wide.format).toBe('study_wide');
    expect(exportState.built?.results_long.format).toBe('results_long');
    expect(exportState.built?.audit.format).toBe('audit');
    // R セット（issue #60）: 8 ファイルが構築され、素材（rSetMaterials）も再生成用に保持される
    expect(exportState.rSetMaterials).not.toBeNull();
    expect(exportState.rSet?.files.map((file) => file.name)).toEqual([
      'tab1.csv',
      'tab1_status.csv',
      'ma.csv',
      'ma_status.csv',
      'rob.csv',
      'data_dictionary.csv',
      'export_issues.csv',
      'export_manifest.json',
    ]);
    // StudyData / ResultsData ともに空（beforeEach の既定）→ 人間の検証行が無い
    expect(exportState.rSet?.manifest.review_mode).toBe('no_human_verification');
  });

  test('R セットの review_mode は annotator_type から導出し、app_version は toolVersion を使う', async () => {
    readStudyDataSheetMock.mockResolvedValue({
      fieldNames: [],
      rows: [
        {
          studyId: 's1',
          annotator: 'me@example.com',
          annotatorType: 'human_with_ai',
          schemaVersion: 2,
          runId: null,
          updatedAt: '2026-07-01T00:00:00Z',
          values: {},
        },
      ],
    });
    const store = makeStore();
    await loadExportData(store, makeDeps({ getToolVersion: () => '1.2.3' }));
    const rSet = store.getState().export.rSet;
    expect(rSet?.manifest.review_mode).toBe('single_with_ai');
    expect(rSet?.manifest.app_version).toBe('1.2.3');
  });

  test('プロジェクト未選択・読込中・読込済みはスキップし、force で再読込する', async () => {
    await loadExportData(makeStore({ withProject: false }), makeDeps());
    expect(readDocumentsMock).not.toHaveBeenCalled();

    await loadExportData(makeStore({ export: { loading: true } }), makeDeps());
    expect(readDocumentsMock).not.toHaveBeenCalled();

    const loaded = makeStore({ export: { built: makeBuiltAll() } });
    await loadExportData(loaded, makeDeps());
    expect(readDocumentsMock).not.toHaveBeenCalled();
    await loadExportData(loaded, makeDeps(), { force: true });
    expect(readDocumentsMock).toHaveBeenCalledTimes(1);
  });

  test('確定済みスキーマが 1 版もない場合は loadError にする', async () => {
    listSchemaVersionsMock.mockResolvedValue([]);
    const store = makeStore();
    await loadExportData(store, makeDeps());
    expect(store.getState().export.loadError).toBe(
      '確定済みの表のデザインがありません。先に表のデザインを確定してください',
    );
  });

  test('読み込み失敗は loadError（Error 以外は文字列化）', async () => {
    const store = makeStore();
    readEvidenceRowsMock.mockRejectedValue(new Error('権限がありません'));
    await loadExportData(store, makeDeps());
    expect(store.getState().export.loadError).toBe('権限がありません');
    expect(store.getState().export.loading).toBe(false);

    const store2 = makeStore();
    readEvidenceRowsMock.mockRejectedValue('壊れた応答');
    await loadExportData(store2, makeDeps());
    expect(store2.getState().export.loadError).toBe('壊れた応答');
  });

  test('Methods 文案カードの実績値（methodsFacts）を組み立てる', async () => {
    readDocumentsMock.mockResolvedValue([
      { documentId: 'd1', studyId: 's1', textStatus: 'ok' },
      { documentId: 'd2', studyId: 's2', textStatus: 'no_text_layer' },
      { documentId: 'd3', studyId: 's3', textStatus: 'no_text_layer' },
    ]);
    readMethodsRunFactsMock.mockResolvedValue([
      { runType: 'full', provider: 'gemini', modelVersion: 'gemini-3.5-flash-001', studyIds: ['s1'] },
      { runType: 'full', provider: 'openrouter', modelVersion: 'gpt-test', studyIds: ['s2'] },
      { runType: 'full', provider: 'openai_compatible', modelVersion: 'custom-model', studyIds: ['s3'] },
      // full の modelVersion 重複は 1 つに畳み込む
      { runType: 'full', provider: 'gemini', modelVersion: 'gemini-3.5-flash-001', studyIds: ['s1'] },
      { runType: 'pilot', provider: 'gemini', modelVersion: 'gemini-3.5-flash-001', studyIds: ['s1', 's2'] },
      { runType: 'pilot', provider: 'gemini', modelVersion: 'gemini-3.5-flash-001', studyIds: ['s3'] },
      { runType: 'single_study', provider: 'gemini', modelVersion: 'ignored', studyIds: ['s9'] },
    ]);
    const store = makeStore();
    await loadExportData(store, makeDeps({ getToolVersion: () => '1.2.3' }));
    expect(readMethodsRunFactsMock).toHaveBeenCalledWith('sheet-1', expect.anything());
    expect(store.getState().export.methodsFacts).toEqual({
      toolVersion: '1.2.3',
      modelIds: ['gemini-3.5-flash-001', 'gpt-test', 'custom-model'],
      providers: ['Gemini', 'OpenRouter', 'OpenAI-compatible'],
      pilotStudyCount: 3, // s1 / s2 / s3 の和集合
      scannedDocumentCount: 2, // d2 / d3
    });
  });

  test('getToolVersion 未指定は chrome.runtime.getManifest().version を既定で使う', async () => {
    const chromeMock: ChromeMock = installChromeMock();
    chromeMock.runtime.getManifest.mockReturnValue({ version: '9.9.9' });
    const store = makeStore();
    await loadExportData(store, makeDeps());
    expect(store.getState().export.methodsFacts?.toolVersion).toBe('9.9.9');
  });

  test('chrome.runtime.getManifest が無い環境では tool_version は null になる', async () => {
    const chromeMock: ChromeMock = installChromeMock();
    // getManifest 自体が存在しない環境（jest / 一部 E2E）を模す
    (chromeMock.runtime as unknown as Record<string, unknown>).getManifest = undefined;
    const store = makeStore();
    await loadExportData(store, makeDeps());
    expect(store.getState().export.methodsFacts?.toolVersion).toBeNull();
  });
});

describe('selectExportFormat', () => {
  test('形式を切り替える。生成中は no-op', () => {
    const store = makeStore();
    selectExportFormat(store, 'audit');
    expect(store.getState().export.format).toBe('audit');

    const generating = makeStore({ export: { generating: true } });
    selectExportFormat(generating, 'audit');
    expect(generating.getState().export.format).toBe('study_wide');
  });
});

describe('requestExportGenerate', () => {
  test('未検証 0 件は即生成: exports/ 確保 → CSV アップロード → ExportLog 追記 → 結果カード', async () => {
    const store = makeStore({ export: { built: makeBuiltAll(), schemaVersion: 2 } });
    await requestExportGenerate(store, makeDeps({ newUuid: () => 'uuid-1' }));
    expect(ensureChildFolderMock).toHaveBeenCalledWith('exports', 'folder-1', expect.anything());
    expect(uploadTextFileMock).toHaveBeenCalledWith(
      {
        name: 'study_wide_20260703-090000.csv',
        content: '﻿a,b\r\n1,2\r\n',
        parentId: 'exports-folder',
        mimeType: 'text/csv',
      },
      expect.anything(),
    );
    expect(appendExportLogMock).toHaveBeenCalledWith(
      'sheet-1',
      {
        exportId: 'uuid-1',
        format: 'study_wide',
        schemaVersion: 2,
        studyCount: 1,
        fileRef: 'https://drive/file-1',
        exportedAt: '2026-07-03T09:00:00.000Z',
        exportedBy: 'me@example.com',
      },
      expect.anything(),
    );
    const exportState = store.getState().export;
    expect(exportState.generating).toBe(false);
    expect(exportState.result).toEqual({
      format: 'study_wide',
      filename: 'study_wide_20260703-090000.csv',
      fileRef: 'https://drive/file-1',
      rowCount: 1,
      exportedAt: '2026-07-03T09:00:00.000Z',
      csv: '﻿a,b\r\n1,2\r\n',
    });
  });

  test('newUuid / now 未指定は既定 seam（generateUuid / nowIso8601）を使う', async () => {
    const store = makeStore({ export: { built: makeBuiltAll(), schemaVersion: 2 } });
    await requestExportGenerate(store, makeDeps());
    expect(appendExportLogMock.mock.calls[0][1].exportId).toBe('uuid-default');
  });

  test('未検証セルが残る形式は警告ダイアログを開き、生成しない', async () => {
    const store = makeStore({
      export: {
        built: makeBuiltAll({ audit: { unverifiedCellCount: 3 } }),
        schemaVersion: 2,
        format: 'audit',
      },
    });
    await requestExportGenerate(store, makeDeps());
    expect(store.getState().export.confirmingWarning).toBe(true);
    expect(uploadTextFileMock).not.toHaveBeenCalled();
  });

  test('results_long（未検証の概念なし = null）は警告なしで生成する', async () => {
    const store = makeStore({
      export: { built: makeBuiltAll(), schemaVersion: 2, format: 'results_long' },
    });
    await requestExportGenerate(store, makeDeps());
    expect(uploadTextFileMock).toHaveBeenCalledTimes(1);
    expect(store.getState().export.confirmingWarning).toBe(false);
  });

  test('未読込・生成中・警告表示中・データ行 0 件は no-op', async () => {
    await requestExportGenerate(makeStore(), makeDeps());
    await requestExportGenerate(
      makeStore({ export: { built: makeBuiltAll(), schemaVersion: 2, generating: true } }),
      makeDeps(),
    );
    await requestExportGenerate(
      makeStore({ export: { built: makeBuiltAll(), schemaVersion: 2, confirmingWarning: true } }),
      makeDeps(),
    );
    await requestExportGenerate(
      makeStore({
        export: { built: makeBuiltAll({ study_wide: { rowCount: 0 } }), schemaVersion: 2 },
      }),
      makeDeps(),
    );
    expect(uploadTextFileMock).not.toHaveBeenCalled();
  });

  test('プロジェクト未選択・schemaVersion 欠落は生成の直前で止まる（防御）', async () => {
    await requestExportGenerate(
      makeStore({ withProject: false, export: { built: makeBuiltAll(), schemaVersion: 2 } }),
      makeDeps(),
    );
    await requestExportGenerate(
      makeStore({ export: { built: makeBuiltAll(), schemaVersion: null } }),
      makeDeps(),
    );
    expect(ensureChildFolderMock).not.toHaveBeenCalled();
  });

  test('メールが取れないときは exported_by 空文字で記録する', async () => {
    getCurrentUserEmailMock.mockResolvedValue(null);
    const store = makeStore({ export: { built: makeBuiltAll(), schemaVersion: 2 } });
    await requestExportGenerate(store, makeDeps());
    expect(appendExportLogMock.mock.calls[0][1].exportedBy).toBe('');
  });

  test('生成失敗は generateError（Error 以外は文字列化）にして復帰する', async () => {
    uploadTextFileMock.mockRejectedValue(new Error('Drive 容量不足'));
    const store = makeStore({ export: { built: makeBuiltAll(), schemaVersion: 2 } });
    await requestExportGenerate(store, makeDeps());
    expect(store.getState().export.generateError).toBe('Drive 容量不足');
    expect(store.getState().export.generating).toBe(false);
    expect(store.getState().export.result).toBeNull();

    uploadTextFileMock.mockRejectedValue('quota');
    const store2 = makeStore({ export: { built: makeBuiltAll(), schemaVersion: 2 } });
    await requestExportGenerate(store2, makeDeps());
    expect(store2.getState().export.generateError).toBe('quota');
  });
});

describe('requestExportGenerate: R セット（issue #60）', () => {
  function rSetStore(patch: Partial<ExportState> = {}): Store {
    return makeStore({
      export: {
        format: 'r_set',
        built: makeBuiltAll(),
        schemaVersion: 2,
        rSet: makeBuiltRSet(),
        rSetMaterials: emptyRSetMaterials(),
        ...patch,
      },
    });
  }

  test('未検証 0 件は即生成: exports/ 直下に rset_{timestamp}/ を作成 → 8 ファイルアップロード → ExportLog 追記', async () => {
    ensureChildFolderMock
      .mockResolvedValueOnce({ id: 'exports-folder', webViewLink: 'https://drive/exports' })
      .mockResolvedValueOnce({ id: 'rset-folder', webViewLink: 'https://drive/rset-folder' });
    const store = rSetStore();
    await requestExportGenerate(store, makeDeps({ newUuid: () => 'uuid-1', getToolVersion: () => '1.2.3' }));

    expect(ensureChildFolderMock).toHaveBeenNthCalledWith(1, 'exports', 'folder-1', expect.anything());
    expect(ensureChildFolderMock).toHaveBeenNthCalledWith(
      2,
      'rset_20260703-090000',
      'exports-folder',
      expect.anything(),
    );
    expect(uploadTextFileMock).toHaveBeenCalledTimes(8);
    expect(uploadTextFileMock).toHaveBeenCalledWith(
      { name: 'tab1.csv', content: expect.any(String), parentId: 'rset-folder', mimeType: 'text/csv' },
      expect.anything(),
    );
    expect(uploadTextFileMock).toHaveBeenCalledWith(
      {
        name: 'export_manifest.json',
        content: expect.any(String),
        parentId: 'rset-folder',
        mimeType: 'application/json',
      },
      expect.anything(),
    );
    expect(appendExportLogMock).toHaveBeenCalledWith(
      'sheet-1',
      {
        exportId: 'uuid-1',
        format: 'r_set',
        schemaVersion: 2,
        studyCount: 0, // rSetMaterials は空 → buildRSet の tab1.csv は 0 行
        fileRef: 'https://drive/rset-folder',
        exportedAt: '2026-07-03T09:00:00.000Z',
        exportedBy: 'me@example.com',
      },
      expect.anything(),
    );
    const exportState = store.getState().export;
    expect(exportState.generating).toBe(false);
    expect(exportState.result).toBeNull(); // 従来 3 形式の result はクリアされたまま
    expect(exportState.rSetResult).toEqual({
      folderRef: 'https://drive/rset-folder',
      folderName: 'rset_20260703-090000',
      exportedAt: '2026-07-03T09:00:00.000Z',
      built: expect.objectContaining({
        files: expect.arrayContaining([expect.objectContaining({ name: 'tab1.csv' })]),
      }),
    });
    // export_manifest.json の app_version / review_mode は生成時点で解決する
    expect(exportState.rSetResult?.built.manifest.app_version).toBe('1.2.3');
    expect(exportState.rSetResult?.built.manifest.review_mode).toBe('no_human_verification');
  });

  test('getToolVersion 未指定・getManifest 無しの環境では app_version は空文字', async () => {
    const chromeMock: ChromeMock = installChromeMock();
    (chromeMock.runtime as unknown as Record<string, unknown>).getManifest = undefined;
    const store = rSetStore();
    await requestExportGenerate(store, makeDeps());
    expect(store.getState().export.rSetResult?.built.manifest.app_version).toBe('');
  });

  test('未検証セルが残る場合は警告ダイアログを開き、生成しない', async () => {
    const store = rSetStore({
      rSet: makeBuiltRSet({
        issues: [{ issueType: 'unverified_cell', studyId: 's1', fieldId: 'f1', entityKey: 'e', detail: 'd' }],
      }),
    });
    await requestExportGenerate(store, makeDeps());
    expect(store.getState().export.confirmingWarning).toBe(true);
    expect(uploadTextFileMock).not.toHaveBeenCalled();
  });

  test('rSet 未読込・データ行 0 件・rSetMaterials 未読込は no-op', async () => {
    await requestExportGenerate(rSetStore({ rSet: null }), makeDeps());
    await requestExportGenerate(
      rSetStore({
        rSet: makeBuiltRSet({ files: makeBuiltRSet().files.map((file) => ({ ...file, rowCount: 0 })) }),
      }),
      makeDeps(),
    );
    expect(uploadTextFileMock).not.toHaveBeenCalled();

    // gate（rSet）は通るが生成時に rSetMaterials が無い（防御）
    const store = rSetStore({ rSetMaterials: null });
    await requestExportGenerate(store, makeDeps());
    expect(uploadTextFileMock).not.toHaveBeenCalled();
    expect(store.getState().export.generating).toBe(false);
  });

  test('プロジェクト未選択・schemaVersion 欠落は生成の直前で止まる（防御）', async () => {
    await requestExportGenerate(
      makeStore({
        withProject: false,
        export: { format: 'r_set', rSet: makeBuiltRSet(), rSetMaterials: emptyRSetMaterials() },
      }),
      makeDeps(),
    );
    await requestExportGenerate(
      rSetStore({ schemaVersion: null }),
      makeDeps(),
    );
    expect(ensureChildFolderMock).not.toHaveBeenCalled();
  });

  test('生成失敗は generateError にして復帰する', async () => {
    uploadTextFileMock.mockRejectedValue(new Error('Drive 容量不足'));
    const store = rSetStore();
    await requestExportGenerate(store, makeDeps());
    expect(store.getState().export.generateError).toBe('Drive 容量不足');
    expect(store.getState().export.generating).toBe(false);
    expect(store.getState().export.rSetResult).toBeNull();
  });

  test('メールが取れないときは exported_by 空文字で記録する', async () => {
    getCurrentUserEmailMock.mockResolvedValue(null);
    const store = rSetStore();
    await requestExportGenerate(store, makeDeps());
    expect(appendExportLogMock.mock.calls[0]?.[1].exportedBy).toBe('');
  });
});

describe('confirmExportGenerate / cancelExportWarning', () => {
  test('続行はダイアログを閉じて生成する。非表示中の呼び出しは no-op', async () => {
    const store = makeStore({
      export: {
        built: makeBuiltAll({ study_wide: { unverifiedCellCount: 2 } }),
        schemaVersion: 2,
        confirmingWarning: true,
      },
    });
    await confirmExportGenerate(store, makeDeps());
    expect(store.getState().export.confirmingWarning).toBe(false);
    expect(uploadTextFileMock).toHaveBeenCalledTimes(1);

    await confirmExportGenerate(makeStore(), makeDeps());
    expect(uploadTextFileMock).toHaveBeenCalledTimes(1); // 増えない
  });

  test('中止はダイアログを閉じるだけで生成しない', () => {
    const store = makeStore({
      export: { built: makeBuiltAll(), schemaVersion: 2, confirmingWarning: true },
    });
    cancelExportWarning(store);
    expect(store.getState().export.confirmingWarning).toBe(false);
    expect(uploadTextFileMock).not.toHaveBeenCalled();
  });

  test('R セットも続行で生成する（issue #60）', async () => {
    const store = makeStore({
      export: {
        format: 'r_set',
        built: makeBuiltAll(),
        schemaVersion: 2,
        confirmingWarning: true,
        rSet: makeBuiltRSet({
          issues: [{ issueType: 'unverified_cell', studyId: 's1', fieldId: 'f1', entityKey: 'e', detail: 'd' }],
        }),
        rSetMaterials: emptyRSetMaterials(),
      },
    });
    await confirmExportGenerate(store, makeDeps());
    expect(store.getState().export.confirmingWarning).toBe(false);
    expect(uploadTextFileMock).toHaveBeenCalledTimes(8);
    expect(store.getState().export.rSetResult).not.toBeNull();
  });
});

describe('downloadExportResult', () => {
  const result = {
    format: 'study_wide' as const,
    filename: 'study_wide_20260703-090000.csv',
    fileRef: 'https://drive/file-1',
    rowCount: 1,
    exportedAt: '2026-07-03T09:00:00.000Z',
    csv: 'csv-body',
  };

  test('直近の生成結果を Blob ダウンロードへ渡す（既定 = downloadTextFile）', () => {
    downloadExportResult(makeStore({ export: { result } }));
    expect(downloadTextFileMock).toHaveBeenCalledWith(
      'study_wide_20260703-090000.csv',
      'csv-body',
      'text/csv',
    );
  });

  test('注入した download 実装を使える。結果がなければ no-op', () => {
    const download = jest.fn();
    downloadExportResult(makeStore({ export: { result } }), download);
    expect(download).toHaveBeenCalledTimes(1);

    downloadExportResult(makeStore(), download);
    expect(download).toHaveBeenCalledTimes(1); // 増えない
  });

  test('R セットは 8 ファイルを個別ダウンロードする（zip 化しない）', () => {
    const download = jest.fn();
    const built = makeBuiltRSet();
    const store = makeStore({
      export: {
        format: 'r_set',
        rSetResult: {
          folderRef: 'https://drive/rset-folder',
          folderName: 'rset_20260703-090000',
          exportedAt: '2026-07-03T09:00:00.000Z',
          built,
        },
      },
    });
    downloadExportResult(store, download);
    expect(download).toHaveBeenCalledTimes(8);
    expect(download).toHaveBeenCalledWith('tab1.csv', expect.any(String), 'text/csv');
    expect(download).toHaveBeenCalledWith('export_manifest.json', '{}\n', 'application/json');
  });

  test('R セット選択時に rSetResult が無ければ no-op', () => {
    const download = jest.fn();
    downloadExportResult(makeStore({ export: { format: 'r_set', rSetResult: null } }), download);
    expect(download).not.toHaveBeenCalled();
  });
});

describe('changeMethodsLanguage / changeMethodsWorkflow', () => {
  test('言語タブを切り替える', () => {
    const store = makeStore();
    expect(store.getState().export.methodsLanguage).toBe('en'); // 既定 English
    changeMethodsLanguage(store, 'ja');
    expect(store.getState().export.methodsLanguage).toBe('ja');
    changeMethodsLanguage(store, 'en');
    expect(store.getState().export.methodsLanguage).toBe('en');
  });

  test('ワークフロートグルを切り替える', () => {
    const store = makeStore();
    expect(store.getState().export.methodsWorkflow).toBe('single'); // 既定 単一レビュアー
    changeMethodsWorkflow(store, 'dual');
    expect(store.getState().export.methodsWorkflow).toBe('dual');
    changeMethodsWorkflow(store, 'single');
    expect(store.getState().export.methodsWorkflow).toBe('single');
  });
});

describe('copyMethodsText', () => {
  const facts = {
    toolVersion: '1.2.3',
    modelIds: ['gemini-3.5-flash-001'],
    providers: ['Gemini'],
    pilotStudyCount: 3,
    scannedDocumentCount: 0,
  };

  test('現在の言語 / ワークフロー / 実績値から文案を組み立ててクリップボードへ書き込む', async () => {
    const writeClipboard = jest.fn().mockResolvedValue(undefined);
    const store = makeStore({
      export: { methodsFacts: facts, methodsLanguage: 'ja', methodsWorkflow: 'dual' },
    });
    await copyMethodsText(store, makeDeps({ writeClipboard }));
    expect(writeClipboard).toHaveBeenCalledTimes(1);
    const text = writeClipboard.mock.calls[0][0] as string;
    expect(text.startsWith('データ抽出. データ抽出には')).toBe(true);
    expect(text).toContain('レビュアー 2 名（{{reviewer_initials}}）が独立に');
    expect(text).toContain('gemini-3.5-flash-001');
  });

  test('methodsFacts 未読込は no-op', async () => {
    const writeClipboard = jest.fn().mockResolvedValue(undefined);
    const store = makeStore({ export: { methodsFacts: null } });
    await copyMethodsText(store, makeDeps({ writeClipboard }));
    expect(writeClipboard).not.toHaveBeenCalled();
  });

  test('コピー失敗（reject）でも例外を投げない', async () => {
    const writeClipboard = jest.fn().mockRejectedValue(new Error('denied'));
    const store = makeStore({ export: { methodsFacts: facts } });
    await expect(copyMethodsText(store, makeDeps({ writeClipboard }))).resolves.toBeUndefined();
  });

  test('writeClipboard 未注入なら navigator.clipboard を使う', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    const store = makeStore({ export: { methodsFacts: facts } });
    await copyMethodsText(store, makeDeps());
    expect(writeText).toHaveBeenCalledTimes(1);
  });
});
