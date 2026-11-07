import { loadAiHumanComparison, downloadAiHumanComparisonCsv, invalidateDashboard } from '../../../../src/app/services/dashboardService';
import { createInitialState, createStore } from '../../../../src/app/store';
import type { VerificationDeps } from '../../../../src/app/services/verificationService';
import { readStudies } from '../../../../src/features/documents/studyRepository';
import { readDocuments } from '../../../../src/features/documents/documentRepository';
import { readStudyDataSheet, readResultsDataRows } from '../../../../src/features/extraction/annotationRepository';
import { readEvidenceRows } from '../../../../src/features/extraction/evidenceRepository';
import { readCompletedRunMetas } from '../../../../src/features/extraction/runRepository';
import { listSchemaVersions, getSchemaFieldsByVersion } from '../../../../src/features/schema/schemaRepository';
import { makeField, makeEvidence, makeRun } from '../../features/verification/pilotMatrixFixtures';
import { downloadTextFile } from '../../../../src/app/ui/download';

jest.mock('../../../../src/features/documents/studyRepository', () => ({
  ...jest.requireActual('../../../../src/features/documents/studyRepository'), readStudies: jest.fn(),
}));
jest.mock('../../../../src/features/documents/documentRepository', () => ({ readDocuments: jest.fn() }));
jest.mock('../../../../src/features/extraction/annotationRepository', () => ({ readStudyDataSheet: jest.fn(), readResultsDataRows: jest.fn() }));
jest.mock('../../../../src/features/extraction/evidenceRepository', () => ({ readEvidenceRows: jest.fn() }));
jest.mock('../../../../src/features/extraction/runRepository', () => ({ readCompletedRunMetas: jest.fn() }));
jest.mock('../../../../src/features/schema/schemaRepository', () => ({ listSchemaVersions: jest.fn(), getSchemaFieldsByVersion: jest.fn() }));
jest.mock('../../../../src/app/ui/download', () => ({ downloadTextFile: jest.fn() }));

function setup() {
  const state = createInitialState();
  state.currentProject = { projectId: 'p', spreadsheetId: 'sheet', driveFolderId: 'folder', name: 'test' };
  state.role.role = 'owner';
  return createStore(state);
}
const deps = { google: {}, profile: {}, loadPdf: jest.fn(), now: () => '2026-11-07T01:02:03Z' } as unknown as VerificationDeps;

beforeEach(() => {
  jest.clearAllMocks();
  (readStudies as jest.Mock).mockResolvedValue([{ studyId: 'study-1', studyLabel: '研究 1' }]);
  (readDocuments as jest.Mock).mockResolvedValue([{ studyId: 'study-1' }]);
  (readStudyDataSheet as jest.Mock).mockResolvedValue({ rows: [{ studyId: 'study-1', annotator: 'human',
    annotatorType: 'human_independent', values: { sample_size_total: '120' } }] });
  (readResultsDataRows as jest.Mock).mockResolvedValue([]);
  (readEvidenceRows as jest.Mock).mockResolvedValue([makeEvidence()]);
  (readCompletedRunMetas as jest.Mock).mockResolvedValue([makeRun()]);
  (listSchemaVersions as jest.Mock).mockResolvedValue([{ schemaVersion: 1 }]);
  (getSchemaFieldsByVersion as jest.Mock).mockResolvedValue([makeField()]);
});

test('手動計算、再計算、CSV 2 本、無効化', async () => {
  const store = setup();
  const download = jest.fn();
  downloadAiHumanComparisonCsv(store, deps, 'summary', download);
  expect(download).not.toHaveBeenCalled();
  const pending = loadAiHumanComparison(store, deps);
  expect(store.getState().dashboard.comparison.loading).toBe(true);
  await loadAiHumanComparison(store, deps);
  await pending;
  expect(readStudies).toHaveBeenCalledTimes(1);
  expect(store.getState().dashboard.comparison.data?.cells).toHaveLength(2);
  downloadAiHumanComparisonCsv(store, deps, 'summary', download);
  downloadAiHumanComparisonCsv(store, deps, 'cells', download);
  expect(download.mock.calls[0]?.[0]).toBe('ai_human_comparison_summary_20261107-010203.csv');
  expect(download.mock.calls[1]?.[0]).toBe('ai_human_comparison_cells_20261107-010203.csv');
  expect(download.mock.calls[1]?.[1]).toContain('study_label,study_id,field_id,field_name');
  expect(download.mock.calls[1]?.[1]).toContain('研究 1,study-1');
  store.setState({ role: { ...store.getState().role, role: 'reviewer_independent' } });
  downloadAiHumanComparisonCsv(store, deps, 'summary', download);
  expect(download).toHaveBeenCalledTimes(2);
  invalidateDashboard(store);
  expect(store.getState().dashboard.comparison).toEqual({ loading: false, error: null, data: null });
});

test('未選択・レビュアーは読まず、裁定者と null のロールは読める', async () => {
  const store = setup();
  const project = store.getState().currentProject;
  store.setState({ currentProject: null });
  await loadAiHumanComparison(store, deps);
  for (const role of ['reviewer_independent'] as const) {
    store.setState({ currentProject: project, role: { ...store.getState().role, role } });
    await loadAiHumanComparison(store, deps);
  }
  expect(readStudies).not.toHaveBeenCalled();
  for (const role of ['adjudicator', null] as const) {
    store.setState({ role: { ...store.getState().role, role } });
    await loadAiHumanComparison(store, deps);
    expect(store.getState().dashboard.comparison.data).not.toBeNull();
    downloadAiHumanComparisonCsv(store, {}, 'summary');
  }
  expect(downloadTextFile).toHaveBeenCalledTimes(2);
});

test('Documents から参照されない研究はセルにも未抽出・最終値なし件数にも入れない', async () => {
  const store = setup();
  (readStudies as jest.Mock).mockResolvedValue([
    { studyId: 'study-1', studyLabel: '研究 1' },
    { studyId: 'study-2', studyLabel: '未抽出の非アクティブ研究' },
    { studyId: 'study-3', studyLabel: '抽出済みの非アクティブ研究' },
  ]);
  (readCompletedRunMetas as jest.Mock).mockResolvedValue([makeRun({ studyIds: ['study-1', 'study-3'] })]);
  await loadAiHumanComparison(store, deps);
  const report = store.getState().dashboard.comparison.data!;
  expect(report.cells.map((cell) => cell.studyId)).toEqual(['study-1', 'study-1']);
  expect(report.unextractedStudyIds).toEqual([]);
  expect(report.noFinalStudyIds).toEqual([]);
});

test('スキーマなしは空の結果、失敗は Error と文字列を表示用に保持', async () => {
  const store = setup();
  (listSchemaVersions as jest.Mock).mockResolvedValue([]);
  await loadAiHumanComparison(store, deps);
  expect(store.getState().dashboard.comparison.data?.cells).toEqual([]);
  for (const error of [new Error('failed'), 'string failure']) {
    (readStudies as jest.Mock).mockRejectedValueOnce(error);
    await loadAiHumanComparison(store, deps);
    expect(store.getState().dashboard.comparison.error).toBe(error instanceof Error ? error.message : error);
  }
});

test('読み込み中にプロジェクトが変わったら成功・失敗を持ち込まない', async () => {
  for (const fails of [false, true]) {
    const store = setup();
    let resolve!: (value: unknown) => void;
    let reject!: (reason: unknown) => void;
    (readStudies as jest.Mock).mockReturnValueOnce(new Promise((yes, no) => {
      resolve = yes;
      reject = no;
    }));
    const pending = loadAiHumanComparison(store, deps);
    store.setState({ currentProject: null });
    if (fails) {
      reject('failed');
    } else {
      resolve([]);
    }
    await pending;
    expect(store.getState().dashboard.comparison.data).toBeNull();
    expect(store.getState().dashboard.comparison.error).toBeNull();
  }
});
