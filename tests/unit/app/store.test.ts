import { createInitialState, createStore } from '../../../src/app/store';

describe('createInitialState', () => {
  test('プロジェクト未選択・全カウント 0 で開始する', () => {
    expect(createInitialState()).toEqual({
      currentProject: null,
      counts: {
        documents: 0,
        protocolVersions: 0,
        schemaVersions: 0,
        pilotRuns: 0,
        evidenceRows: 0,
        dataRows: 0,
      },
    });
  });
});

describe('createStore', () => {
  test('setState で部分更新し、購読者へ通知する', () => {
    const store = createStore();
    const listener = jest.fn();
    store.subscribe(listener);

    const project = { spreadsheetId: 's1', name: 'P' };
    store.setState({ currentProject: project });

    expect(store.getState().currentProject).toEqual(project);
    expect(store.getState().counts.documents).toBe(0); // 他フィールドは維持
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(store.getState());
  });

  test('unsubscribe 後は通知されない', () => {
    const store = createStore();
    const listener = jest.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    store.setState({ currentProject: { spreadsheetId: 's1', name: 'P' } });
    expect(listener).not.toHaveBeenCalled();
  });

  test('初期状態を注入できる', () => {
    const initial = createInitialState();
    initial.counts.documents = 5;
    const store = createStore(initial);
    expect(store.getState().counts.documents).toBe(5);
  });
});
