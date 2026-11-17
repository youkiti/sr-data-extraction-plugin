import { addPilotOutcome } from '../../../../src/app/services/pilotOutcomeService';
import { createInitialState, createStore } from '../../../../src/app/store';
import { listSchemaVersions, getSchemaFieldsByVersion } from '../../../../src/features/schema/schemaRepository';
import { readAllSchemaOutcomes } from '../../../../src/features/schema/schemaOutcomeRepository';
import { saveSchemaVersion } from '../../../../src/features/schema/saveSchemaVersion';
import { resolveProtocol } from '../../../../src/app/services/schemaService';
import { loadPilotVerification, type PilotServiceDeps } from '../../../../src/app/services/pilotService';
import { getCurrentUserEmail } from '../../../../src/lib/google/identity';
import type { SchemaOutcome } from '../../../../src/domain/schemaOutcome';
import type { SchemaVersion } from '../../../../src/domain/schemaVersion';
import type { SchemaField } from '../../../../src/domain/schemaField';
import type { SchemaOutcomeEditorRow } from '../../../../src/features/schema/types';
import type { Protocol } from '../../../../src/domain/protocol';

jest.mock('../../../../src/features/schema/schemaRepository');
jest.mock('../../../../src/features/schema/schemaOutcomeRepository');
jest.mock('../../../../src/features/schema/saveSchemaVersion');
jest.mock('../../../../src/lib/google/identity');
jest.mock('../../../../src/app/services/pilotService', () => ({ loadPilotVerification: jest.fn() }));
jest.mock('../../../../src/app/services/schemaService', () => ({
  ...jest.requireActual('../../../../src/app/services/schemaService'), resolveProtocol: jest.fn(),
}));

const outcome = (schemaVersion: number, outcomeId = 'pain', patch: Partial<SchemaOutcome> = {}): SchemaOutcome => ({
  schemaVersion, outcomeId, aliases: [], outcomeIndex: 1, outcomeLabel: outcomeId, description: null,
  typicalTimepoints: null, addedVia: 'schema_editor', note: null, ...patch,
});
const row: SchemaOutcomeEditorRow = {
  aliases: [], outcomeId: 'sleep', outcomeLabel: '睡眠', description: null, typicalTimepoints: null,
  addedVia: 'pilot_verify', note: null, idLocked: false, idEdited: false,
};

function setup() {
  const state = createInitialState();
  const store = createStore({ ...state,
    currentProject: { spreadsheetId: 'sheet' } as NonNullable<typeof state.currentProject>,
    role: { ...state.role, role: 'owner' },
    pilot: { ...state.pilot, verifyStudyId: 'study', outcomeList: { schemaVersion: 1, outcomes: [outcome(1)], currentIds: new Set(['pain']), aliasToId: new Map(), everIds: new Set(['pain']) } },
  });
  const fields = [{ schemaVersion: 3, fieldId: 'f', fieldName: 'value', fieldLabel: '値', section: '結果', entityLevel: 'outcome_result', dataType: 'text', extractionInstruction: '', multiSelect: null } as SchemaField];
  jest.mocked(listSchemaVersions).mockResolvedValue([{ schemaVersion: 3 } as SchemaVersion]);
  jest.mocked(getSchemaFieldsByVersion).mockResolvedValue(fields);
  jest.mocked(readAllSchemaOutcomes).mockResolvedValue([outcome(3), outcome(3, 'mortality')]);
  jest.mocked(resolveProtocol).mockResolvedValue({ protocol: { version: 4 } as Protocol, text: '本文' });
  jest.mocked(getCurrentUserEmail).mockResolvedValue('owner@example.com');
  jest.mocked(saveSchemaVersion).mockImplementation(async (params) => ({
    version: { schemaVersion: 4 } as SchemaVersion, fields,
    outcomes: params.outcomes.map((item) => outcome(4, item.outcomeId, { ...item })),
  }));
  return { store, deps: { google: { fetch: jest.fn(), getAccessToken: jest.fn() } } as unknown as PilotServiceDeps, fields };
}

test('最新の項目と一覧から版を作り、全パイロットの文脈と S5 の状態を更新する', async () => {
  const { store, deps, fields } = setup();
  await addPilotOutcome(store, deps, row);
  expect(getSchemaFieldsByVersion).toHaveBeenCalledWith('sheet', 3, deps.google);
  expect(saveSchemaVersion).toHaveBeenCalledWith(expect.objectContaining({
    parentVersion: 3, protocolVersion: 4, createdByType: 'pilot_revision',
    note: 'パイロットの検証でアウトカム sleep を追加',
    outcomes: expect.arrayContaining([expect.objectContaining({ outcomeId: 'mortality' }), expect.objectContaining({ outcomeId: 'sleep', addedVia: 'pilot_verify', typicalTimepoints: null })]),
    rows: [expect.objectContaining({ fieldId: 'f' })],
  }), deps);
  expect(store.getState().pilot.outcomeList?.currentIds).toEqual(new Set(['pain', 'mortality', 'sleep']));
  expect(store.getState().schema.currentFields).toBe(fields);
  expect(store.getState().schema.currentOutcomesSourceVersion).toBe(4);
  expect(store.getState().schema.versions?.map((item) => item.schemaVersion)).toEqual([4, 3]);
  expect(loadPilotVerification).toHaveBeenCalledWith(store, deps, 'study');
});

test('追加成功後は依存キャッシュを破棄し、パイロットの PDF を保って検証を読み直す', async () => {
  const { store, deps } = setup();
  type State = ReturnType<typeof store.getState>;
  const state = store.getState();
  const pilotDispose = jest.fn();
  const verifyDispose = jest.fn();
  const adjudicateDispose = jest.fn();
  const verification = { disposePdf: pilotDispose } as unknown as State['pilot']['verification'];
  store.setState({
    pilot: { ...state.pilot, verification },
    verify: { ...state.verify, targets: [], selectedStudyId: 'study',
      verification: { disposePdf: verifyDispose } as unknown as State['verify']['verification'] },
    dashboard: { ...state.dashboard, data: {} as NonNullable<State['dashboard']['data']> },
    export: { ...state.export, built: {} as NonNullable<State['export']['built']> },
    adjudicate: { ...state.adjudicate, rows: [], outcomeList: null,
      working: { disposePdf: adjudicateDispose } as unknown as State['adjudicate']['working'] },
    home: { ...state.home, assignedProgress: {} as NonNullable<State['home']['assignedProgress']> },
  });
  const reloaded = { ...verification, reloaded: true } as unknown as State['pilot']['verification'];
  jest.mocked(loadPilotVerification).mockImplementationOnce(async () => {
    expect(store.getState().pilot.verification).toBe(verification);
    expect(store.getState().pilot.verifyStudyId).toBe('study');
    expect(store.getState().pilot.outcomeList?.currentIds.has('sleep')).toBe(true);
    expect(store.getState().verify.verification).toBeNull();
    store.setState({ pilot: { ...store.getState().pilot, verification: reloaded, verifyLoading: false } });
  });
  await addPilotOutcome(store, deps, row);
  expect(store.getState().verify).toMatchObject({ verification: null, targets: null, selectedStudyId: null });
  expect(store.getState().dashboard.data).toBeNull();
  expect(store.getState().export.built).toBeNull();
  expect(store.getState().adjudicate.rows).toBeNull();
  expect(store.getState().adjudicate.outcomeList).toBeUndefined();
  expect(store.getState().home.assignedProgress).toBeNull();
  expect(verifyDispose).toHaveBeenCalledTimes(1);
  expect(adjudicateDispose).toHaveBeenCalledTimes(1);
  expect(pilotDispose).not.toHaveBeenCalled();
  expect(store.getState().pilot.verification).toBe(reloaded);
  expect(store.getState().pilot.verifyLoading).toBe(false);
});

test('外した id は初出の経路と最後の時点を引き継ぐ', async () => {
  const { store, deps } = setup();
  jest.mocked(readAllSchemaOutcomes).mockResolvedValue([
    outcome(2, 'sleep', { addedVia: 'pilot_candidate', typicalTimepoints: '12 weeks', aliases: ['legacy_sleep'] }),
    outcome(1, 'sleep', { addedVia: 'migration', typicalTimepoints: '4 weeks', aliases: ['old_sleep'] }), outcome(3),
  ]);
  await addPilotOutcome(store, deps, row);
  expect(saveSchemaVersion).toHaveBeenCalledWith(expect.objectContaining({ outcomes: expect.arrayContaining([
    expect.objectContaining({ outcomeId: 'sleep', addedVia: 'migration', typicalTimepoints: '12 weeks', aliases: ['legacy_sleep'] }),
  ]) }), deps);
});

test('候補からの追加は経路を保持し、未選択の論文があっても保存できる', async () => {
  const { store, deps } = setup();
  store.setState({ pilot: { ...store.getState().pilot, verifyStudyId: null } });
  jest.mocked(getCurrentUserEmail).mockResolvedValue(null);
  await addPilotOutcome(store, deps, { ...row, addedVia: 'pilot_candidate' });
  expect(saveSchemaVersion).toHaveBeenCalledWith(expect.objectContaining({ createdBy: '', outcomes: expect.arrayContaining([expect.objectContaining({ addedVia: 'pilot_candidate' })]) }), deps);
  expect(loadPilotVerification).not.toHaveBeenCalled();
});

test.each(['project', 'role', 'list', 'version', 'duplicate', 'failure'])('保存条件を満たさないときは一覧を変えない: %s', async (reason) => {
  const { store, deps } = setup();
  if (reason === 'project') {
    store.setState({ currentProject: null });
  }
  if (reason === 'role') {
    store.setState({ role: { ...store.getState().role, role: 'reviewer_with_ai' } });
  }
  if (reason === 'list') {
    store.setState({ pilot: { ...store.getState().pilot, outcomeList: null } });
  }
  if (reason === 'version') {
    jest.mocked(listSchemaVersions).mockResolvedValue([]);
  }
  if (reason === 'duplicate') {
    jest.mocked(readAllSchemaOutcomes).mockResolvedValue([outcome(3, 'sleep')]);
  }
  if (reason === 'failure') {
    jest.mocked(saveSchemaVersion).mockRejectedValue(new Error('保存失敗'));
  }
  const before = store.getState().pilot.outcomeList;
  await expect(addPilotOutcome(store, deps, row)).rejects.toThrow();
  expect(store.getState().pilot.outcomeList).toBe(before);
});
