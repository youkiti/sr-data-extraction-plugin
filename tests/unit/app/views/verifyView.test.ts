import { renderVerifyView } from '../../../../src/app/views/verifyView';
import { disposeVerificationPanelCache } from '../../../../src/app/views/verificationPanel';
import { createInitialState, type AppState, type VerifyTarget } from '../../../../src/app/store';
import type { ViewContext, VerifyViewCallbacks } from '../../../../src/app/views/types';
import type { DocumentRecord } from '../../../../src/domain/document';
import type { SchemaField } from '../../../../src/domain/schemaField';
import type { VerificationData } from '../../../../src/features/verification/types';

function makeCtx(): { ctx: ViewContext; callbacks: jest.Mocked<VerifyViewCallbacks> } {
  const callbacks = {
    onSelectDocument: jest.fn(),
    onRetryLoad: jest.fn(),
    onDecision: jest.fn(),
    onArmConfirm: jest.fn(),
  };
  return {
    ctx: {
      documents: { onImport: jest.fn(), onReload: jest.fn(), onSaveStudyLabel: jest.fn() },
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
        onToggleDocument: jest.fn(),
        onChangeModel: jest.fn(),
        onRun: jest.fn(),
        onSelectVerifyDocument: jest.fn(),
        onRetryVerifyLoad: jest.fn(),
        onDecision: jest.fn(),
        onArmConfirm: jest.fn(),
      },
      extract: {
        onToggleDocument: jest.fn(),
        onChangeModel: jest.fn(),
        onRequestRun: jest.fn(),
        onConfirmRun: jest.fn(),
        onCancelConfirm: jest.fn(),
        onRetryDocument: jest.fn(),
        onReloadTargets: jest.fn(),
      },
      verify: callbacks,
    },
    callbacks,
  };
}

function makeDocument(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    documentId: 'doc-1',
    studyLabel: 'Smith 2020',
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
    document: makeDocument(),
    evidence: [],
    fields: [makeField()],
    schemaVersion: 1,
    progress: { decided: 1, total: 4 },
    ...overrides,
  };
}

function makeVerification(): VerificationData {
  return {
    document: makeDocument(),
    fields: [makeField()],
    evidence: [],
    decisions: [],
    annotator: 'me@example.com',
    schemaVersion: 1,
    armStructure: null,
    pdf: null,
    pdfError: 'テストでは PDF なし',
    textPages: [],
  };
}

function makeState(patch: Partial<AppState['verify']> = {}): AppState {
  const state = createInitialState();
  state.currentProject = {
    projectId: 'p1',
    spreadsheetId: 's1',
    driveFolderId: 'f1',
    name: 'テスト SR',
  };
  state.verify = { ...state.verify, ...patch };
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
    expect(root.querySelector('#verify-doc')).toBeNull();
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

  test('抽出済み文献が 0 件なら空状態', () => {
    const { ctx } = makeCtx();
    const root = render(makeState({ targets: [] }), ctx);
    expect(root.querySelector('#verify-empty')?.textContent).toContain(
      'AI 抽出済みの文献がありません',
    );
  });

  test('通常: セレクタに進捗チップ付きの選択肢を出し、切替でコールバックを呼ぶ', () => {
    const { ctx, callbacks } = makeCtx();
    const targets = [
      makeTarget(),
      makeTarget({
        document: makeDocument({ documentId: 'doc-2', studyLabel: 'Jones 2021' }),
        progress: { decided: 0, total: 2 },
      }),
    ];
    const root = render(makeState({ targets, selectedDocumentId: 'doc-2' }), ctx);
    const select = root.querySelector('#verify-doc') as HTMLSelectElement;
    expect([...select.options].map((option) => option.textContent)).toEqual([
      'Smith 2020（判定済み 1 / 4）',
      'Jones 2021（判定済み 0 / 2）',
    ]);
    expect(select.value).toBe('doc-2');
    select.value = 'doc-1';
    select.dispatchEvent(new Event('change'));
    expect(callbacks.onSelectDocument).toHaveBeenCalledWith('doc-1');
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

  test('?doc= 不正などの verifyError はセレクタと併せて表示する', () => {
    const { ctx } = makeCtx();
    const root = render(
      makeState({ targets: [makeTarget()], verifyError: '文献 doc-9 が見つかりません' }),
      ctx,
    );
    expect(root.querySelector('#verify-doc')).not.toBeNull();
    expect(root.querySelector('#verify-error')?.textContent).toContain('doc-9');
  });

  test('検証データ読込済みなら 2 ペインパネルを埋め込み、判定がコールバックへ届く', () => {
    const { ctx, callbacks } = makeCtx();
    const verification = makeVerification();
    const root = render(
      makeState({
        targets: [makeTarget()],
        selectedDocumentId: 'doc-1',
        verification,
      }),
      ctx,
    );
    expect(root.querySelector('.verify__panes')).not.toBeNull();
    // 判定（Evidence なしセルの未報告）が onDecision へ委譲される
    (root.querySelector('.verify__action--not-reported') as HTMLButtonElement).click();
    expect(callbacks.onDecision).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'not_reported', documentId: 'doc-1' }),
    );
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
          documentId: 'doc-1',
          fieldId: 'f-arm-n',
          entityKey: 'arm:1',
          value: '50',
          notReported: false,
          quote: null,
          page: null,
          confidence: null,
          anchorStatus: null,
        },
      ],
    };
    const root = render(
      makeState({ targets: [makeTarget()], selectedDocumentId: 'doc-1', verification }),
      ctx,
    );
    const input = root.querySelector('.verify__arm-name') as HTMLInputElement;
    input.value = '介入群';
    input.dispatchEvent(new Event('change'));
    (root.querySelector('#verify-arm-confirm') as HTMLButtonElement).click();
    expect(callbacks.onArmConfirm).toHaveBeenCalledWith([{ armKey: 'arm:1', armName: '介入群' }]);
  });
});
