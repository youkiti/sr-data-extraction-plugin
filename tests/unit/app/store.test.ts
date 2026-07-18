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
      home: {
        countsLoaded: false,
        countsLoading: false,
        countsError: null,
      },
      role: {
        role: null,
        resolving: false,
        error: null,
        accessDenied: false,
        folderAccessGranted: false,
        folderAccessChecking: false,
        folderAccessError: null,
      },
      reviewers: {
        assignments: null,
        loading: false,
        loadError: null,
        saving: false,
        saveError: null,
        confirmingChange: null,
      },
      documents: {
        records: null,
        studies: null,
        extractedStudyIds: [],
        ignoredCandidateKeys: [],
        loading: false,
        loadError: null,
        importing: false,
        importRows: [],
        selectedStudyIds: [],
        mergeDialog: null,
        merging: false,
        mergeError: null,
        tiabImport: {
          open: false,
          sheetInput: '',
          loading: false,
          error: null,
          accessDenied: false,
          plan: null,
          applying: false,
          result: null,
        },
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
        presetDialog: null,
      },
      pilot: {
        selectedStudyIds: [],
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
        history: null,
        historyLoading: false,
        historyError: null,
        historyInitialized: false,
        loadingRunId: null,
        verifyStudyId: null,
        verification: null,
        verifyLoading: false,
        verifyError: null,
        studyValues: null,
        queuedDecisions: 0,
        layoutMode: 'focus',
        studyRowUpdatedAt: null,
        resultsRowUpdatedAt: {},
        conflictMessage: null,
        selectedFieldIds: null,
        collapsedFieldSections: [],
      },
      extract: {
        selectedStudyIds: [],
        selectionInitialized: false,
        model: '',
        extractedStudyIds: null,
        interruptedStudyIds: null,
        loading: false,
        loadError: null,
        confirming: false,
        running: false,
        studyRows: [],
        progress: null,
        runError: null,
        run: null,
        rejectedCount: 0,
        armWarnings: [],
        retryingStudyId: null,
        selectedFieldIds: null,
        collapsedFieldSections: [],
        lastRunFieldIds: null,
        fieldSubsetBadges: {},
      },
      verify: {
        targets: null,
        loading: false,
        loadError: null,
        selectedStudyId: null,
        deepLinkEntityKey: null,
        verification: null,
        verifyLoading: false,
        verifyError: null,
        studyValues: null,
        queuedDecisions: 0,
        layoutMode: 'focus',
        studyRowUpdatedAt: null,
        resultsRowUpdatedAt: {},
        conflictMessage: null,
      },
      dashboard: {
        data: null,
        loading: false,
        loadError: null,
      },
      adjudicate: {
        rows: null,
        loading: false,
        loadError: null,
        selectedStudyId: null,
        working: null,
        workingLoading: false,
        workingError: null,
        saving: false,
        queuedWrites: 0,
        mismatchOnlyFilter: true,
        pairSelections: {},
        agreement: null,
        agreementLoading: false,
        agreementError: null,
      },
      export: {
        format: 'study_wide',
        built: null,
        rSetMaterials: null,
        rSet: null,
        schemaVersion: null,
        loading: false,
        loadError: null,
        confirmingWarning: false,
        generating: false,
        generateError: null,
        result: null,
        rSetResult: null,
        methodsFacts: null,
        methodsLanguage: 'en',
        methodsWorkflow: 'single',
      },
      settingsReturnHash: null,
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
