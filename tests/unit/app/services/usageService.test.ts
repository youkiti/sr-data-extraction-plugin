import {
  loadExtractBudget,
  loadUsage,
  saveBudget,
} from '../../../../src/app/services/usageService';
import {
  downloadUsageExport,
  generateUsageExport,
} from '../../../../src/app/services/usageExportService';
import type { ExportServiceDeps } from '../../../../src/app/services/exportService';
import { createInitialState, createStore } from '../../../../src/app/store';
import { readUsageRuns } from '../../../../src/features/extraction/runRepository';
import { appendExportLog } from '../../../../src/features/export/exportLogRepository';
import {
  readProjectBudget,
  saveProjectBudget,
  type ProjectBudget,
} from '../../../../src/features/project/projectBudget';
import { listSchemaVersions } from '../../../../src/features/schema/schemaRepository';
import { readLlmApiLogEntries } from '../../../../src/lib/llm/apiLogRepository';
import { ensureChildFolder, uploadTextFile } from '../../../../src/lib/google/drive';
import { getCurrentUserEmail } from '../../../../src/lib/google/identity';
import { downloadTextFile } from '../../../../src/app/ui/download';

jest.mock('../../../../src/features/extraction/runRepository');
jest.mock('../../../../src/features/export/exportLogRepository');
jest.mock('../../../../src/features/project/projectBudget');
jest.mock('../../../../src/features/schema/schemaRepository');
jest.mock('../../../../src/lib/llm/apiLogRepository');
jest.mock('../../../../src/lib/google/drive');
jest.mock('../../../../src/lib/google/identity');
jest.mock('../../../../src/app/ui/download');
jest.mock('../../../../src/utils/iso8601', () => ({ nowIso8601: () => '2026-08-10T00:00:00Z' }));
jest.mock('../../../../src/utils/uuid', () => ({ generateUuid: () => 'default-id' }));

const logs = jest.mocked(readLlmApiLogEntries);
const runs = jest.mocked(readUsageRuns);
const budget = jest.mocked(readProjectBudget);
const save = jest.mocked(saveProjectBudget);
const email = jest.mocked(getCurrentUserEmail);
const versions = jest.mocked(listSchemaVersions);
const upload = jest.mocked(uploadTextFile);
const append = jest.mocked(appendExportLog);

function setup() {
  const state = createInitialState();
  state.currentProject = {
    projectId: 'p',
    spreadsheetId: 'sheet',
    driveFolderId: 'folder',
    name: '費用テスト',
  };
  const deps: ExportServiceDeps = {
    google: { fetch: jest.fn(), getAccessToken: jest.fn() },
    profile: { getProfileUserInfo: jest.fn() },
  };
  return { state, store: createStore(state), deps };
}

describe('費用読込・予算保存・使用量出力', () => {
  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    return { promise, resolve, reject };
  }

  beforeEach(() => {
    jest.resetAllMocks();
    logs.mockResolvedValue([]);
    runs.mockResolvedValue([]);
    budget.mockResolvedValue({ budgetUsd: 5, updatedBy: 'owner', updatedAt: 't' });
    save.mockResolvedValue();
    email.mockResolvedValue('owner@example.com');
    versions.mockResolvedValue([]);
    jest.mocked(ensureChildFolder).mockResolvedValue({
      id: 'exports', webViewLink: 'https://drive.test/exports',
    });
    upload.mockResolvedValue({ id: 'csv', webViewLink: 'https://drive.test/csv' });
    append.mockResolvedValue();
  });

  test('進捗と独立して並行読込し、キャッシュと強制再読込を区別する', async () => {
    const { store, deps } = setup();
    await loadUsage(store, deps);
    expect(store.getState().dashboard.usage).toMatchObject({
      summary: { totals: { calls: 0, costUsd: 0 } },
      budget: { budgetUsd: 5 },
      loading: false,
    });
    await loadUsage(store, deps);
    expect(logs).toHaveBeenCalledTimes(1);
    await loadUsage(store, deps, { force: true });
    expect(logs).toHaveBeenCalledTimes(2);
  });

  test.each(['プロジェクトなし', 'reviewer', '読込中'])(
    '%s の読込は何もしない',
    async (condition) => {
      const { state, store, deps } = setup();
      if (condition === 'プロジェクトなし') store.setState({ currentProject: null });
      if (condition === 'reviewer') store.setState({ role: { ...state.role, role: 'reviewer_with_ai' } });
      if (condition === '読込中') {
        store.setState({
          dashboard: { ...state.dashboard, usage: { ...state.dashboard.usage, loading: true } },
        });
      }
      await loadUsage(store, deps);
      expect(logs).not.toHaveBeenCalled();
    },
  );

  test.each([new Error('読込失敗'), '読込失敗'])('読込例外を独立カードへ渡す: %s', async (err) => {
    const { store, deps } = setup();
    logs.mockRejectedValue(err);
    await loadUsage(store, deps);
    expect(store.getState().dashboard.usage.loadError).toBe('読込失敗');
    expect(store.getState().dashboard.usage.loading).toBe(false);
  });

  test('予算保存に更新者・注入時刻を記録し、保存後に再読込する', async () => {
    const { store, deps } = setup();
    store.setState({
      dashboard: {
        ...store.getState().dashboard,
        usage: { ...store.getState().dashboard.usage, budgetDraft: '10', budgetError: '前の失敗' },
      },
    });
    await saveBudget(store, { ...deps, now: () => '注入時刻' }, 10);
    expect(save).toHaveBeenCalledWith(
      'sheet',
      {
        budgetUsd: 10,
        updatedBy: 'owner@example.com',
        updatedAt: '注入時刻',
      },
      deps.google,
    );
    expect(budget).toHaveBeenCalled();
    expect(store.getState().dashboard.usage).toMatchObject({
      budgetSaving: false,
      budgetDraft: null,
      budgetError: null,
    });
  });

  test.each(['成功', '失敗'])(
    '読込中に予算を保存しても、古い読込の遅い%sで保存後の表示を上書きしない',
    async (outcome) => {
      const { store, deps } = setup();
      const oldBudget = deferred<ProjectBudget>();
      budget.mockImplementationOnce(() => oldBudget.promise);
      budget.mockResolvedValueOnce({ budgetUsd: 10, updatedBy: 'owner', updatedAt: 'new' });
      store.setState({
        dashboard: {
          ...store.getState().dashboard,
          usage: { ...store.getState().dashboard.usage, budgetDraft: '10' },
        },
      });
      const oldLoad = loadUsage(store, deps);
      expect(store.getState().dashboard.usage.loading).toBe(true);
      await saveBudget(store, deps, 10);
      expect(budget).toHaveBeenCalledTimes(2);
      expect(store.getState().dashboard.usage).toMatchObject({
        budget: { budgetUsd: 10 },
        budgetDraft: null,
        budgetSaving: false,
        loading: false,
        loadError: null,
      });
      if (outcome === '成功') {
        oldBudget.resolve({ budgetUsd: 5, updatedBy: 'owner', updatedAt: 'old' });
      } else {
        oldBudget.reject(new Error('古い読込の失敗'));
      }
      await oldLoad;
      expect(store.getState().dashboard.usage).toMatchObject({
        budget: { budgetUsd: 10 },
        budgetDraft: null,
        loading: false,
        loadError: null,
      });
    },
  );

  test('古い読込が先に終わっても、最新の強制読込の loading を解除しない', async () => {
    const { store, deps } = setup();
    const oldBudget = deferred<ProjectBudget>();
    const newBudget = deferred<ProjectBudget>();
    budget.mockImplementationOnce(() => oldBudget.promise);
    budget.mockImplementationOnce(() => newBudget.promise);
    const oldLoad = loadUsage(store, deps);
    const newLoad = loadUsage(store, deps, { force: true });
    oldBudget.resolve({ budgetUsd: 5, updatedBy: 'owner', updatedAt: 'old' });
    await oldLoad;
    expect(store.getState().dashboard.usage).toMatchObject({ budget: null, loading: true });
    newBudget.resolve({ budgetUsd: 10, updatedBy: 'owner', updatedAt: 'new' });
    await newLoad;
    expect(store.getState().dashboard.usage).toMatchObject({
      budget: { budgetUsd: 10 }, loading: false,
    });
  });

  test('予算解除も監査する。メール未取得時と既定時刻を扱う', async () => {
    const { store, deps } = setup();
    email.mockResolvedValue(null);
    await saveBudget(store, deps, null);
    expect(save).toHaveBeenCalledWith(
      'sheet',
      {
        budgetUsd: null,
        updatedBy: '',
        updatedAt: '2026-08-10T00:00:00Z',
      },
      deps.google,
    );
  });

  test.each(['プロジェクトなし', 'reviewer', '保存中'])(
    '%s では予算を保存しない',
    async (condition) => {
      const { state, store, deps } = setup();
      if (condition === 'プロジェクトなし') store.setState({ currentProject: null });
      if (condition === 'reviewer') store.setState({ role: { ...state.role, role: 'reviewer_with_ai' } });
      if (condition === '保存中') {
        store.setState({
          dashboard: {
            ...state.dashboard,
            usage: { ...state.dashboard.usage, budgetSaving: true },
          },
        });
      }
      await saveBudget(store, deps, 1);
      expect(save).not.toHaveBeenCalled();
    },
  );

  test.each([new Error('保存失敗'), '保存失敗'])('保存例外を表示できる: %s', async (err) => {
    const { store, deps } = setup();
    store.setState({
      dashboard: {
        ...store.getState().dashboard,
        usage: { ...store.getState().dashboard.usage, budgetDraft: '2' },
      },
    });
    save.mockRejectedValue(err);
    await saveBudget(store, deps, 2);
    expect(store.getState().dashboard.usage).toMatchObject({
      budgetError: '保存失敗',
      budgetSaving: false,
      budgetDraft: '2',
    });
  });

  test('抽出警告用に予算と全用途の累計を読み込み、失敗は非致命的に扱う', async () => {
    const { store, deps } = setup();
    await loadExtractBudget(store, deps);
    expect(store.getState().extract.budget).toEqual({
      budgetUsd: 5,
      spentUsd: 0,
      unknownPriceCalls: 0,
    });
    expect(runs).not.toHaveBeenCalled();
    budget.mockRejectedValue(new Error('読込失敗'));
    await loadExtractBudget(store, deps);
    expect(store.getState().extract.budget).toBeNull();
  });

  test('非 owner とプロジェクト未選択は警告用データも取得しない', async () => {
    const { state, store, deps } = setup();
    store.setState({ currentProject: null });
    await loadExtractBudget(store, deps);
    store.setState({
      currentProject: state.currentProject,
      role: { ...state.role, role: 'reviewer_with_ai' },
    });
    await loadExtractBudget(store, deps);
    expect(budget).not.toHaveBeenCalled();
  });

  test('スキーマ未確定でも usage CSV を保存し、形式と版 0 を監査する', async () => {
    const { store, deps } = setup();
    await generateUsageExport(store, deps);
    expect(upload).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'usage_20260810-000000.csv',
        parentId: 'exports',
        mimeType: 'text/csv',
        content: expect.stringContaining('level,'),
      }),
      deps.google,
    );
    expect(append).toHaveBeenCalledWith(
      'sheet',
      expect.objectContaining({
        exportId: 'default-id',
        format: 'usage',
        schemaVersion: 0,
        studyCount: 0,
        exportedBy: 'owner@example.com',
        exportedAt: '2026-08-10T00:00:00Z',
      }),
      deps.google,
    );
    expect(store.getState().export.confirmingWarning).toBe(false);
    expect(store.getState().export.usage?.result?.filename).toContain('usage_');
    downloadUsageExport(store);
    expect(downloadTextFile).toHaveBeenCalledWith(
      'usage_20260810-000000.csv',
      expect.stringContaining('level,'),
      'text/csv',
    );
    const download = jest.fn();
    downloadUsageExport(store, download);
    expect(download).toHaveBeenCalledTimes(1);
  });

  test('最新スキーマ版、注入時刻と ID、メール未取得を記録する', async () => {
    const { store, deps } = setup();
    versions.mockResolvedValue([
      {
        schemaVersion: 3,
        parentVersion: null,
        protocolVersion: 1,
        createdByType: 'user_edit',
        createdAt: 't',
        createdBy: 'owner',
        note: null,
      },
    ]);
    email.mockResolvedValue(null);
    await generateUsageExport(store, {
      ...deps,
      now: () => '2026-08-11T01:02:03Z',
      newUuid: () => 'injected-id',
    });
    expect(append).toHaveBeenCalledWith(
      'sheet',
      expect.objectContaining({
        schemaVersion: 3,
        exportId: 'injected-id',
        exportedBy: '',
      }),
      deps.google,
    );
  });

  test.each(['プロジェクトなし', 'reviewer', '生成中'])(
    '%s では使用量出力を生成しない',
    async (condition) => {
      const { state, store, deps } = setup();
      if (condition === 'プロジェクトなし') store.setState({ currentProject: null });
      if (condition === 'reviewer') store.setState({ role: { ...state.role, role: 'reviewer_with_ai' } });
      if (condition === '生成中') {
        store.setState({
          export: { ...state.export, usage: { generating: true, error: null, result: null } },
        });
      }
      await generateUsageExport(store, deps);
      expect(logs).not.toHaveBeenCalled();
    },
  );

  test.each([new Error('生成失敗'), '生成失敗'])(
    '使用量出力失敗をカードへ渡す: %s',
    async (err) => {
      const { store, deps } = setup();
      upload.mockRejectedValue(err);
      await generateUsageExport(store, deps);
      expect(store.getState().export.usage).toEqual({
        generating: false,
        error: '生成失敗',
        result: null,
      });
    },
  );

  test('未生成・結果なし・非 owner のローカル保存は何もしない', () => {
    const { state, store } = setup();
    downloadUsageExport(store);
    store.setState({
      export: { ...state.export, usage: { generating: false, error: null, result: null } },
    });
    downloadUsageExport(store);
    store.setState({ role: { ...state.role, role: 'reviewer_with_ai' } });
    downloadUsageExport(store);
    expect(downloadTextFile).not.toHaveBeenCalled();
  });
});
