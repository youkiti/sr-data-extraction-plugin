import { renderVerifyView } from '../../../../src/app/views/verifyView';
import { disposeVerificationPanelCache } from '../../../../src/app/views/verificationPanel';
import { createInitialState, type AppState, type VerifyTarget } from '../../../../src/app/store';
import type { ViewContext, VerifyViewCallbacks } from '../../../../src/app/views/types';
import type { DocumentRecord } from '../../../../src/domain/document';
import type { SchemaField } from '../../../../src/domain/schemaField';
import type { StudyRecord } from '../../../../src/domain/study';
import type { VerificationData } from '../../../../src/features/verification/types';

function makeCtx(): { ctx: ViewContext; callbacks: jest.Mocked<VerifyViewCallbacks> } {
  const callbacks = {
    onSelectStudy: jest.fn(),
    onRetryLoad: jest.fn(),
    onDecision: jest.fn(),
    onArmConfirm: jest.fn(),
    onChangeLayoutMode: jest.fn(),
    onReloadVerification: jest.fn(),
    onRelocateQuote: jest.fn(),
    onInstanceDeclare: jest.fn(),
  };
  return {
    ctx: {
      home: {
    onReload: jest.fn(),
    onGrantFolderAccess: jest.fn(),
    onReloadReviewers: jest.fn(),
    onAddReviewer: jest.fn(),
    onConfirmReviewerChange: jest.fn(),
    onCancelReviewerChange: jest.fn(),
    onRevokeReviewer: jest.fn(),
    onCopyInvite: jest.fn(),
  },
      documents: {
        onImport: jest.fn(),
        onImportFiles: jest.fn(),
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
      pilot: {
        onToggleStudy: jest.fn(),
        onChangeModel: jest.fn(),
        onRun: jest.fn(),
        onSelectRun: jest.fn(),
        onReloadHistory: jest.fn(),
        onSelectVerifyStudy: jest.fn(),
        onRetryVerifyLoad: jest.fn(),
        onDecision: jest.fn(),
        onArmConfirm: jest.fn(),
        onChangeLayoutMode: jest.fn(),
        onReloadVerification: jest.fn(),
        onRelocateQuote: jest.fn(),
      },
      extract: {
        onToggleStudy: jest.fn(),
        onChangeModel: jest.fn(),
        onRequestRun: jest.fn(),
        onConfirmRun: jest.fn(),
        onCancelConfirm: jest.fn(),
        onRetryStudy: jest.fn(),
        onReloadTargets: jest.fn(),
      },
      verify: callbacks,
      dashboard: { onReload: jest.fn() },
      export: {
        onSelectFormat: jest.fn(),
        onGenerate: jest.fn(),
        onConfirmGenerate: jest.fn(),
        onCancelGenerate: jest.fn(),
        onDownload: jest.fn(),
        onReload: jest.fn(),
        onChangeMethodsLanguage: jest.fn(),
        onChangeMethodsWorkflow: jest.fn(),
        onCopyMethods: jest.fn(),
      },
      adjudicate: {
        onSelectStudy: jest.fn(),
        onBackToList: jest.fn(),
        onRetryLoad: jest.fn(),
        onArmDraftChange: jest.fn(),
        onArmDraftAdd: jest.fn(),
        onArmDraftRemove: jest.fn(),
        onConfirmArms: jest.fn(),
        onAcceptAllMatches: jest.fn(),
        onChooseA: jest.fn(),
        onChooseB: jest.fn(),
        onCustomValue: jest.fn(),
        onNotReported: jest.fn(),
        onSkip: jest.fn(),
        onUnskip: jest.fn(),
        onUndo: jest.fn(),
        onToggleMismatchOnly: jest.fn(),
        onLoadAgreement: jest.fn(),
        onDownloadAgreementCsv: jest.fn(),
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
    pageCount: 2,
    charCount: 1000,
    importedAt: 't0',
    importedBy: 'me@example.com',
    note: null,
    ...overrides,
  };
}

function makeStudy(overrides: Partial<StudyRecord> = {}): StudyRecord {
  return {
    studyId: 'study-1',
    studyLabel: 'Smith 2020',
    registrationId: null,
    createdAt: 't0',
    createdBy: 'me@example.com',
    note: null,
    ...overrides,
  };
}

function makeField(overrides: Partial<SchemaField> = {}): SchemaField {
  return {
    schemaVersion: 1,
    fieldId: 'f-total',
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

function makeTarget(overrides: Partial<VerifyTarget> = {}): VerifyTarget {
  return {
    study: makeStudy(),
    documents: [makeDocument()],
    evidence: [],
    fields: [makeField()],
    schemaVersion: 1,
    progress: { decided: 1, total: 4, byTab: [] },
    ...overrides,
  };
}

function makeVerification(): VerificationData {
  return {
    study: makeStudy(),
    documents: [{ document: makeDocument(), extractedPages: [], extractedTextError: null }],
    loadPdfView: async () => ({ pdf: null, pdfError: 'テストでは PDF なし', textPages: [] }),
    retryPdfView: async () => ({ pdf: null, pdfError: 'テストでは PDF なし', textPages: [] }),
    fields: [makeField()],
    evidence: [],
    decisions: [],
    annotator: 'me@example.com',
    annotatorType: 'human_with_ai',
    schemaVersion: 1,
    armStructure: null,
  };
}

function makeState(
  patch: Partial<AppState['verify']> = {},
  options: { role?: AppState['role']['role'] } = {},
): AppState {
  const state = createInitialState();
  state.currentProject = {
    projectId: 'p1',
    spreadsheetId: 's1',
    driveFolderId: 'f1',
    name: 'テスト SR',
  };
  state.verify = { ...state.verify, ...patch };
  if (options.role !== undefined) {
    state.role = { ...state.role, role: options.role };
  }
  return state;
}

function render(state: AppState, ctx: ViewContext): HTMLElement {
  const root = renderVerifyView(state, ctx);
  document.body.replaceChildren(root);
  return root;
}

afterEach(() => {
  disposeVerificationPanelCache();
  document.body.replaceChildren();
});

describe('renderVerifyView', () => {
  test('一覧読み込み中（targets 未読込）は #verify-loading', () => {
    const { ctx } = makeCtx();
    const root = render(makeState(), ctx);
    expect(root.querySelector('#verify-loading')?.textContent).toContain(
      '検証対象を読み込んでいます',
    );
  });

  test('loading = true でも読み込み中表示', () => {
    const { ctx } = makeCtx();
    const root = render(makeState({ targets: [makeTarget()], loading: true }), ctx);
    expect(root.querySelector('#verify-loading')).not.toBeNull();
    expect(root.querySelector('#verify-study')).toBeNull();
  });

  test('一覧読み込み失敗は #verify-error + 再試行', () => {
    const { ctx, callbacks } = makeCtx();
    const root = render(makeState({ loadError: '権限がありません' }), ctx);
    const error = root.querySelector('#verify-error');
    expect(error?.getAttribute('role')).toBe('alert');
    expect(error?.textContent).toContain('権限がありません');
    (root.querySelector('#verify-retry') as HTMLButtonElement).click();
    expect(callbacks.onRetryLoad).toHaveBeenCalled();
  });

  test('抽出済み研究が 0 件なら空状態', () => {
    const { ctx } = makeCtx();
    const root = render(makeState({ targets: [] }), ctx);
    expect(root.querySelector('#verify-empty')?.textContent).toContain(
      'AI 抽出済みの研究がありません',
    );
  });

  test('独立入力モード（reviewer_independent）: 対象 0 件は AI 抽出前提ではない空状態メッセージ', () => {
    const { ctx } = makeCtx();
    const root = render(
      makeState({ targets: [] }, { role: 'reviewer_independent' }),
      ctx,
    );
    expect(root.querySelector('#verify-empty')?.textContent).toContain(
      'オーナーが表のデザイン（スキーマ）を確定するまで',
    );
    expect(root.querySelector('#verify-empty')?.textContent).not.toContain('AI 抽出');
  });

  test('独立入力モード（reviewer_independent）: 冒頭の説明文が AI 抽出前提ではない文言になる', () => {
    const { ctx } = makeCtx();
    const root = render(makeState({}, { role: 'reviewer_independent' }), ctx);
    expect(root.querySelector('.view__lead')?.textContent).toContain('AI 抽出は行われません');
  });

  test('通常: セレクタに進捗チップ付きの選択肢を出し、切替でコールバックを呼ぶ', () => {
    const { ctx, callbacks } = makeCtx();
    const targets = [
      makeTarget(),
      makeTarget({
        study: makeStudy({ studyId: 'study-2', studyLabel: 'Jones 2021' }),
        documents: [makeDocument({ documentId: 'doc-2', studyId: 'study-2', filename: 'jones2021.pdf' })],
        progress: { decided: 0, total: 2, byTab: [] },
      }),
    ];
    const root = render(makeState({ targets, selectedStudyId: 'study-2' }), ctx);
    const select = root.querySelector('#verify-study') as HTMLSelectElement;
    // セレクタのラベルは study_label（Studies 由来・v0.10 フェーズ 3）
    expect([...select.options].map((option) => option.textContent)).toEqual([
      'Smith 2020（判定済み 1 / 4）',
      'Jones 2021（判定済み 0 / 2）',
    ]);
    expect(select.value).toBe('study-2');
    select.value = 'study-1';
    select.dispatchEvent(new Event('change'));
    expect(callbacks.onSelectStudy).toHaveBeenCalledWith('study-1');
  });

  test('検証データ読み込み中は #verify-doc-loading、オフラインキューは #verify-queued', () => {
    const { ctx } = makeCtx();
    const root = render(
      makeState({ targets: [makeTarget()], verifyLoading: true, queuedDecisions: 2 }),
      ctx,
    );
    expect(root.querySelector('#verify-doc-loading')).not.toBeNull();
    expect(root.querySelector('#verify-queued')?.textContent).toBe('オフライン: 2 件キュー中');
  });

  test('?study= 不正などの verifyError はセレクタと併せて表示する', () => {
    const { ctx } = makeCtx();
    const root = render(
      makeState({ targets: [makeTarget()], verifyError: 'study study-9 が見つかりません' }),
      ctx,
    );
    expect(root.querySelector('#verify-study')).not.toBeNull();
    expect(root.querySelector('#verify-error')?.textContent).toContain('study-9');
  });

  test('検証データ読込済みなら 2 ペインパネルを埋め込み、判定がコールバックへ届く', () => {
    const { ctx, callbacks } = makeCtx();
    const verification = makeVerification();
    const root = render(
      makeState({
        targets: [makeTarget()],
        selectedStudyId: 'study-1',
        verification,
      }),
      ctx,
    );
    expect(root.querySelector('.verify__panes')).not.toBeNull();
    // 判定（Evidence なしセルの未報告）が onDecision へ委譲される
    (root.querySelector('.verify__action--not-reported') as HTMLButtonElement).click();
    expect(callbacks.onDecision).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'not_reported', studyId: 'study-1' }),
    );
  });

  test('レイアウトモードは verify スライスからパネルへ渡り、トグルが onChangeLayoutMode へ委譲される（issue #38）', () => {
    const { ctx, callbacks } = makeCtx();
    const verification = makeVerification();
    const root = render(
      makeState({
        targets: [makeTarget()],
        selectedStudyId: 'study-1',
        verification,
        layoutMode: 'list',
      }),
      ctx,
    );
    const toggle = root.querySelector<HTMLButtonElement>('#verify-layout-toggle');
    expect(toggle?.textContent).toBe('フォーカス表示に切替'); // list スライス値がパネルへ渡っている
    toggle?.click();
    expect(callbacks.onChangeLayoutMode).toHaveBeenCalledWith('focus');
  });

  test('deepLinkEntityKey（?entity=）がパネルへ渡り、該当タブへ切替える', async () => {
    const { ctx } = makeCtx();
    const verification: VerificationData = {
      ...makeVerification(),
      fields: [
        makeField(),
        makeField({ fieldId: 'f-arm-n', fieldName: 'arm_n', entityLevel: 'arm' }),
      ],
      evidence: [
        {
          evidenceId: 'ev-arm',
          runId: 'run-1',
          studyId: 'study-1',
          documentId: 'doc-1',
          fieldId: 'f-arm-n',
          entityKey: 'arm:1',
          value: '50',
          notReported: false,
          quote: null,
          page: null,
          confidence: null,
          anchorStatus: null,
          bboxPage: null,
          bbox: null,
          relocatedFrom: null,
        },
      ],
      // ディープリンク先の arm タブが使えるよう群構成は確定済みにする
      armStructure: { version: 1, arms: [{ armKey: 'arm:1', armName: '介入群' }] },
    };
    const root = render(
      makeState({
        targets: [makeTarget()],
        selectedStudyId: 'study-1',
        verification,
        deepLinkEntityKey: 'arm:1',
      }),
      ctx,
    );
    await Promise.resolve(); // focusEntity は DOM 接続後の microtask で適用される
    expect(root.querySelector('.verify__tab--active')?.textContent).toBe('群（arm）');
  });

  test('群構成の確定が onArmConfirm へ委譲される', () => {
    const { ctx, callbacks } = makeCtx();
    const verification: VerificationData = {
      ...makeVerification(),
      fields: [
        makeField(),
        makeField({ fieldId: 'f-arm-n', fieldName: 'arm_n', entityLevel: 'arm' }),
      ],
      evidence: [
        {
          evidenceId: 'ev-arm',
          runId: 'run-1',
          studyId: 'study-1',
          documentId: 'doc-1',
          fieldId: 'f-arm-n',
          entityKey: 'arm:1',
          value: '50',
          notReported: false,
          quote: null,
          page: null,
          confidence: null,
          anchorStatus: null,
          bboxPage: null,
          bbox: null,
          relocatedFrom: null,
        },
      ],
    };
    const root = render(
      makeState({ targets: [makeTarget()], selectedStudyId: 'study-1', verification }),
      ctx,
    );
    const input = root.querySelector('.verify__arm-name') as HTMLInputElement;
    input.value = '介入群';
    input.dispatchEvent(new Event('change'));
    (root.querySelector('#verify-arm-confirm') as HTMLButtonElement).click();
    expect(callbacks.onArmConfirm).toHaveBeenCalledWith([{ armKey: 'arm:1', armName: '介入群' }]);
  });

  test('保存の競合検出バナー（issue #64）: conflictMessage 非 null で表示し、再読み込みが onReloadVerification へ委譲される', () => {
    const { ctx, callbacks } = makeCtx();
    const verification = makeVerification();
    const root = render(
      makeState({
        targets: [makeTarget()],
        selectedStudyId: 'study-1',
        verification,
        conflictMessage: '読み込み後に別の場所で更新されています。再読み込みしてから判定し直してください',
      }),
      ctx,
    );
    const banner = root.querySelector('#verify-conflict-warning');
    expect(banner?.getAttribute('role')).toBe('alert');
    expect(banner?.textContent).toContain('読み込み後に別の場所で更新されています');
    (root.querySelector('#verify-conflict-reload') as HTMLButtonElement).click();
    expect(callbacks.onReloadVerification).toHaveBeenCalledTimes(1);
  });

  test('conflictMessage が null ならバナーを表示しない', () => {
    const { ctx } = makeCtx();
    const verification = makeVerification();
    const root = render(
      makeState({ targets: [makeTarget()], selectedStudyId: 'study-1', verification }),
      ctx,
    );
    expect(root.querySelector('#verify-conflict-warning')).toBeNull();
  });

  test('アウトカム追加宣言が onInstanceDeclare へ委譲される', () => {
    const { ctx, callbacks } = makeCtx();
    const outcomeField = makeField({
      fieldId: 'f-out-event',
      fieldIndex: 2,
      section: 'outcomes',
      fieldName: 'event_count',
      fieldLabel: 'イベント数',
      entityLevel: 'outcome_result',
    });
    const verification: VerificationData = {
      ...makeVerification(),
      fields: [outcomeField],
      armStructure: { version: 1, arms: [{ armKey: 'arm:1', armName: '介入群' }] },
    };
    const root = render(
      makeState({ targets: [makeTarget()], selectedStudyId: 'study-1', verification }),
      ctx,
    );
    (root.querySelector('#verify-outcome-add-button') as HTMLButtonElement).click();
    expect(callbacks.onInstanceDeclare).toHaveBeenCalledWith([
      expect.objectContaining({
        fieldId: '__entity_instance__',
        entityKey: 'outcome:outcome_1|arm:1',
      }),
    ]);
  });
});
