import {
  cancelExportWarning,
  confirmExportGenerate,
  downloadExportResult,
  loadExportData,
  requestExportGenerate,
  selectExportFormat,
  timestampForFilename,
  type ExportServiceDeps,
} from '../../../../src/app/services/exportService';
import { createInitialState, createStore, type ExportState, type Store } from '../../../../src/app/store';
import type { ExportFormat } from '../../../../src/domain/exportLog';
import { readDocuments } from '../../../../src/features/documents/documentRepository';
import { readStudies } from '../../../../src/features/documents/studyRepository';
import {
  readResultsDataRows,
  readStudyDataSheet,
} from '../../../../src/features/extraction/annotationRepository';
import { readEvidenceRows } from '../../../../src/features/extraction/evidenceRepository';
import { readRunAuditInfos } from '../../../../src/features/extraction/runRepository';
import type { BuiltExport } from '../../../../src/features/export/buildExport';
import { appendExportLog } from '../../../../src/features/export/exportLogRepository';
import {
  getSchemaFieldsByVersion,
  listSchemaVersions,
} from '../../../../src/features/schema/schemaRepository';
import { readAllDecisions } from '../../../../src/features/verification/decisionRepository';
import { ensureChildFolder, uploadTextFile } from '../../../../src/lib/google/drive';
import { getCurrentUserEmail } from '../../../../src/lib/google/identity';
import { downloadTextFile } from '../../../../src/app/ui/download';

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
const readAllDecisionsMock = readAllDecisions as jest.Mock;
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

function makeBuilt(format: ExportFormat, overrides: Partial<BuiltExport> = {}): BuiltExport {
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
  overrides: Partial<Record<ExportFormat, Partial<BuiltExport>>> = {},
): Record<ExportFormat, BuiltExport> {
  return {
    study_wide: makeBuilt('study_wide', overrides.study_wide ?? {}),
    results_long: makeBuilt('results_long', { unverifiedCellCount: null, ...(overrides.results_long ?? {}) }),
    audit: makeBuilt('audit', overrides.audit ?? {}),
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
  readRunAuditInfosMock.mockResolvedValue([]);
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
  test('7 種の素材を読み込み、最新版の項目で 3 形式を構築する', async () => {
    const store = makeStore();
    await loadExportData(store, makeDeps());
    const exportState = store.getState().export;
    expect(readDocumentsMock).toHaveBeenCalledWith('sheet-1', expect.anything());
    expect(getSchemaFieldsByVersionMock).toHaveBeenCalledWith('sheet-1', 2, expect.anything());
    expect(exportState.loading).toBe(false);
    expect(exportState.schemaVersion).toBe(2);
    expect(exportState.built?.study_wide.format).toBe('study_wide');
    expect(exportState.built?.results_long.format).toBe('results_long');
    expect(exportState.built?.audit.format).toBe('audit');
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
});
