import { renderPilotView } from '../../../../src/app/views/pilotView';
import { renderCachedVerificationPanel } from '../../../../src/app/views/verificationPanel';
import type { PilotViewCallbacks, ViewContext } from '../../../../src/app/views/types';
import { createInitialState, type AppState, type PilotState } from '../../../../src/app/store';
import type { DocumentRecord } from '../../../../src/domain/document';
import type { ExtractionRun } from '../../../../src/domain/extractionRun';
import type { SchemaField } from '../../../../src/domain/schemaField';
import type { StudyRecord } from '../../../../src/domain/study';
import { planRun } from '../../../../src/features/extraction/planRun';
import type { VerificationData } from '../../../../src/features/verification/types';

jest.mock('../../../../src/app/views/verificationPanel', () => ({
  renderCachedVerificationPanel: jest.fn(() => {
    const node = document.createElement('div');
    node.className = 'verify';
    return node;
  }),
}));
jest.mock('../../../../src/features/extraction/planRun', () => {
  const actual = jest.requireActual<typeof import('../../../../src/features/extraction/planRun')>(
    '../../../../src/features/extraction/planRun',
  );
  return { ...actual, planRun: jest.fn(actual.planRun) };
});

const renderPanelMock = renderCachedVerificationPanel as jest.MockedFunction<
  typeof renderCachedVerificationPanel
>;
const planRunMock = planRun as jest.MockedFunction<typeof planRun>;

function makeCtx(): { ctx: ViewContext; callbacks: jest.Mocked<PilotViewCallbacks> } {
  const callbacks = {
    onToggleStudy: jest.fn(),
    onChangeModel: jest.fn(),
    onRun: jest.fn(),
    onSelectRun: jest.fn(),
    onReloadHistory: jest.fn(),
    onSelectVerifyDocument: jest.fn(),
    onRetryVerifyLoad: jest.fn(),
    onDecision: jest.fn(),
    onArmConfirm: jest.fn(),
    onInstanceDeclare: jest.fn(),
  };
  return {
    ctx: {
      home: { onReload: jest.fn() },
      documents: {
        onImport: jest.fn(),
        onReload: jest.fn(),
        onSaveStudyLabel: jest.fn(),
        onSaveRegistrationId: jest.fn(),
        onSaveDocumentRole: jest.fn(),
        onToggleStudySelection: jest.fn(),
        onOpenMerge: jest.fn(),
        onOpenMergeCandidate: jest.fn(),
        onIgnoreCandidate: jest.fn(),
        onUpdateMergeLabel: jest.fn(),
        onUpdateMergeRegistration: jest.fn(),
        onConfirmMerge: jest.fn(),
        onCancelMerge: jest.fn(),
      },
      protocol: {
        onSubmit: jest.fn(),
        onStartEdit: jest.fn(),
        onCancelEdit: jest.fn(),
        onSelectVersion: jest.fn(),
        onReload: jest.fn(),
      },
      schema: {
        onReload: jest.fn(),
        onToggleSample: jest.fn(),
        onChangeModel: jest.fn(),
        onRunDraft: jest.fn(),
        onEditRow: jest.fn(),
        onAddRow: jest.fn(),
        onRemoveRow: jest.fn(),
        onInsertPreset: jest.fn(),
        onConfirm: jest.fn(),
        onCancelEditor: jest.fn(),
        onStartNewVersion: jest.fn(),
      },
      pilot: callbacks,
      extract: {
        onToggleStudy: jest.fn(),
        onChangeModel: jest.fn(),
        onRequestRun: jest.fn(),
        onConfirmRun: jest.fn(),
        onCancelConfirm: jest.fn(),
        onRetryStudy: jest.fn(),
        onReloadTargets: jest.fn(),
      },
      verify: {
        onSelectDocument: jest.fn(),
        onRetryLoad: jest.fn(),
        onDecision: jest.fn(),
        onArmConfirm: jest.fn(),
      },
      dashboard: { onReload: jest.fn() },
      export: {
        onSelectFormat: jest.fn(),
        onGenerate: jest.fn(),
        onConfirmGenerate: jest.fn(),
        onCancelGenerate: jest.fn(),
        onDownload: jest.fn(),
        onReload: jest.fn(),
      },
    },
    callbacks,
  };
}

function makeDocument(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    documentId: 'doc-1',
    studyId: 'study-1',
    documentRole: 'article',
    driveFileId: 'drive-1',
    sourceFileId: 'src-1',
    filename: 'smith2020.pdf',
    pmid: null,
    doi: null,
    textRef: 'ref',
    textStatus: 'ok',
    pageCount: 10,
    charCount: 30000,
    importedAt: 't0',
    importedBy: 'me',
    note: null,
    ...overrides,
  };
}

function makeField(overrides: Partial<SchemaField> = {}): SchemaField {
  return {
    schemaVersion: 1,
    fieldId: 'f-1',
    fieldIndex: 1,
    section: 'methods',
    fieldName: 'sample_size_total',
    fieldLabel: '総サンプルサイズ',
    entityLevel: 'study',
    dataType: 'integer',
    unit: null,
    allowedValues: null,
    required: true,
    extractionInstruction: '総 N を抽出',
    example: null,
    aiGenerated: false,
    note: null,
    ...overrides,
  };
}

function makeRun(overrides: Partial<ExtractionRun> = {}): ExtractionRun {
  return {
    runId: 'run-1',
    runType: 'pilot',
    schemaVersion: 1,
    studyIds: ['study-1'],
    provider: 'gemini',
    requestedModel: 'gemini-test',
    modelVersion: null,
    inputMode: 'text_only',
    status: 'done',
    startedAt: 't1',
    finishedAt: 't2',
    tokensIn: null,
    tokensOut: null,
    costEstimate: null,
    ...overrides,
  };
}

function makeStudy(studyId: string, label = `試験-${studyId}`): StudyRecord {
  return {
    studyId,
    studyLabel: label,
    registrationId: null,
    createdAt: 't0',
    createdBy: 'me',
    note: null,
  };
}

function studiesFor(documents: readonly DocumentRecord[]): StudyRecord[] {
  return [...new Set(documents.map((d) => d.studyId))].map((id) => makeStudy(id));
}

function makeState(options: {
  documents?: DocumentRecord[] | null;
  studies?: StudyRecord[] | null;
  documentsLoading?: boolean;
  documentsError?: string | null;
  fields?: SchemaField[] | null;
  pilot?: Partial<PilotState>;
} = {}): AppState {
  const state = createInitialState();
  state.currentProject = {
    projectId: 'p1',
    spreadsheetId: 's1',
    driveFolderId: 'f1',
    name: 'テスト SR',
  };
  const records = options.documents === undefined ? [makeDocument()] : options.documents;
  const studies =
    options.studies !== undefined
      ? options.studies
      : records === null
        ? null
        : studiesFor(records);
  state.documents = {
    ...state.documents,
    records,
    studies,
    loading: options.documentsLoading ?? false,
    loadError: options.documentsError ?? null,
  };
  state.schema = {
    ...state.schema,
    currentFields: options.fields === undefined ? [makeField()] : options.fields,
  };
  state.pilot = {
    ...state.pilot,
    selectedStudyIds: ['study-1'],
    model: 'gemini-test',
    ...(options.pilot ?? {}),
  };
  return state;
}

function render(state: AppState, ctxPair = makeCtx()) {
  const root = renderPilotView(state, ctxPair.ctx);
  document.body.replaceChildren(root);
  return { root, ...ctxPair };
}

describe('未実行（setup）', () => {
  test('文献一覧の読み込み中・失敗・空の状態表示', () => {
    const loading = render(makeState({ documents: null }));
    expect(loading.root.querySelector('#pilot-documents-loading')).not.toBeNull();

    const loadingFlag = render(makeState({ documentsLoading: true }));
    expect(loadingFlag.root.querySelector('#pilot-documents-loading')).not.toBeNull();

    const failed = render(makeState({ documentsError: '403' }));
    expect(failed.root.querySelector('#pilot-documents-error')?.textContent).toContain('403');

    const empty = render(makeState({ documents: [] }));
    expect(empty.root.querySelector('#pilot-documents-empty')).not.toBeNull();
  });

  test('study セレクタ: 選択状態・テキスト層なし study の無効化と注記・切替コールバック', () => {
    const { root, callbacks } = render(
      makeState({
        documents: [
          makeDocument({ documentId: 'doc-1', studyId: 'study-1' }),
          makeDocument({
            documentId: 'doc-2',
            studyId: 'study-2',
            filename: 'b.pdf',
            textStatus: 'no_text_layer',
          }),
        ],
      }),
    );
    const boxes = root.querySelectorAll<HTMLInputElement>('#pilot-documents input');
    expect(boxes[0]?.checked).toBe(true);
    expect(boxes[1]?.checked).toBe(false);
    expect(boxes[1]?.disabled).toBe(true);
    expect(root.querySelector('.pilot__doc-note')?.textContent).toContain('テキスト層のある文書がありません');
    boxes[0]!.checked = false;
    boxes[0]!.dispatchEvent(new Event('change'));
    expect(callbacks.onToggleStudy).toHaveBeenCalledWith('study-1', false);
  });

  test('モデル選択の変更と実行ボタン', () => {
    const { root, callbacks } = render(makeState());
    const model = root.querySelector<HTMLSelectElement>('#pilot-model');
    model!.value = 'gemini-2.0-flash';
    model!.dispatchEvent(new Event('change'));
    expect(callbacks.onChangeModel).toHaveBeenCalledWith('gemini-2.0-flash');
    root.querySelector<HTMLButtonElement>('#pilot-run')?.click();
    expect(callbacks.onRun).toHaveBeenCalled();
  });

  test('コスト概算: 未選択・スキーマ未読込では案内文', () => {
    const noSelection = render(makeState({ pilot: { selectedStudyIds: [] } }));
    expect(noSelection.root.querySelector('#pilot-estimate')?.textContent).toContain(
      '対象 study を選択すると表示されます',
    );
    const noFields = render(makeState({ fields: null }));
    expect(noFields.root.querySelector('#pilot-estimate')?.textContent).toContain(
      '対象 study を選択すると表示されます',
    );
    const emptyFields = render(makeState({ fields: [] }));
    expect(emptyFields.root.querySelector('#pilot-estimate')?.textContent).toContain(
      '対象 study を選択すると表示されます',
    );
  });

  test('コスト概算: 単価表にないモデルは「概算不可」+ トークン数を表示', () => {
    const { root } = render(makeState());
    const estimate = root.querySelector('#pilot-estimate');
    expect(estimate?.textContent).toContain('概算不可（単価表にないモデル）');
    expect(estimate?.textContent).toContain('1 バッチ');
    expect(estimate?.textContent).toContain('プロトコル本文ぶんは概算に含まれません');
  });

  test('コスト概算: 単価表にあるモデルは金額、warnings も表示', () => {
    const { root } = render(
      makeState({
        documents: [
          makeDocument({ documentId: 'doc-1', studyId: 'study-1' }),
          makeDocument({ documentId: 'doc-2', studyId: 'study-2', textStatus: 'no_text_layer' }),
        ],
        pilot: { selectedStudyIds: ['study-1', 'study-2'], model: 'gemini-2.5-pro' },
      }),
    );
    const estimate = root.querySelector('#pilot-estimate');
    expect(estimate?.textContent).toMatch(/コスト概算: \$\d/);
    expect(estimate?.textContent).toContain('注意:');
  });

  test('コスト概算: モデル未入力は unknown 扱いで計算する', () => {
    const { root } = render(makeState({ pilot: { model: '' } }));
    expect(root.querySelector('#pilot-estimate')?.textContent).toContain('概算不可');
  });

  test('コスト概算: planRun の失敗は文言に落とす（Error / 非 Error）', () => {
    planRunMock.mockImplementationOnce(() => {
      throw new Error('壊れた入力');
    });
    const first = render(makeState());
    expect(first.root.querySelector('#pilot-estimate')?.textContent).toContain(
      'コスト概算を計算できません: 壊れた入力',
    );
    planRunMock.mockImplementationOnce(() => {
      throw '文字列エラー';
    });
    const second = render(makeState());
    expect(second.root.querySelector('#pilot-estimate')?.textContent).toContain('文字列エラー');
  });

  test('実行エラーがあれば alert 文言を出す', () => {
    const { root } = render(makeState({ pilot: { runError: 'API キー未設定' } }));
    expect(root.querySelector('#pilot-run-error')?.textContent).toBe('API キー未設定');
  });
});

describe('実行中', () => {
  test('progress 未着は準備中、着信後はバッチ進捗（section あり / なし）', () => {
    const preparing = render(makeState({ pilot: { running: true, progress: null } }));
    expect(preparing.root.querySelector('.pilot__progress-text')?.textContent).toBe('実行準備中…');
    expect(preparing.root.querySelector('#pilot-run')).toBeNull(); // setup は出さない

    const noSection = render(
      makeState({
        pilot: {
          running: true,
          progress: { totalBatches: 4, completedBatches: 1, studyId: 'study-1', section: null, failure: null },
        },
      }),
    );
    // % を併記し、study は study_label で表示する（v0.10）
    expect(noSection.root.querySelector('.pilot__progress-text')?.textContent).toBe(
      '1 / 4 バッチ完了（25% / 直近: 試験-study-1）',
    );
    const bar = noSection.root.querySelector<HTMLProgressElement>('#pilot-progress');
    expect(bar?.max).toBe(4);
    expect(bar?.value).toBe(1);

    const withSection = render(
      makeState({
        pilot: {
          running: true,
          progress: {
            totalBatches: 4,
            completedBatches: 2,
            studyId: 'study-1',
            section: 'methods',
            failure: null,
          },
        },
      }),
    );
    expect(withSection.root.querySelector('.pilot__progress-text')?.textContent).toContain(
      '試験-study-1 / methods',
    );

    // Studies 未読込（null）+ 未知 study は id 表示 / 総バッチ数 0 は 0% 表示
    const unknownStudy = render(
      makeState({
        studies: null,
        pilot: {
          running: true,
          progress: { totalBatches: 0, completedBatches: 0, studyId: 'study-x', section: null, failure: null },
        },
      }),
    );
    expect(unknownStudy.root.querySelector('.pilot__progress-text')?.textContent).toBe(
      '0 / 0 バッチ完了（0% / 直近: study-x）',
    );
  });
});

describe('完了（サマリ + 埋め込み検証）', () => {
  function makeVerification(): VerificationData {
    return { document: makeDocument() } as unknown as VerificationData;
  }

  test('done は完了文言 + 再パイロット導線', () => {
    const { root } = render(makeState({ pilot: { run: makeRun() } }));
    expect(root.querySelector('#pilot-run-done')).not.toBeNull();
    expect(root.querySelector('#pilot-revise-schema')?.getAttribute('href')).toBe('#/schema');
  });

  test('partial_failure は失敗の内訳（破棄件数あり / なし）', () => {
    const failures = [
      { studyId: 'study-1', section: 'results', reason: 'api_error' as const, detail: '500' },
      { studyId: 'study-1', section: null, reason: 'format_error' as const, detail: 'JSON' },
    ];
    const withRejected = render(
      makeState({
        pilot: {
          run: makeRun({ status: 'partial_failure' }),
          batchFailures: failures,
          rejectedCount: 2,
        },
      }),
    );
    const items = withRejected.root.querySelectorAll('#pilot-partial-failure li');
    expect(items).toHaveLength(3);
    expect(items[0]?.textContent).toBe('試験-study-1 / results: api_error（500）');
    expect(items[1]?.textContent).toBe('試験-study-1: format_error（JSON）');
    expect(items[2]?.textContent).toBe('応答要素の破棄: 2 件');

    const noRejected = render(
      makeState({
        pilot: { run: makeRun({ status: 'partial_failure' }), batchFailures: failures },
      }),
    );
    expect(noRejected.root.querySelectorAll('#pilot-partial-failure li')).toHaveLength(2);
  });

  test('検証文献セレクタ: run.studyIds から records を引いてファイル名で列挙・切替', () => {
    const { root, callbacks } = render(
      makeState({
        documents: [
          makeDocument(),
          makeDocument({ documentId: 'doc-9', studyId: 'study-9', filename: 'jones2021.pdf' }),
        ],
        pilot: {
          run: makeRun({ studyIds: ['study-1', 'study-9'] }),
          verifyDocumentId: 'doc-1',
        },
      }),
    );
    const select = root.querySelector<HTMLSelectElement>('#pilot-verify-doc');
    const options = select?.querySelectorAll('option');
    // option text = doc.filename、value = document_id（study_label は Studies へ移設・v0.10）
    expect(options?.[0]?.textContent).toBe('smith2020.pdf');
    expect(options?.[1]?.textContent).toBe('jones2021.pdf');
    expect(select?.value).toBe('doc-1');
    select!.value = 'doc-9';
    select!.dispatchEvent(new Event('change'));
    expect(callbacks.onSelectVerifyDocument).toHaveBeenCalledWith('doc-9');
  });

  test('文献一覧が null ならセレクタは空（option なし）。verifyDocumentId 未設定でも安全', () => {
    const { root } = render(
      makeState({
        documents: null,
        pilot: { run: makeRun(), verifyDocumentId: null },
      }),
    );
    expect(root.querySelector('#pilot-verify-doc')).not.toBeNull();
    expect(root.querySelector('#pilot-verify-doc option')).toBeNull();
  });

  test('オフラインキュー件数のチップ', () => {
    const { root } = render(
      makeState({ pilot: { run: makeRun(), queuedDecisions: 3 } }),
    );
    expect(root.querySelector('#pilot-queued')?.textContent).toBe('オフライン: 3 件キュー中');
    const none = render(makeState({ pilot: { run: makeRun(), queuedDecisions: 0 } }));
    expect(none.root.querySelector('#pilot-queued')).toBeNull();
  });

  test('検証データの読み込み中・失敗（再試行）・成功（パネル埋め込み）', () => {
    const loading = render(makeState({ pilot: { run: makeRun(), verifyLoading: true } }));
    expect(loading.root.querySelector('#pilot-verify-loading')).not.toBeNull();

    const failed = render(
      makeState({ pilot: { run: makeRun(), verifyError: '読み込み失敗' } }),
    );
    expect(failed.root.querySelector('#pilot-verify-error')?.textContent).toContain('読み込み失敗');
    failed.root.querySelector<HTMLButtonElement>('#pilot-verify-retry')?.click();
    expect(failed.callbacks.onRetryVerifyLoad).toHaveBeenCalled();

    const verification = makeVerification();
    const ok = render(makeState({ pilot: { run: makeRun(), verification } }));
    expect(ok.root.querySelector('.verify')).not.toBeNull();
    const options = renderPanelMock.mock.calls[0]?.[0];
    expect(options?.data).toBe(verification);
    // onDecision は ctx.pilot.onDecision へ委譲される
    const decision = { fieldId: 'f-1' } as never;
    options?.onDecision(decision);
    expect(ok.callbacks.onDecision).toHaveBeenCalledWith(decision);
    const declarations = [{ fieldId: '__entity_instance__' }] as never;
    options?.onInstanceDeclare?.(declarations);
    expect(ok.callbacks.onInstanceDeclare).toHaveBeenCalledWith(declarations);
  });

  test('run が無ければサマリ・検証セクションは出さない', () => {
    const { root } = render(makeState());
    expect(root.querySelector('.pilot__summary')).toBeNull();
    expect(root.querySelector('.pilot__verify')).toBeNull();
  });

  test('partial_failure で内訳が空（履歴読込）なら案内文を 1 行出す', () => {
    const { root } = render(
      makeState({
        pilot: { run: makeRun({ status: 'partial_failure' }), batchFailures: [], rejectedCount: 0 },
      }),
    );
    const items = root.querySelectorAll('#pilot-partial-failure li');
    expect(items).toHaveLength(1);
    expect(items[0]?.textContent).toContain('失敗の内訳は保存されていません');
  });
});

describe('過去のパイロット結果（履歴）', () => {
  test('履歴未読込・空のときはセクションを出さない', () => {
    expect(render(makeState()).root.querySelector('.pilot__history')).toBeNull();
    const empty = render(makeState({ pilot: { history: [] } }));
    expect(empty.root.querySelector('.pilot__history')).toBeNull();
  });

  test('読み込み中の表示', () => {
    const { root } = render(makeState({ pilot: { historyLoading: true } }));
    expect(root.querySelector('#pilot-history-loading')).not.toBeNull();
  });

  test('読み込み失敗 + 再読み込みの配線', () => {
    const { root, callbacks } = render(makeState({ pilot: { historyError: '403' } }));
    expect(root.querySelector('#pilot-history-error')?.textContent).toContain('403');
    root.querySelector<HTMLButtonElement>('#pilot-history-reload')?.click();
    expect(callbacks.onReloadHistory).toHaveBeenCalled();
  });

  test('履歴一覧: 日時 / モデル / 試験数 / status ラベル + 選択の配線', () => {
    const { root, callbacks } = render(
      makeState({
        pilot: {
          history: [
            makeRun({
              runId: 'run-2',
              requestedModel: 'gemini-2.5-pro',
              studyIds: ['d1', 'd2'],
              finishedAt: 't-b',
              status: 'partial_failure',
            }),
            makeRun({ runId: 'run-1', finishedAt: null, startedAt: 't-a', status: 'done' }),
          ],
        },
      }),
    );
    const items = root.querySelectorAll('#pilot-history li');
    expect(items).toHaveLength(2);
    expect(items[0]?.querySelector('.pilot__history-when')?.textContent).toBe('t-b');
    expect(items[0]?.querySelector('.pilot__history-model')?.textContent).toBe('gemini-2.5-pro');
    expect(items[0]?.querySelector('.pilot__history-docs')?.textContent).toBe('2 試験');
    expect(items[0]?.querySelector('.pilot__history-status')?.textContent).toBe('一部失敗');
    // finished_at が無ければ started_at にフォールバック
    expect(items[1]?.querySelector('.pilot__history-when')?.textContent).toBe('t-a');
    expect(items[1]?.querySelector('.pilot__history-status')?.textContent).toBe('完了');

    root.querySelectorAll<HTMLButtonElement>('.pilot__history-open')[0]?.click();
    expect(callbacks.onSelectRun).toHaveBeenCalledWith('run-2');
  });

  test('日時が全く無い run は「(日時不明)」、未知 status はそのまま出す', () => {
    const { root } = render(
      makeState({
        pilot: {
          history: [makeRun({ startedAt: null, finishedAt: null, status: 'running' })],
        },
      }),
    );
    expect(root.querySelector('.pilot__history-when')?.textContent).toBe('(日時不明)');
    expect(root.querySelector('.pilot__history-status')?.textContent).toBe('running');
  });

  test('表示中の run は無効化 + 「表示中」+ aria-current', () => {
    const current = makeRun({ runId: 'run-1' });
    const { root } = render(makeState({ pilot: { history: [current], run: current } }));
    const item = root.querySelector('#pilot-history li');
    expect(item?.getAttribute('aria-current')).toBe('true');
    expect(item?.querySelector<HTMLButtonElement>('.pilot__history-open')?.disabled).toBe(true);
    expect(item?.querySelector('.pilot__history-current')?.textContent).toBe('表示中');
  });

  test('読み込み中は全項目を無効化し、対象行に「読み込み中…」を出す', () => {
    const { root } = render(
      makeState({
        pilot: {
          history: [makeRun({ runId: 'run-1' }), makeRun({ runId: 'run-2' })],
          loadingRunId: 'run-1',
        },
      }),
    );
    const buttons = root.querySelectorAll<HTMLButtonElement>('.pilot__history-open');
    expect(buttons[0]?.disabled).toBe(true);
    expect(buttons[1]?.disabled).toBe(true);
    expect(root.querySelector('.pilot__history-note')?.textContent).toBe('読み込み中…');
  });

  test('新規実行フォームは「新規パイロット」見出しで出す', () => {
    const { root } = render(makeState({ pilot: { history: [makeRun()] } }));
    const headings = Array.from(root.querySelectorAll('h3')).map((h) => h.textContent);
    expect(headings).toContain('過去のパイロット結果');
    expect(headings).toContain('新規パイロット');
    expect(root.querySelector('.pilot__setup')).not.toBeNull();
  });
});
