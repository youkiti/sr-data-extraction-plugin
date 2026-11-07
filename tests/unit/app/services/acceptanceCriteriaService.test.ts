import { createInitialState, createStore } from '../../../../src/app/store';
import { calculateCriteria, cancelCriteriaConfirmation, changeCriteriaDraft, criteriaState, emptyCriteriaState,
  loadCriteria, saveCriteria } from '../../../../src/app/services/acceptanceCriteriaService';
import type { VerificationDeps } from '../../../../src/app/services/verificationService';
import { confirmCriteria, emptyCriteriaDraft } from '../../../../src/features/verification/acceptanceCriteria';
import { appendAcceptanceCriteria, readAcceptanceCriteria } from '../../../../src/features/verification/acceptanceCriteriaRepository';
import { countPilotRuns, readCompletedRunMetas, readPilotRuns } from '../../../../src/features/extraction/runRepository';
import { getCurrentUserEmail } from '../../../../src/lib/google/identity';
import { readStudies } from '../../../../src/features/documents/studyRepository';
import { readDocuments } from '../../../../src/features/documents/documentRepository';
import { readStudyDataSheet, readResultsDataRows } from '../../../../src/features/extraction/annotationRepository';
import { readEvidenceRows } from '../../../../src/features/extraction/evidenceRepository';
import { listSchemaVersions, getSchemaFieldsByVersion } from '../../../../src/features/schema/schemaRepository';
import { makeRun } from '../../features/verification/pilotMatrixFixtures';
import { setUiLanguage } from '../../../../src/lib/i18n';

jest.mock('../../../../src/features/verification/acceptanceCriteriaRepository');
jest.mock('../../../../src/features/extraction/runRepository');
jest.mock('../../../../src/lib/google/identity');
jest.mock('../../../../src/features/documents/studyRepository', () => ({
  ...jest.requireActual('../../../../src/features/documents/studyRepository'), readStudies: jest.fn(),
}));
jest.mock('../../../../src/features/documents/documentRepository');
jest.mock('../../../../src/features/extraction/annotationRepository');
jest.mock('../../../../src/features/extraction/evidenceRepository');
jest.mock('../../../../src/features/schema/schemaRepository');
const deps = { google: {}, profile: {}, now: () => '2026-11-07T00:00:00Z' } as VerificationDeps;
const draft = { ...emptyCriteriaDraft(), min_accuracy: '90' };
const criteria = confirmCriteria(draft, [], 'me@example.com', deps.now!(), 0);
function storeOf() {
  const state = createInitialState();
  state.currentProject = { projectId: 'p', spreadsheetId: 's', driveFolderId: 'd', name: 'SR' };
  return createStore(state);
}
beforeEach(() => {
  setUiLanguage('ja');
  jest.mocked(readAcceptanceCriteria).mockResolvedValue({ versions: [criteria], ignoredCount: 0 });
  jest.mocked(readPilotRuns).mockResolvedValue([makeRun(), makeRun({ runType: 'full' })]);
  jest.mocked(countPilotRuns).mockResolvedValue(1);
  jest.mocked(readCompletedRunMetas).mockResolvedValue([]);
  jest.mocked(getCurrentUserEmail).mockResolvedValue('me@example.com');
  jest.mocked(readStudies).mockResolvedValue([]);
  jest.mocked(readDocuments).mockResolvedValue([]);
  jest.mocked(readStudyDataSheet).mockResolvedValue({ fieldNames: [], rows: [] });
  jest.mocked(readResultsDataRows).mockResolvedValue([]);
  jest.mocked(readEvidenceRows).mockResolvedValue([]);
  jest.mocked(listSchemaVersions).mockResolvedValue([]);
  jest.mocked(getSchemaFieldsByVersion).mockResolvedValue([]);
});

test('完了 run がなくても開始済み件数を読込・警告・確定・計算後に保つ', async () => {
  const store = storeOf();
  jest.mocked(readPilotRuns).mockResolvedValue([]);
  jest.mocked(countPilotRuns).mockResolvedValue(2);
  await loadCriteria(store, deps);
  expect(criteriaState(store).pilotCount).toBe(2);
  changeCriteriaDraft(store, draft);
  await saveCriteria(store, deps);
  expect(criteriaState(store)).toMatchObject({ pilotCount: 2, confirming: true });
  await saveCriteria(store, deps, true);
  expect(appendAcceptanceCriteria).toHaveBeenCalledWith('s', expect.objectContaining({ pilot_runs_before: 2 }), deps.google);
  await calculateCriteria(store, deps);
  expect(criteriaState(store)).toMatchObject({ pilotCount: 2, evaluation: { not_evaluable_reason: 'no_pilot' } });
});

test.each(['ja', 'en'] as const)('入力エラーを %s の利用者向け文言で示す', async (language) => {
  setUiLanguage(language);
  const store = storeOf();
  const invalid = { ...draft, comparator: 'invalid' as 'independent', entity_levels: [], min_accuracy: '-1',
    max_fabrication_rate: '101', max_omission_rate: 'NaN', max_wrong_value_rate: 'Infinity', min_compared_cells: '0' };
  changeCriteriaDraft(store, invalid);
  await saveCriteria(store, deps);
  const error = criteriaState(store).error!;
  for (const key of ['min_accuracy', 'entity_levels', 'min_compared_cells']) {
    expect(error).not.toContain(key);
  }
  expect(error).toContain(language === 'ja' ? '対象レベルを 1 つ以上' : 'Select at least one entity level');
  expect(error).toContain(language === 'ja' ? '正確度 ≥ (%) は 0〜100' : 'from 0 to 100 for Accuracy');
  expect(error).toContain(language === 'ja' ? '正の整数' : 'positive integer');
  changeCriteriaDraft(store, emptyCriteriaDraft());
  await saveCriteria(store, deps);
  expect(criteriaState(store).error).toContain(language === 'ja' ? '4 つの率のうち 1 つ以上' : 'at least one of the four rates');
  setUiLanguage('ja');
});

test('非 Error の読み込み・保存失敗と Error の計算失敗も接頭辞なしで表示する', async () => {
  const store = storeOf();
  jest.mocked(readAcceptanceCriteria).mockRejectedValueOnce('read failure');
  await loadCriteria(store, deps);
  expect(criteriaState(store).error).toBe('read failure');
  changeCriteriaDraft(store, draft);
  jest.mocked(readAcceptanceCriteria).mockRejectedValueOnce('save failure');
  await saveCriteria(store, deps);
  expect(criteriaState(store).error).toBe('save failure');
  jest.mocked(readAcceptanceCriteria).mockRejectedValueOnce(new Error('calculate failure'));
  await calculateCriteria(store, deps);
  expect(criteriaState(store).error).toBe('calculate failure');
});

test('下書き保持と取消、非 owner・保存中は変更不可', () => {
  const store = storeOf();
  changeCriteriaDraft(store, draft);
  expect(criteriaState(store).draft).toEqual(draft);
  cancelCriteriaConfirmation(store);
  store.setState({ pilot: { ...store.getState().pilot, criteria: { ...criteriaState(store), saving: true } } });
  changeCriteriaDraft(store, emptyCriteriaDraft());
  cancelCriteriaConfirmation(store);
  expect(criteriaState(store).draft).toEqual(draft);
  store.setState({ role: { ...store.getState().role, role: 'reviewer_independent' } });
  changeCriteriaDraft(store, emptyCriteriaDraft());
  expect(criteriaState(store).draft).toEqual(draft);
});

test('読込・重複起動・失敗・再読込', async () => {
  const store = storeOf();
  const loading = loadCriteria(store, deps);
  await loadCriteria(store, deps);
  await loading;
  expect(criteriaState(store).versions).toEqual([criteria]);
  expect(readAcceptanceCriteria).toHaveBeenCalledTimes(1);
  jest.mocked(readAcceptanceCriteria).mockRejectedValueOnce(new Error('read failure'));
  await loadCriteria(store, deps);
  expect(criteriaState(store).error).toBe('read failure');
  await loadCriteria(store, deps);
  expect(criteriaState(store).error).toBeNull();
});

test('owner は確認を挟み最大版の次に追記、パイロットだけを数える', async () => {
  const store = storeOf();
  changeCriteriaDraft(store, draft);
  await saveCriteria(store, deps, true);
  expect(appendAcceptanceCriteria).not.toHaveBeenCalled();
  await saveCriteria(store, deps);
  expect(criteriaState(store).confirming).toBe(true);
  expect(appendAcceptanceCriteria).not.toHaveBeenCalled();
  await saveCriteria(store, deps, true);
  expect(appendAcceptanceCriteria).toHaveBeenCalledWith('s', expect.objectContaining({ version: 2, pilot_runs_before: 1 }), deps.google);
  expect(criteriaState(store).confirming).toBe(false);
  expect(criteriaState(store).versions).toHaveLength(2);
  expect(criteriaState(store).saving).toBe(false);
});

test('検証・保存失敗・メール無し、非 owner は確定しない', async () => {
  const store = storeOf();
  await saveCriteria(store, deps);
  expect(criteriaState(store).error).toContain('4 つの率のうち 1 つ以上を入れてください');
  changeCriteriaDraft(store, draft);
  await saveCriteria(store, deps);
  jest.mocked(getCurrentUserEmail).mockResolvedValueOnce(null);
  await saveCriteria(store, deps, true);
  expect(criteriaState(store).error).toContain('Invalid');
  jest.mocked(appendAcceptanceCriteria).mockRejectedValueOnce(new Error('write failure'));
  await saveCriteria(store, deps, true);
  expect(criteriaState(store).error).toBe('write failure');
  expect(criteriaState(store).saving).toBe(false);
  store.setState({ role: { ...store.getState().role, role: 'adjudicator' } });
  jest.mocked(appendAcceptanceCriteria).mockClear();
  await saveCriteria(store, deps);
  expect(appendAcceptanceCriteria).not.toHaveBeenCalled();
});

test('結果は明示計算し、現在の版とパイロットを使う、空版と失敗', async () => {
  const store = storeOf();
  await loadCriteria(store, deps);
  expect(criteriaState(store).evaluation).toBeNull();
  const calculating = calculateCriteria(store, deps);
  await calculateCriteria(store, deps);
  await calculating;
  expect(criteriaState(store).evaluation?.not_evaluable_reason).toBe('no_compared_cells');
  jest.mocked(listSchemaVersions).mockResolvedValueOnce([{ schemaVersion: 2 } as Awaited<ReturnType<typeof listSchemaVersions>>[number]]);
  jest.mocked(readAcceptanceCriteria).mockResolvedValueOnce({ versions: [], ignoredCount: 1 });
  await calculateCriteria(store, deps);
  expect(criteriaState(store).evaluation).toBeNull();
  expect(getSchemaFieldsByVersion).toHaveBeenCalledWith('s', 2, deps.google);
  jest.mocked(readEvidenceRows).mockRejectedValueOnce('comparison failure');
  await calculateCriteria(store, deps);
  expect(criteriaState(store).error).toContain('comparison failure');
  expect(criteriaState(store).calculating).toBe(false);
});

test('プロジェクト無しと保存中・読み込み中のガード', async () => {
  const store = createStore(createInitialState());
  await loadCriteria(store, deps);
  await calculateCriteria(store, deps);
  await saveCriteria(store, deps);
  expect(criteriaState(store)).toEqual(emptyCriteriaState());
  const active = storeOf();
  active.setState({ pilot: { ...active.getState().pilot, criteria: { ...emptyCriteriaState(), saving: true } } });
  await calculateCriteria(active, deps);
  await saveCriteria(active, deps);
  active.setState({ pilot: { ...active.getState().pilot, criteria: { ...emptyCriteriaState(), loading: true } } });
  await saveCriteria(active, deps);
  expect(appendAcceptanceCriteria).not.toHaveBeenCalled();
});

test.each(['load', 'save', 'calculate'] as const)('待機中にプロジェクトが変わった %s の結果は捨てる', async (operation) => {
  for (const fail of [false, true]) {
    const store = storeOf();
    changeCriteriaDraft(store, draft);
    jest.mocked(readAcceptanceCriteria).mockImplementationOnce(async () => {
      store.setState({ currentProject: null });
      if (fail) {
        throw new Error('late failure');
      }
      return { versions: [criteria], ignoredCount: 0 };
    });
    if (operation === 'load') {
      await loadCriteria(store, deps);
    } else if (operation === 'save') {
      await saveCriteria(store, deps);
    } else {
      await calculateCriteria(store, deps);
    }
    expect(criteriaState(store).versions).toBeNull();
  }
});

test('確認後に権限が変わると保存しない', async () => {
  const store = storeOf();
  changeCriteriaDraft(store, draft);
  await saveCriteria(store, deps);
  jest.mocked(readAcceptanceCriteria).mockImplementationOnce(async () => {
    store.setState({ role: { ...store.getState().role, role: 'adjudicator' } });
    return { versions: [criteria], ignoredCount: 0 };
  });
  await saveCriteria(store, deps, true);
  expect(appendAcceptanceCriteria).not.toHaveBeenCalled();
});

test('既定の日時、アクティブ研究の結果と保存完了後のプロジェクト変更', async () => {
  const store = storeOf();
  jest.mocked(readStudies).mockResolvedValue([{ studyId: 's1' } as Awaited<ReturnType<typeof readStudies>>[number]]);
  jest.mocked(readDocuments).mockResolvedValue([{ studyId: 's1' } as Awaited<ReturnType<typeof readDocuments>>[number]]);
  await calculateCriteria(store, deps);
  expect(criteriaState(store).evaluation?.pilot_studies).toBe(0);
  changeCriteriaDraft(store, draft);
  await saveCriteria(store, deps);
  await saveCriteria(store, { ...deps, now: undefined }, true);
  expect(appendAcceptanceCriteria).toHaveBeenCalledWith('s', expect.objectContaining({ confirmed_at: expect.stringMatching(/^\d{4}-/) }), deps.google);
  await saveCriteria(store, deps);
  jest.mocked(appendAcceptanceCriteria).mockImplementationOnce(async () => { store.setState({ currentProject: null }); });
  await saveCriteria(store, deps, true);
  expect(store.getState().currentProject).toBeNull();
});
