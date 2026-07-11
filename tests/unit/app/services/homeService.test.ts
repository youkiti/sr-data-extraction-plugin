import { loadProgressCounts, type HomeServiceDeps } from '../../../../src/app/services/homeService';
import { createInitialState, createStore, type Store } from '../../../../src/app/store';
import { readProgressCounts } from '../../../../src/features/project/progressCounts';

jest.mock('../../../../src/features/project/progressCounts', () => ({
  readProgressCounts: jest.fn(),
}));

const readCountsMock = readProgressCounts as jest.MockedFunction<typeof readProgressCounts>;

const PROJECT = {
  projectId: 'p1',
  spreadsheetId: 'sheet-1',
  driveFolderId: 'folder-1',
  name: 'テスト SR',
};

const COUNTS = {
  documents: 3,
  protocolVersions: 1,
  schemaVersions: 2,
  pilotRuns: 1,
  evidenceRows: 10,
  dataRows: 7,
};

const deps: HomeServiceDeps = {
  google: { fetch: jest.fn(), getAccessToken: jest.fn() },
};

function makeStore(withProject = true): Store {
  const state = createInitialState();
  if (withProject) {
    state.currentProject = PROJECT;
  }
  return createStore(state);
}

beforeEach(() => {
  readCountsMock.mockReset();
});

describe('loadProgressCounts', () => {
  test('Sheets から読み込んで counts を差し替え、countsLoaded を立てる', async () => {
    readCountsMock.mockResolvedValue(COUNTS);
    const store = makeStore();
    await loadProgressCounts(store, deps);
    expect(readCountsMock).toHaveBeenCalledWith('sheet-1', deps.google);
    expect(store.getState().counts).toEqual(COUNTS);
    expect(store.getState().home).toEqual({
      countsLoaded: true,
      countsLoading: false,
      countsError: null,
    });
  });

  test('プロジェクト未選択なら何もしない', async () => {
    const store = makeStore(false);
    await loadProgressCounts(store, deps);
    expect(readCountsMock).not.toHaveBeenCalled();
  });

  test('reviewer 系ロールが解決済みなら何もしない（Decisions 総数等を見せない。design §3）', async () => {
    const store = makeStore();
    store.setState({ role: { ...store.getState().role, role: 'reviewer_with_ai' } });
    await loadProgressCounts(store, deps);
    expect(readCountsMock).not.toHaveBeenCalled();
  });

  test('ロール未解決（role=null）なら通常どおり読み込む（owner 相当の既定挙動）', async () => {
    readCountsMock.mockResolvedValue(COUNTS);
    const store = makeStore();
    await loadProgressCounts(store, deps);
    expect(readCountsMock).toHaveBeenCalled();
  });

  test('読込済みなら no-op、force で強制再取得する', async () => {
    readCountsMock.mockResolvedValue(COUNTS);
    const store = makeStore();
    store.setState({ home: { ...store.getState().home, countsLoaded: true } });
    await loadProgressCounts(store, deps);
    expect(readCountsMock).not.toHaveBeenCalled();

    await loadProgressCounts(store, deps, { force: true });
    expect(readCountsMock).toHaveBeenCalledTimes(1);
    expect(store.getState().counts).toEqual(COUNTS);
  });

  test('読込中の再入は no-op（二重読込しない）', async () => {
    let resolveRead: (counts: typeof COUNTS) => void = () => undefined;
    readCountsMock.mockImplementation(
      () => new Promise((resolve) => (resolveRead = resolve)),
    );
    const store = makeStore();
    const first = loadProgressCounts(store, deps);
    expect(store.getState().home.countsLoading).toBe(true);
    await loadProgressCounts(store, deps, { force: true });
    expect(readCountsMock).toHaveBeenCalledTimes(1);
    resolveRead(COUNTS);
    await first;
    expect(store.getState().home.countsLoading).toBe(false);
  });

  test('失敗時は countsError を出し、counts はシード値のまま', async () => {
    readCountsMock.mockRejectedValue(new Error('HTTP 403: 権限がありません'));
    const store = makeStore();
    await loadProgressCounts(store, deps);
    expect(store.getState().home).toEqual({
      countsLoaded: false,
      countsLoading: false,
      countsError: 'HTTP 403: 権限がありません',
    });
    expect(store.getState().counts.documents).toBe(0);

    // Error 以外の throw も文字列化する
    readCountsMock.mockRejectedValue('boom');
    await loadProgressCounts(store, deps);
    expect(store.getState().home.countsError).toBe('boom');
  });
});
