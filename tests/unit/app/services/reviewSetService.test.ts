// 担当セットのロード順・owner 操作・共有進捗素材をローカルの I/O モックで検証する。
import { createInitialState, createStore } from '../../../../src/app/store';
import {
  assignStudyReviewSet,
  cancelResplit,
  confirmResplit,
  filterReviewSetStudies,
  loadReviewSets,
  readReviewSetProgressMaterials,
  requireReviewSets,
  reviewSetStudies,
  replaceReviewSetStudies,
  saveReviewSetEmails,
  splitReviewSets,
} from '../../../../src/app/services/reviewSetService';
import { loadAssignedProgress } from '../../../../src/app/services/homeService';
import { loadDashboard } from '../../../../src/app/services/dashboardService';
import { readDocuments } from '../../../../src/features/documents/documentRepository';
import {
  readStudies,
  updateStudyReviewSets,
} from '../../../../src/features/documents/studyRepository';
import {
  appendReviewSetRows,
  readReviewSetRows,
} from '../../../../src/features/project/reviewSetRepository';
import { readReviewerAssignments } from '../../../../src/features/project/reviewerRepository';
import { loadProjectMeta } from '../../../../src/features/project/selectProject';
import {
  getSchemaFieldsByVersion,
  listSchemaVersions,
} from '../../../../src/features/schema/schemaRepository';
import { readAllDecisions } from '../../../../src/features/verification/decisionRepository';
import { readAllArmStructures } from '../../../../src/features/verification/armStructureRepository';
import { getCurrentUserEmail } from '../../../../src/lib/google/identity';
import { readVerifyTargetMaterials } from '../../../../src/app/services/verifyService';
import type { ProjectRole } from '../../../../src/domain/reviewer';
import type { DocumentRecord } from '../../../../src/domain/document';
import { currentReviewSets } from '../../../../src/features/review/reviewSets';
import { decision, field, reviewSet, study } from '../../features/review/reviewSetFixtures';

jest.mock('../../../../src/features/documents/documentRepository', () => ({
  readDocuments: jest.fn(),
}));
jest.mock('../../../../src/features/documents/studyRepository', () => ({
  ...jest.requireActual('../../../../src/features/documents/studyRepository'),
  readStudies: jest.fn(),
  updateStudyReviewSets: jest.fn(),
}));
jest.mock('../../../../src/features/project/reviewSetRepository', () => ({
  ...jest.requireActual('../../../../src/features/project/reviewSetRepository'),
  readReviewSetRows: jest.fn(),
  appendReviewSetRows: jest.fn(),
}));
jest.mock('../../../../src/features/project/reviewerRepository', () => ({
  ...jest.requireActual('../../../../src/features/project/reviewerRepository'),
  readReviewerAssignments: jest.fn(),
}));
jest.mock('../../../../src/features/project/selectProject', () => ({ loadProjectMeta: jest.fn() }));
jest.mock('../../../../src/features/schema/schemaRepository', () => ({
  listSchemaVersions: jest.fn(),
  getSchemaFieldsByVersion: jest.fn(),
}));
jest.mock('../../../../src/features/verification/decisionRepository', () => ({
  readAllDecisions: jest.fn(),
}));
jest.mock('../../../../src/features/verification/armStructureRepository', () => ({
  ...jest.requireActual('../../../../src/features/verification/armStructureRepository'),
  readAllArmStructures: jest.fn(),
}));
jest.mock('../../../../src/lib/google/identity', () => ({ getCurrentUserEmail: jest.fn() }));
jest.mock('../../../../src/app/services/verifyService', () => ({
  readVerifyTargetMaterials: jest.fn(),
}));

const PROJECT = { projectId: 'p', spreadsheetId: 'sid', driveFolderId: 'folder', name: '研究' };
const deps = {
  google: { fetch: jest.fn(), getAccessToken: jest.fn() },
  profile: { getProfileUserInfo: jest.fn() },
  now: () => 't9',
  loadPdf: jest.fn(),
};
const doc = (studyId = 's1'): DocumentRecord => ({
  documentId: `d-${studyId}`,
  studyId,
  documentRole: 'article',
  driveFileId: `pdf-${studyId}`,
  sourceFileId: null,
  filename: '研究.pdf',
  pmid: null,
  doi: null,
  textRef: null,
  textStatus: 'ok',
  pageCount: null,
  charCount: null,
  importedAt: 't0',
  importedBy: 'owner@example.com',
  note: null,
  excluded: false,
  exclusionReason: null,
  exclusionNote: null,
  excludedAt: null,
});
function store(role: ProjectRole | null = 'owner') {
  const state = createInitialState();
  state.currentProject = PROJECT;
  state.role.role = role;
  state.reviewSets.sets = [];
  return createStore(state);
}
function activeStore(role: ProjectRole = 'owner') {
  const result = store(role);
  result.setState({
    documents: {
      ...result.getState().documents,
      studies: [
        study({ reviewSet: 'group-1' }),
        study({ studyId: 'cal', reviewSet: 'calibration' }),
        study({ studyId: 'inactive', reviewSet: 'group-1' }),
      ],
      records: [doc(), doc('cal')],
    },
    reviewSets: {
      ...result.getState().reviewSets,
      sets: [reviewSet(), reviewSet({ setId: 'calibration', studyIds: ['cal'], reviewerEmails: [] })],
    },
  });
  return result;
}
function texts() {
  return document.body.textContent ?? '';
}
beforeEach(() => {
  jest.resetAllMocks();
  document.body.innerHTML = '';
  jest.mocked(loadProjectMeta).mockResolvedValue({
    projectId: 'p',
    projectTitle: '研究',
    spreadsheetId: 'sid',
    driveFolderId: 'folder',
    schemaVersion: '1.0',
    createdAt: 't0',
    createdBy: 'owner@example.com',
  });
  jest.mocked(readReviewerAssignments).mockResolvedValue([]);
  jest.mocked(readReviewSetRows).mockResolvedValue([]);
  jest.mocked(readDocuments).mockResolvedValue([doc()]);
  jest.mocked(readStudies).mockResolvedValue([study()]);
  jest.mocked(getCurrentUserEmail).mockResolvedValue('owner@example.com');
  jest.mocked(listSchemaVersions).mockResolvedValue([]);
  jest.mocked(getSchemaFieldsByVersion).mockResolvedValue([field()]);
  jest.mocked(readAllDecisions).mockResolvedValue([]);
  jest.mocked(readAllArmStructures).mockResolvedValue([]);
  jest
    .mocked(readVerifyTargetMaterials)
    .mockResolvedValue({ materials: [], runStartedAt: new Map() });
});

describe('担当セットのロード', () => {
  test.each(['owner', 'reviewer_with_ai', 'reviewer_independent', 'adjudicator'] as const)(
    '全ロール %s で Meta の owner を使って畳み込む',
    async (role) => {
      const result = store(role);
      result.setState({ reviewSets: { ...result.getState().reviewSets, sets: null } });
      jest
        .mocked(readReviewSetRows)
        .mockResolvedValue([reviewSet(), reviewSet({ updatedBy: '改ざん' })]);
      await loadReviewSets(result, deps);
      expect(result.getState().reviewSets).toMatchObject({
        sets: [reviewSet()],
        ignoredCount: 1,
        loading: false,
        error: null,
      });
      expect(loadProjectMeta).toHaveBeenCalledWith('sid', deps.google);
      await loadReviewSets(result, deps);
      expect(readReviewSetRows).toHaveBeenCalledTimes(1);
      await loadReviewSets(result, deps, { force: true });
      expect(readReviewSetRows).toHaveBeenCalledTimes(2);
    },
  );
  test('プロジェクトなし・読込中は何もしない', async () => {
    await loadReviewSets(createStore(), deps);
    const result = store();
    result.setState({ reviewSets: { ...result.getState().reviewSets, sets: null, loading: true } });
    await loadReviewSets(result, deps);
    expect(readReviewSetRows).not.toHaveBeenCalled();
    result.setState({ role: { ...result.getState().role, role: 'reviewer_with_ai' } });
    await expect(requireReviewSets(result, deps)).rejects.toThrow('担当セットを読み込めません');
  });
  test('並行呼び出しは同じロード完了まで待つ', async () => {
    const result = store();
    result.setState({ reviewSets: { ...result.getState().reviewSets, sets: null } });
    let resolve!: (value: ReturnType<typeof reviewSet>[]) => void;
    jest.mocked(readReviewSetRows).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const first = loadReviewSets(result, deps);
    const second = loadReviewSets(result, deps);
    expect(result.getState().reviewSets.loading).toBe(true);
    expect(readReviewSetRows).toHaveBeenCalledTimes(1);
    resolve([]);
    await Promise.all([first, second]);
    expect(result.getState().reviewSets.loading).toBe(false);
  });
  test.each([new Error('offline'), 'offline'])(
    '失敗は保持し、非 owner は閉じたまま、force で復帰する (%s)',
    async (error) => {
      const result = store('reviewer_independent');
      result.setState({ reviewSets: { ...result.getState().reviewSets, sets: null } });
      jest.mocked(readReviewSetRows).mockRejectedValue(error);
      await loadReviewSets(result, deps);
      await expect(requireReviewSets(result, deps)).rejects.toThrow('offline');
      expect(readReviewSetRows).toHaveBeenCalledTimes(1);
      result.setState({ role: { ...result.getState().role, role: 'owner' } });
      await expect(requireReviewSets(result, deps)).resolves.toBeUndefined();
      expect(filterReviewSetStudies(result, [study()], [doc()], '', true)).toEqual([study()]);
      jest.mocked(readReviewSetRows).mockResolvedValue([]);
      await loadReviewSets(result, deps, { force: true });
      expect(result.getState().reviewSets.error).toBeNull();
    },
  );
  test('未解決のロールは起動ゲートに任せる', async () => {
    await requireReviewSets(store(null), deps);
    expect(readReviewSetRows).not.toHaveBeenCalled();
  });
});

describe('割り当ての読み取りと進捗素材', () => {
  test('Studies キャッシュを使い、有効セットがあるときだけ読んでキャッシュする', async () => {
    const result = store();
    expect(await reviewSetStudies(result, deps)).toEqual([]);
    result.setState({ reviewSets: { ...result.getState().reviewSets, sets: null } });
    expect(await reviewSetStudies(result, deps)).toEqual([]);
    expect(await reviewSetStudies(createStore(), deps)).toEqual([]);
    result.setState({ reviewSets: { ...result.getState().reviewSets, sets: [reviewSet()] } });
    expect(await reviewSetStudies(result, deps)).toEqual([study()]);
    expect(await reviewSetStudies(result, deps)).toEqual([study()]);
    expect(readStudies).toHaveBeenCalledTimes(1);
  });
  test('有効時だけ担当を絞り、owner の全件指定は保持する', () => {
    const result = activeStore();
    const all = result.getState().documents.studies!;
    const docs = result.getState().documents.records!;
    expect(
      filterReviewSetStudies(result, all, docs, 'b@example.com', true).map((s) => s.studyId),
    ).toEqual(['s1', 'cal']);
    expect(
      filterReviewSetStudies(result, all, docs, 'unknown', true).map((s) => s.studyId),
    ).toEqual(['cal']);
    expect(filterReviewSetStudies(result, all, docs, 'unknown', false)).toEqual(all);
  });
  test('アクティブな研究と最新の群構成を渡す', async () => {
    const result = activeStore();
    jest.mocked(listSchemaVersions).mockResolvedValue([
      {
        schemaVersion: 1,
        parentVersion: null,
        protocolVersion: 1,
        createdByType: 'user_edit',
        createdAt: 't0',
        createdBy: 'owner@example.com',
        note: null,
      },
    ]);
    jest.mocked(readAllArmStructures).mockResolvedValue(
      ['s1', 'cal'].flatMap((studyId) =>
        [1, 2].map((version) => ({
          studyId,
          version,
          armKey: 'arm:1',
          armName: `群${version}`,
          annotator: 'a@example.com',
          annotatorType: 'human_with_ai' as const,
          confirmedAt: 't0',
          note: null,
        })),
      ),
    );
    const resultMaterial = await readReviewSetProgressMaterials(result, deps);
    expect(resultMaterial.studies.map((s) => s.studyId)).toEqual(['s1', 'cal']);
    expect(resultMaterial.fields).toEqual([field()]);
    expect(resultMaterial.armStructures.get('s1')?.get('a@example.com')?.version).toBe(2);
    await expect(readReviewSetProgressMaterials(createStore(), deps)).rejects.toThrow('担当セット');
  });
});

describe('owner の操作', () => {
  test('全アクティブ研究を分割し、種と空の担当者を記録する', async () => {
    const result = store();
    jest
      .mocked(readStudies)
      .mockResolvedValue([
        study(),
        study({ studyId: 's2' }),
        study({ studyId: 'inactive', reviewSet: 'group-9' }),
      ]);
    jest.mocked(readDocuments).mockResolvedValue([doc(), doc('s2')]);
    const random = jest.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      await splitReviewSets(result, deps, { calibrationCount: 1, groupCount: 2 });
    } finally {
      random.mockRestore();
    }
    expect(updateStudyReviewSets).toHaveBeenCalledWith(
      'sid',
      expect.arrayContaining([
        { studyId: 's1', reviewSet: expect.any(String) },
        { studyId: 's2', reviewSet: expect.any(String) },
      ]),
      deps.google,
    );
    expect(jest.mocked(updateStudyReviewSets).mock.calls[0]?.[1]).toHaveLength(2);
    expect(appendReviewSetRows).toHaveBeenCalledWith(
      'sid',
      ['calibration', 'group-1', 'group-2'].map((setId) => ({
        setId,
        reviewerEmails: [],
        seed: '2147483648',
        studyIds: expect.any(Array),
        updatedBy: 'owner@example.com',
        updatedAt: 't9',
      })),
      deps.google,
    );
    expect(
      result.getState().documents.studies?.find((s) => s.studyId === 'inactive')?.reviewSet,
    ).toBe('group-9');
    expect(result.getState().reviewSets.saving).toBe(false);
  });
  test('再分割は確認を挟み、同じグループの担当者を保持する', async () => {
    const result = activeStore();
    await splitReviewSets(result, deps, { calibrationCount: 0, groupCount: 2 });
    expect(result.getState().reviewSets.confirmingResplit).toEqual({
      calibrationCount: 0,
      groupCount: 2,
    });
    expect(updateStudyReviewSets).not.toHaveBeenCalled();
    cancelResplit(result);
    expect(result.getState().reviewSets.confirmingResplit).toBeNull();
    await confirmResplit(result, deps);
    expect(updateStudyReviewSets).not.toHaveBeenCalled();
    await splitReviewSets(result, deps, { calibrationCount: 0, groupCount: 2 });
    await confirmResplit(result, deps);
    const rows = jest.mocked(appendReviewSetRows).mock.calls[0]?.[1];
    expect(rows?.find((r) => r.setId === 'group-1')?.reviewerEmails).toEqual([
      'a@example.com',
      'b@example.com',
    ]);
    expect(rows?.find((r) => r.setId === 'group-2')?.reviewerEmails).toEqual([]);
    expect(result.getState().reviewSets.confirmingResplit).toBeNull();
  });
  test('ロード前でも実データの割り当てを確認してから再分割を保留する', async () => {
    const result = store();
    result.setState({ reviewSets: { ...result.getState().reviewSets, sets: null } });
    jest.mocked(readReviewSetRows).mockResolvedValue([reviewSet()]);
    jest.mocked(readStudies).mockResolvedValue([study({ reviewSet: 'group-1' })]);
    await splitReviewSets(result, deps, { calibrationCount: 1, groupCount: 1 });
    expect(result.getState().reviewSets.confirmingResplit).not.toBeNull();
    expect(updateStudyReviewSets).not.toHaveBeenCalled();
  });
  test('メールをトリム・重複除去し、担当者編集行の seed は空にする', async () => {
    const result = activeStore();
    await saveReviewSetEmails(result, deps, 'group-1', [
      ' c@example.com ',
      'c@example.com',
      'd@example.com',
    ]);
    expect(appendReviewSetRows).toHaveBeenCalledWith(
      'sid',
      [
        {
          setId: 'group-1',
          reviewerEmails: ['c@example.com', 'd@example.com'],
          seed: null,
          studyIds: null,
          updatedBy: 'owner@example.com',
          updatedAt: 't9',
        },
      ],
      deps.google,
    );
    await saveReviewSetEmails(result, deps, 'group-1', []);
    expect(
      result.getState().reviewSets.sets?.find((s) => s.setId === 'group-1')?.reviewerEmails,
    ).toEqual([]);
  });
  test.each([[''], [' '], ['bad'], ['a@'], ['@b'], ['a@b c']])(
    '不正なメール %s を保存しない',
    async (emails) => {
      const result = activeStore();
      await saveReviewSetEmails(result, deps, 'group-1', [emails]);
      expect(appendReviewSetRows).not.toHaveBeenCalled();
      expect(result.getState().reviewSets.saveError).toContain('メール');
      expect(texts()).toContain('メール');
    },
  );
  test('不明なセット・研究は拒否する', async () => {
    const result = activeStore();
    await saveReviewSetEmails(result, deps, 'unknown', []);
    expect(result.getState().reviewSets.saveError).toContain('担当セット');
    await assignStudyReviewSet(result, deps, 's1', 'unknown');
    expect(result.getState().reviewSets.saveError).toContain('担当セット');
    await assignStudyReviewSet(result, deps, 'unknown', null);
    expect(result.getState().reviewSets.saveError).toContain('研究');
  });
  test('個別割り当てと解除は対象研究だけを更新し、キャッシュを破棄する', async () => {
    const result = activeStore();
    await assignStudyReviewSet(result, deps, 's1', 'calibration');
    expect(updateStudyReviewSets).toHaveBeenCalledWith(
      'sid',
      [{ studyId: 's1', reviewSet: 'calibration' }],
      deps.google,
    );
    expect(result.getState().documents.studies?.[0]?.reviewSet).toBe('calibration');
    await assignStudyReviewSet(result, deps, 's1', null);
    expect(result.getState().documents.studies?.[0]?.reviewSet).toBeNull();
    const uncached = store();
    await assignStudyReviewSet(uncached, deps, 's1', null);
    expect(readStudies).toHaveBeenCalled();
  });
  test('保存失敗・ログイン不明・ロード失敗・不正分割は saveError とトーストへ', async () => {
    const result = activeStore();
    jest.mocked(appendReviewSetRows).mockRejectedValueOnce('書込失敗');
    await saveReviewSetEmails(result, deps, 'group-1', []);
    expect(result.getState().reviewSets.saveError).toBe('書込失敗');
    expect(texts()).toContain('書込失敗');
    jest.mocked(getCurrentUserEmail).mockResolvedValueOnce(null);
    await assignStudyReviewSet(result, deps, 's1', null);
    expect(result.getState().reviewSets.saveError).toContain('ログイン');
    result.setState({
      reviewSets: { ...result.getState().reviewSets, sets: null, error: '読込失敗' },
    });
    await assignStudyReviewSet(result, deps, 's1', null);
    expect(result.getState().reviewSets.saveError).toBe('読込失敗');
    const fresh = store();
    await splitReviewSets(fresh, deps, { calibrationCount: -1, groupCount: 1 });
    expect(fresh.getState().reviewSets.saveError).toContain('キャリブレーション');
  });
  test('プロジェクトなし・owner 以外・保存中は何も書かない', async () => {
    for (const result of [createStore(), store('reviewer_with_ai'), store()]) {
      if (result.getState().role.role === 'owner')
        result.setState({ reviewSets: { ...result.getState().reviewSets, saving: true } });
      await splitReviewSets(result, deps, { calibrationCount: 0, groupCount: 1 });
      await saveReviewSetEmails(result, deps, 'group-1', []);
      await assignStudyReviewSet(result, deps, 's1', null);
    }
    expect(updateStudyReviewSets).not.toHaveBeenCalled();
  });
  test('現在時刻の既定と PDF 解放を使う', async () => {
    const result = activeStore();
    const disposePdf = jest.fn().mockResolvedValue(undefined);
    result.setState({
      adjudicate: {
        ...result.getState().adjudicate,
        working: { disposePdf } as unknown as NonNullable<
          ReturnType<typeof createInitialState>['adjudicate']['working']
        >,
      },
      verify: {
        ...result.getState().verify,
        verification: { disposePdf } as unknown as NonNullable<
          ReturnType<typeof createInitialState>['verify']['verification']
        >,
      },
    });
    await saveReviewSetEmails(result, { ...deps, now: undefined }, 'group-1', []);
    expect(jest.mocked(appendReviewSetRows).mock.calls[0]?.[1][0]?.updatedAt).toMatch(/^\d{4}-/);
    expect(disposePdf).toHaveBeenCalledTimes(2);
    expect(result.getState().adjudicate.working).toBeNull();
    await splitReviewSets(
      store(),
      { ...deps, now: undefined },
      { calibrationCount: 0, groupCount: 1 },
    );
  });
});

describe('Home と dashboard の担当進捗', () => {
  test('Home は本人と calibration だけの完了数を数える', async () => {
    const result = activeStore('reviewer_independent');
    jest.mocked(getCurrentUserEmail).mockResolvedValue('a@example.com');
    jest.mocked(listSchemaVersions).mockResolvedValue([
      {
        schemaVersion: 1,
        parentVersion: null,
        protocolVersion: 1,
        createdByType: 'user_edit',
        createdAt: 't0',
        createdBy: 'owner@example.com',
        note: null,
      },
    ]);
    jest
      .mocked(readAllDecisions)
      .mockResolvedValue([
        decision(),
        decision({ studyId: 'inactive' }),
        decision({ studyId: 'cal', annotator: 'b@example.com' }),
      ]);
    await loadAssignedProgress(result, deps);
    expect(result.getState().home.assignedProgress).toEqual({ done: 1, total: 2 });
    expect(result.getState().counts.dataRows).toBe(0);
    jest.mocked(getCurrentUserEmail).mockResolvedValue(null);
    await loadAssignedProgress(result, deps);
    expect(result.getState().home.assignedProgress).toEqual({ done: 0, total: 1 });
  });
  test('Home のガード・非有効化・ロード失敗', async () => {
    await loadAssignedProgress(createStore(), deps);
    await loadAssignedProgress(store(null), deps);
    await loadAssignedProgress(store(), deps);
    const busy = activeStore('adjudicator');
    busy.setState({ home: { ...busy.getState().home, assignedProgressLoading: true } });
    await loadAssignedProgress(busy, deps);
    const inactive = store('reviewer_with_ai');
    await loadAssignedProgress(inactive, deps);
    expect(inactive.getState().home.assignedProgress).toBeNull();
    const failed = store('reviewer_independent');
    failed.setState({
      reviewSets: { ...failed.getState().reviewSets, sets: null, error: '読込失敗' },
    });
    await loadAssignedProgress(failed, deps);
    expect(failed.getState().home.assignedProgressError).toBe('読込失敗');
    jest.mocked(readAllDecisions).mockRejectedValue('失敗');
    await loadAssignedProgress(activeStore('adjudicator'), deps);
  });
  test('dashboard はグループ担当者と calibration の human 判定者を列挙する', async () => {
    const result = activeStore();
    result.setState({ verify: { ...result.getState().verify, assignedOnly: true } });
    jest.mocked(listSchemaVersions).mockResolvedValue([
      {
        schemaVersion: 1,
        parentVersion: null,
        protocolVersion: 1,
        createdByType: 'user_edit',
        createdAt: 't0',
        createdBy: 'owner@example.com',
        note: null,
      },
    ]);
    jest.mocked(readAllDecisions).mockResolvedValue([
      decision(),
      decision({
        studyId: 'cal',
        annotator: 'c@example.com',
        annotatorType: 'human_independent',
      }),
      decision({ studyId: 'cal', annotator: 'ai', annotatorType: 'ai' }),
      decision({ studyId: 'cal', annotator: 'consensus', annotatorType: 'consensus' }),
    ]);
    await loadDashboard(result, deps);
    expect(readVerifyTargetMaterials).toHaveBeenCalledWith(result, deps, 'sid', {
      assignedOnly: false,
      force: undefined,
    });
    expect(
      result.getState().dashboard.reviewSetProgress?.map((p) => [p.email, p.setId, p.done]),
    ).toEqual([
      ['a@example.com', 'calibration', 0],
      ['a@example.com', 'group-1', 1],
      ['b@example.com', 'calibration', 0],
      ['b@example.com', 'group-1', 0],
      ['c@example.com', 'calibration', 1],
    ]);
    const emptyAssignments = activeStore();
    emptyAssignments.setState({
      documents: { ...emptyAssignments.getState().documents, studies: [study()] },
    });
    emptyAssignments.setState({ reviewSets: { ...emptyAssignments.getState().reviewSets, sets: [reviewSet({ studyIds: [] })] } });
    await loadDashboard(emptyAssignments, deps);
    expect(emptyAssignments.getState().dashboard.reviewSetProgress).toBeNull();
  });
});

test('進捗素材は未キャッシュの Documents を読み、読込中の owner は書き込まない', async () => {
  const result = store();
  result.setState({ reviewSets: { ...result.getState().reviewSets, sets: [reviewSet()] } });
  expect((await readReviewSetProgressMaterials(result, deps)).studies).toEqual([study()]);
  expect(readDocuments).toHaveBeenCalledTimes(1);
  result.setState({ reviewSets: { ...result.getState().reviewSets, sets: null, loading: true } });
  await assignStudyReviewSet(result, deps, 's1', null);
  expect(result.getState().reviewSets.saveError).toContain('担当セット');
  expect(updateStudyReviewSets).not.toHaveBeenCalled();
});
test('owner のセット読込失敗時は dashboard を従来の集計へ縮退する', async () => {
  const result = store();
  result.setState({ reviewSets: { ...result.getState().reviewSets, sets: null, error: '失敗' } });
  await loadDashboard(result, deps);
  expect(result.getState().dashboard.loadError).toBeNull();
  expect(result.getState().dashboard.reviewSetProgress).toBeNull();
});

describe('再読込と割当変更の防御', () => {
  test.each([null, '並行読込失敗'])(
    '絞り込み直前の未ロード・エラーでは非 owner の対象を出さない（%s）',
    (error) => {
      const result = activeStore('reviewer_with_ai');
      result.setState({
        reviewSets: {
          ...result.getState().reviewSets,
          sets: error === null ? null : result.getState().reviewSets.sets,
          error,
        },
      });
      expect(() => filterReviewSetStudies(result, [study()], [doc()], '', true)).toThrow(
        error ?? '担当セット',
      );
      expect(filterReviewSetStudies(result, [study()], [doc()], '', false)).toEqual([study()]);
      result.setState({ role: { ...result.getState().role, role: 'owner' } });
      expect(filterReviewSetStudies(result, [study()], [doc()], '', true)).toEqual([study()]);
    },
  );
  test.each([false, true])(
    'セット変更または成功した force は派生キャッシュを無効化する（force=%s）',
    async (force) => {
      const result = activeStore();
      const dispose = jest.fn();
      result.setState({
        home: { ...result.getState().home, assignedProgress: { done: 1, total: 2 } },
        verify: {
          ...result.getState().verify,
          selectedStudyId: 's1',
          verification: { disposePdf: dispose } as unknown as NonNullable<
            ReturnType<typeof result.getState>['verify']['verification']
          >,
        },
        dashboard: {
          ...result.getState().dashboard,
          reviewSetProgress: [{ email: 'a', setId: 'group-1', done: 1, total: 2 }],
        },
        adjudicate: {
          ...result.getState().adjudicate,
          rows: [],
          agreementOutsideCount: 2,
          calibrationAgreement: [],
        },
      });
      const old = result.getState().reviewSets.sets!;
      jest
        .mocked(readReviewSetRows)
        .mockResolvedValue(force ? old : [reviewSet({ reviewerEmails: ['new@example.com'] })]);
      if (!force) result.setState({ reviewSets: { ...result.getState().reviewSets, sets: null } });
      await loadReviewSets(result, deps, { force });
      expect(dispose).toHaveBeenCalledTimes(1);
      expect(result.getState().verify.selectedStudyId).toBeNull();
      expect(result.getState().home.assignedProgress).toBeNull();
      expect(result.getState().dashboard.reviewSetProgress).toBeNull();
      expect(result.getState().adjudicate.rows).toBeNull();
      expect(result.getState().adjudicate.calibrationAgreement).toBeNull();
      expect(result.getState().documents.studies).toBeNull();
    },
  );
  test('同じセットを自然再読込した場合は表示中のキャッシュを残す', async () => {
    const result = activeStore();
    result.setState({
      reviewSets: { ...result.getState().reviewSets, error: '前回失敗', sets: null },
    });
    jest.mocked(readReviewSetRows).mockResolvedValue([]);
    await loadReviewSets(result, deps);
    const progress = { done: 0, total: 1 };
    result.setState({ home: { ...result.getState().home, assignedProgress: progress } });
    await loadReviewSets(result, deps);
    expect(result.getState().home.assignedProgress).toBe(progress);
  });
  test('Studies の force はキャッシュとセット未使用状態を越えて実値を読む', async () => {
    const result = activeStore();
    const next = study({ studyId: 'new' });
    jest.mocked(readStudies).mockResolvedValue([next]);
    expect(await reviewSetStudies(result, deps, { force: true })).toEqual([next]);
    result.setState({ reviewSets: { ...result.getState().reviewSets, sets: [] } });
    const material = await readReviewSetProgressMaterials(result, deps, { force: true });
    expect(readDocuments).toHaveBeenCalled();
    expect(material.studies).toEqual([]);
  });
  test.each([false, true])(
    'Home は進捗素材の取得中のセット失敗でも全件を表示しない（null=%s）',
    async (missing) => {
      const result = activeStore('reviewer_with_ai');
      jest.mocked(readAllDecisions).mockImplementationOnce(async () => {
        result.setState({
          reviewSets: {
            ...result.getState().reviewSets,
            sets: missing ? null : result.getState().reviewSets.sets,
            error: '並行読込失敗',
          },
        });
        return [];
      });
      await loadAssignedProgress(result, deps);
      expect(result.getState().home.assignedProgress).toBeNull();
      expect(result.getState().home.assignedProgressError).toBe('並行読込失敗');
    },
  );
  test.each(['セット', '研究', '復旧読込'] as const)(
    '分割の %s 失敗後は両タブを読み直して保存エラーを残す',
    async (step) => {
      const result = store();
      const oldStudy = study();
      jest.mocked(readStudies).mockResolvedValue([oldStudy]);
      if (step === 'セット')
        jest.mocked(appendReviewSetRows).mockRejectedValueOnce(new Error('セット保存失敗'));
      else jest.mocked(updateStudyReviewSets).mockRejectedValueOnce(new Error('研究保存失敗'));
      if (step === '復旧読込')
        jest
          .mocked(readStudies)
          .mockResolvedValueOnce([oldStudy])
          .mockRejectedValueOnce(new Error('復旧読込失敗'));
      jest.mocked(readReviewSetRows).mockResolvedValue(step === 'セット' ? [] : [reviewSet()]);
      await splitReviewSets(result, deps, { calibrationCount: 0, groupCount: 1 });
      expect(readReviewSetRows).toHaveBeenCalledTimes(1);
      expect(readStudies).toHaveBeenCalledTimes(2);
      expect(result.getState().reviewSets.saveError).toBe(
        step === 'セット' ? 'セット保存失敗' : '研究保存失敗',
      );
      expect(result.getState().reviewSets.saving).toBe(false);
      if (step === 'セット') expect(updateStudyReviewSets).not.toHaveBeenCalled();
      else
        expect(jest.mocked(appendReviewSetRows).mock.invocationCallOrder[0]).toBeLessThan(
          jest.mocked(updateStudyReviewSets).mock.invocationCallOrder[0]!,
        );
      if (step === '復旧読込') expect(result.getState().documents.loadError).toBe('復旧読込失敗');
      else expect(result.getState().documents.studies).toEqual([oldStudy]);
    },
  );
  test('dashboard は登録のみの reviewer と adjudicator を校正の行へ含め、最新 revoked は含めない', async () => {
    const result = activeStore();
    jest.mocked(readReviewerAssignments).mockResolvedValue([
      {
        email: 'new@example.com',
        role: 'reviewer',
        reviewMode: 'independent',
        assignedBy: 'owner',
        assignedAt: 't0',
      },
      {
        email: 'judge@example.com',
        role: 'adjudicator',
        reviewMode: null,
        assignedBy: 'owner',
        assignedAt: 't0',
      },
      {
        email: 'revoked@example.com',
        role: 'reviewer',
        reviewMode: 'with_ai',
        assignedBy: 'owner',
        assignedAt: 't0',
      },
      {
        email: 'revoked@example.com',
        role: 'revoked',
        reviewMode: null,
        assignedBy: 'owner',
        assignedAt: 't1',
      },
    ]);
    await loadDashboard(result, deps);
    expect(result.getState().dashboard.reviewSetProgress).toEqual(
      expect.arrayContaining([
        { email: 'new@example.com', setId: 'calibration', done: 0, total: 1 },
        { email: 'judge@example.com', setId: 'calibration', done: 0, total: 1 },
      ]),
    );
    expect(
      result
        .getState()
        .dashboard.reviewSetProgress?.some((row) => row.email === 'revoked@example.com'),
    ).toBe(false);
  });
});

test('グループを減らした再分割は旧グループを退役させ、残す担当者の seed 履歴を保持する', async () => {
  const result = activeStore();
  result.setState({
    reviewSets: {
      ...result.getState().reviewSets,
      sets: [...result.getState().reviewSets.sets!, reviewSet({ setId: 'group-2', studyIds: [] })],
    },
  });
  await splitReviewSets(result, deps, { calibrationCount: 1, groupCount: 1 });
  await confirmResplit(result, deps);
  expect(
    currentReviewSets(result.getState().documents.studies!, result.getState().reviewSets.sets!).map(
      (set) => set.setId,
    ),
  ).toEqual(['calibration', 'group-1']);
  await saveReviewSetEmails(result, deps, 'group-1', ['new@example.com']);
  expect(
    currentReviewSets(result.getState().documents.studies!, result.getState().reviewSets.sets!).map(
      (set) => set.setId,
    ),
  ).toEqual(['calibration', 'group-1']);
  expect(
    result.getState().reviewSets.sets?.find((set) => set.setId === 'group-1')?.splitUpdatedAt,
  ).toBe('t9');
});

test('セットの再読込中に取得した新しい Studies は破棄しない', async () => {
  const result = activeStore();
  const fresh = [study({ studyId: 'new' })];
  jest.mocked(readReviewSetRows).mockImplementationOnce(async () => {
    result.setState({ documents: { ...result.getState().documents, studies: fresh } });
    return [reviewSet()];
  });
  await loadReviewSets(result, deps, { force: true });
  expect(result.getState().documents.studies).toBe(fresh);
});


test('個別移動・解除は移動元と移動先の所属全体を追記する', async () => {
  const result = activeStore();
  result.setState({ reviewSets: { ...result.getState().reviewSets, sets: [
    reviewSet({ studyIds: ['s1', 'keep'] }),
    reviewSet({ setId: 'calibration', studyIds: ['cal'], reviewerEmails: [] }),
    reviewSet({ setId: 'group-2', studyIds: null }),
  ] } });
  await assignStudyReviewSet(result, { ...deps, now: undefined }, 's1', 'group-2');
  expect(appendReviewSetRows).toHaveBeenLastCalledWith('sid', [
    expect.objectContaining({ setId: 'group-1', studyIds: ['keep'] }),
    expect.objectContaining({ setId: 'group-2', studyIds: ['s1'] }),
  ], deps.google);
  expect(jest.mocked(appendReviewSetRows).mock.calls[0]![1][0]!.updatedAt).toMatch(/^\d{4}-/);
  await assignStudyReviewSet(result, deps, 's1', null);
  expect(appendReviewSetRows).toHaveBeenLastCalledWith('sid', [expect.objectContaining({ setId: 'group-2', studyIds: [] })], deps.google);
  expect(result.getState().reviewSets.sets!.find((set) => set.setId === 'group-1')!.studyIds).toEqual(['keep']);
});

test('所属未取得の置換は行を作らず、非 owner の置換行は採用しない', async () => {
  const result = store();
  result.setState({ reviewSets: { ...result.getState().reviewSets, sets: null } });
  await replaceReviewSetStudies(result, deps, ['s1'], 'new', null, 'owner@example.com');
  expect(appendReviewSetRows).toHaveBeenLastCalledWith('sid', [], deps.google);
  result.setState({ reviewSets: { ...result.getState().reviewSets, sets: [reviewSet(), reviewSet({ setId: 'group-2', studyIds: null })] } });
  await replaceReviewSetStudies(result, deps, ['s1'], 'new', 'group-1', 'reviewer@example.com');
  expect(result.getState().reviewSets.sets![0]!.studyIds).toEqual(['s1']);
});

test('分け直しで旧セットを空にし、保存された所属だけで全研究の割当を再現できる', async () => {
  const result = activeStore();
  result.setState({ reviewSets: { ...result.getState().reviewSets, sets: [reviewSet({ setId: 'group-9', studyIds: ['s1', 'cal'] })] } });
  await splitReviewSets(result, deps, { calibrationCount: 1, groupCount: 1 });
  await confirmResplit(result, deps);
  const rows = jest.mocked(appendReviewSetRows).mock.calls[0]![1];
  expect(rows.find((row) => row.setId === 'group-9')!.studyIds).toEqual([]);
  const saved = new Map(rows.flatMap((row) => row.studyIds!.map((id) => [id, row.setId])));
  expect([...saved.keys()].sort()).toEqual(['cal', 's1']);
  expect(jest.mocked(updateStudyReviewSets).mock.calls[0]![1]).toEqual(expect.arrayContaining([...saved].map(([studyId, reviewSet]) => ({ studyId, reviewSet }))));
});
