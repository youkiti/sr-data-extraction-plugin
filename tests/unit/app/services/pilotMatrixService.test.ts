import { createInitialState, createStore } from '../../../../src/app/store';
import { emptyPilotMatrix, loadPilotMatrix } from '../../../../src/app/services/pilotMatrixService';
import type { VerificationDeps } from '../../../../src/app/services/verificationService';
import { readAllDecisions } from '../../../../src/features/verification/decisionRepository';
import { readEvidenceRows } from '../../../../src/features/extraction/evidenceRepository';
import { getCurrentUserEmail } from '../../../../src/lib/google/identity';
import { makeRun, makeDecision, makeEvidence } from '../../features/verification/pilotMatrixFixtures';
jest.mock('../../../../src/features/verification/decisionRepository');
jest.mock('../../../../src/features/extraction/evidenceRepository');
jest.mock('../../../../src/lib/google/identity');
const decisionsMock = jest.mocked(readAllDecisions);
const evidenceMock = jest.mocked(readEvidenceRows);
const emailMock = jest.mocked(getCurrentUserEmail);
const deps = { google: {}, profile: {} } as VerificationDeps;
function storeOf() {
  const state = createInitialState();
  state.currentProject = { projectId: 'p', spreadsheetId: 'sheet', driveFolderId: 'folder', name: 'SR' };
  state.pilot.run = makeRun();
  state.pilot.history = [makeRun(), makeRun({ runId: 'previous' })];
  return createStore(state);
}
beforeEach(() => {
  decisionsMock.mockResolvedValue([makeDecision(), makeDecision({ annotator: 'other' })]);
  evidenceMock.mockResolvedValue([makeEvidence({ runId: 'previous' }), makeEvidence()]);
  emailMock.mockResolvedValue('me@example.com');
});
test('束の判定と全 Evidence を再利用し、追加 Sheets 読込なし', async () => {
  const store = storeOf();
  await loadPilotMatrix(store, deps, { decisions: [makeDecision()], annotator: 'me@example.com', evidence: [makeEvidence({ runId: 'previous' })] });
  expect(decisionsMock).not.toHaveBeenCalled();
  expect(evidenceMock).not.toHaveBeenCalled();
  expect(store.getState().pilot.matrix?.previousEvidence).toHaveLength(1);
  const pilot = store.getState().pilot;
  store.setState({ pilot: { ...pilot, matrix: { ...pilot.matrix!, sortByMisses: true } } });
  await loadPilotMatrix(store, deps, { decisions: [], annotator: 'me@example.com' });
  expect(store.getState().pilot.matrix?.decisions).toHaveLength(1);
  expect(store.getState().pilot.matrix?.sortByMisses).toBe(true);
  expect(evidenceMock).not.toHaveBeenCalled();
});
test('再試行は判定 1 回、前回 Evidence 1 回で全 study を取得する', async () => {
  const store = storeOf();
  await loadPilotMatrix(store, deps);
  expect(decisionsMock).toHaveBeenCalledTimes(1);
  expect(evidenceMock).toHaveBeenCalledTimes(1);
  expect(store.getState().pilot.matrix?.decisions).toEqual([makeDecision()]);
  expect(store.getState().pilot.matrix?.previousEvidence).toHaveLength(1);
});
test('本体の失敗と比較だけの失敗を区別し再試行できる', async () => {
  const store = storeOf();
  decisionsMock.mockRejectedValueOnce(new Error('Decisions error'));
  await loadPilotMatrix(store, deps);
  expect(store.getState().pilot.matrix?.error).toContain('Decisions error');
  expect(store.getState().pilot.matrix?.loading).toBe(false);
  evidenceMock.mockRejectedValueOnce('Evidence error');
  await loadPilotMatrix(store, deps);
  expect(store.getState().pilot.matrix?.error).toBeNull();
  expect(store.getState().pilot.matrix?.compareError).toBe('Evidence error');
  await loadPilotMatrix(store, deps);
  expect(store.getState().pilot.matrix?.compareError).toBeNull();
});
test('プロジェクト・run なしは無操作、対象なしは読み込まず空、前回なしは比較を読まない', async () => {
  const store = createStore(createInitialState());
  await loadPilotMatrix(store, deps);
  expect(store.getState().pilot.matrix).toBeUndefined();
  const active = storeOf();
  active.setState({ pilot: { ...active.getState().pilot, run: null } });
  await loadPilotMatrix(active, deps);
  active.setState({ pilot: { ...active.getState().pilot, run: makeRun({ studyIds: [] }) } });
  await loadPilotMatrix(active, deps);
  expect(decisionsMock).not.toHaveBeenCalled();
  active.setState({ pilot: { ...active.getState().pilot, run: makeRun(), history: null } });
  emailMock.mockResolvedValue(null);
  await loadPilotMatrix(active, deps);
  expect(evidenceMock).not.toHaveBeenCalled();
  expect(active.getState().pilot.matrix?.previous).toBeNull();
});
test('待機中に run・プロジェクトが変わった結果を反映しない', async () => {
  for (const change of ['run', 'project', 'none'] as const) {
    const store = storeOf();
    decisionsMock.mockImplementationOnce(async () => {
      if (change === 'run') store.setState({ pilot: { ...store.getState().pilot, run: makeRun({ runId: 'other' }), matrix: emptyPilotMatrix() } });
      else store.setState({ currentProject: change === 'none' ? null : { ...store.getState().currentProject!, spreadsheetId: 'other' } });
      return [makeDecision()];
    });
    await loadPilotMatrix(store, deps);
    expect(store.getState().pilot.matrix?.decisions).toEqual([]);
  }
});

test('読込待機中の手元の判定を失わず、状態の破棄にも耐える', async () => {
  const store = storeOf();
  const edited = makeDecision({ action: 'edit', decidedAt: 't2', value: '99' });
  decisionsMock.mockImplementationOnce(async () => {
    const pilot = store.getState().pilot;
    store.setState({ pilot: { ...pilot, matrix: { ...pilot.matrix!, decisions: [edited] } } });
    return [makeDecision()];
  });
  await loadPilotMatrix(store, deps);
  expect(store.getState().pilot.matrix?.decisions).toContainEqual(edited);
  decisionsMock.mockImplementationOnce(async () => {
    store.setState({ pilot: { ...store.getState().pilot, matrix: undefined } });
    return [];
  });
  await loadPilotMatrix(store, deps);
  expect(store.getState().pilot.matrix?.decisions).toEqual([]);
});
