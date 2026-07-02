import { createInitialState, createStore } from '../../../src/app/store';

describe('createInitialState', () => {
  test('プロジェクト未選択・全カウント 0・documents / protocol 未読込で開始する', () => {
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
      documents: {
        records: null,
        loading: false,
        loadError: null,
        importing: false,
        importRows: [],
      },
      protocol: {
        records: null,
        loading: false,
        loadError: null,
        saving: false,
        saveError: null,
        editing: false,
        selectedVersion: null,
        draftText: '',
      },
      schema: {
        versions: null,
        currentFields: null,
        loading: false,
        loadError: null,
        drafting: false,
        draftElapsedSeconds: 0,
        draftError: null,
        selectedDocumentIds: [],
        model: '',
        editorRows: null,
        editorErrors: [],
        editorOrigin: 'user_edit',
        confirming: false,
      },
      pilot: {
        selectedDocumentIds: [],
        selectionInitialized: false,
        model: '',
        running: false,
        progress: null,
        runError: null,
        run: null,
        runFields: null,
        evidence: null,
        batchFailures: [],
        rejectedCount: 0,
        verifyDocumentId: null,
        verification: null,
        verifyLoading: false,
        verifyError: null,
        studyValues: null,
        queuedDecisions: 0,
      },
      extract: {
        selectedDocumentIds: [],
        selectionInitialized: false,
        model: '',
        extractedDocumentIds: null,
        loading: false,
        loadError: null,
        confirming: false,
        running: false,
        docRows: [],
        progress: null,
        runError: null,
        run: null,
        rejectedCount: 0,
        retryingDocumentId: null,
      },
      verify: {
        targets: null,
        loading: false,
        loadError: null,
        selectedDocumentId: null,
        deepLinkEntityKey: null,
        verification: null,
        verifyLoading: false,
        verifyError: null,
        studyValues: null,
        queuedDecisions: 0,
      },
      dashboard: {
        data: null,
        loading: false,
        loadError: null,
      },
    });
  });
});

describe('createStore', () => {
  test('setState で部分更新し、購読者へ通知する', () => {
    const store = createStore();
    const listener = jest.fn();
    store.subscribe(listener);

    const project = { projectId: 'p1', spreadsheetId: 's1', driveFolderId: 'f1', name: 'P' };
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
    store.setState({ currentProject: { projectId: 'p1', spreadsheetId: 's1', driveFolderId: 'f1', name: 'P' } });
    expect(listener).not.toHaveBeenCalled();
  });

  test('初期状態を注入できる', () => {
    const initial = createInitialState();
    initial.counts.documents = 5;
    const store = createStore(initial);
    expect(store.getState().counts.documents).toBe(5);
  });
});
