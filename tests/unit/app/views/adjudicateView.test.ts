import { renderAdjudicateView } from '../../../../src/app/views/adjudicateView';
import { disposeAdjudicatePdfPaneCache } from '../../../../src/app/views/adjudicatePdfPane';
import {
  createInitialState,
  type AdjudicateStudyRow,
  type AdjudicateWorking,
  type AppState,
} from '../../../../src/app/store';
import type { AdjudicateViewCallbacks, ViewContext } from '../../../../src/app/views/types';
import type { AgreementReport } from '../../../../src/features/adjudication/agreement';
import type { AdjudicationCell } from '../../../../src/features/adjudication/cellMatch';
import type { Evidence } from '../../../../src/domain/evidence';
import type { SchemaField } from '../../../../src/domain/schemaField';
import type { StudyRecord } from '../../../../src/domain/study';

function makeCtx(): { ctx: ViewContext; callbacks: jest.Mocked<AdjudicateViewCallbacks> } {
  const callbacks: jest.Mocked<AdjudicateViewCallbacks> = {
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
        onTiabOpen: jest.fn(),
        onTiabClose: jest.fn(),
        onTiabPreview: jest.fn(),
        onTiabApply: jest.fn(),
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
        onToggleField: jest.fn(),
        onToggleFieldSection: jest.fn(),
        onToggleFieldSectionCollapse: jest.fn(),
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
        onToggleField: jest.fn(),
        onToggleFieldSection: jest.fn(),
        onToggleFieldSectionCollapse: jest.fn(),
        onRequestRun: jest.fn(),
        onConfirmRun: jest.fn(),
        onCancelConfirm: jest.fn(),
        onRetryStudy: jest.fn(),
        onReloadTargets: jest.fn(),
      },
      verify: {
        onSelectStudy: jest.fn(),
        onRetryLoad: jest.fn(),
        onDecision: jest.fn(),
        onArmConfirm: jest.fn(),
        onChangeLayoutMode: jest.fn(),
        onReloadVerification: jest.fn(),
        onRelocateQuote: jest.fn(),
      },
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
      adjudicate: callbacks,
    },
    callbacks,
  };
}

function makeStudy(overrides: Partial<StudyRecord> = {}): StudyRecord {
  return {
    studyId: 'study-1',
    studyLabel: 'Smith 2020',
    registrationId: null,
    createdAt: 't0',
    createdBy: 'owner@example.com',
    note: null,
    ...overrides,
  };
}

function makeField(overrides: Partial<SchemaField> = {}): SchemaField {
  return {
    schemaVersion: 1,
    fieldId: 'f-1',
    fieldIndex: 1,
    section: 'population',
    fieldName: 'sample_size',
    fieldLabel: '総サンプルサイズ',
    entityLevel: 'study',
    dataType: 'text',
    unit: null,
    allowedValues: null,
    required: false,
    extractionInstruction: '',
    example: null,
    aiGenerated: false,
    note: null,
    ...overrides,
  };
}

function makeCell(overrides: Partial<AdjudicationCell> = {}): AdjudicationCell {
  return {
    cellKey: JSON.stringify(['f-1', '-']),
    field: makeField(),
    entityKey: '-',
    valueA: '120',
    valueB: '130',
    schemaVersionA: 1,
    schemaVersionB: 1,
    matches: false,
    schemaVersionMismatch: false,
    noteA: null,
    noteB: null,
    ...overrides,
  };
}

function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    evidenceId: 'ev-1',
    runId: 'run-1',
    studyId: 'study-1',
    documentId: 'doc-1',
    fieldId: 'f-1',
    entityKey: '-',
    value: '120',
    notReported: false,
    quote: '合計 120 例',
    page: 1,
    confidence: 'high',
    anchorStatus: 'exact',
    bboxPage: null,
    bbox: null,
    relocatedFrom: null,
    ...overrides,
  };
}

function makeRow(overrides: Partial<AdjudicateStudyRow> = {}): AdjudicateStudyRow {
  return {
    study: makeStudy(),
    pair: { kind: 'ready', annotatorA: 'a@example.com', annotatorB: 'b@example.com' },
    gate: {
      progressA: { annotator: 'a@example.com', decided: 4, total: 4, complete: true },
      progressB: { annotator: 'b@example.com', decided: 4, total: 4, complete: true },
      ready: true,
    },
    ...overrides,
  };
}

function makeWorking(overrides: Partial<AdjudicateWorking> = {}): AdjudicateWorking {
  return {
    study: makeStudy(),
    documents: [],
    annotatorA: 'a@example.com',
    annotatorB: 'b@example.com',
    fields: [makeField()],
    schemaVersion: 1,
    armsA: [],
    armsB: [],
    needsArmConfirmation: false,
    armsMatched: true,
    consensusArmStructure: null,
    armDraft: [],
    cells: [makeCell()],
    consensusDecisions: [],
    evidence: [],
    skippedCellKeys: [],
    loadPdfView: jest.fn().mockResolvedValue({ pdf: null, pdfError: 'テストでは PDF なし', textPages: [] }),
    retryPdfView: jest.fn().mockResolvedValue({ pdf: null, pdfError: 'テストでは PDF なし', textPages: [] }),
    disposePdf: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeAgreementReport(overrides: Partial<AgreementReport> = {}): AgreementReport {
  return {
    studyCount: 1,
    fields: [
      {
        fieldId: 'f-1',
        fieldName: 'sample_size',
        fieldLabel: '総サンプルサイズ',
        pairCount: 10,
        agreementCount: 8,
        agreementRate: 0.8,
        kappa: 0.6,
      },
    ],
    overall: { pairCount: 10, agreementCount: 8, agreementRate: 0.8, kappa: 0.6 },
    disagreements: [
      {
        studyId: 'study-1',
        studyLabel: 'Smith 2020',
        entityKey: '-',
        fieldId: 'f-1',
        fieldLabel: '総サンプルサイズ',
        valueA: '120',
        valueB: '130',
      },
    ],
    ...overrides,
  };
}

function makeState(patch: Partial<AppState['adjudicate']> = {}): AppState {
  const state = createInitialState();
  state.currentProject = { projectId: 'p1', spreadsheetId: 's1', driveFolderId: 'f1', name: 'テスト SR' };
  state.adjudicate = { ...state.adjudicate, ...patch };
  return state;
}

function render(state: AppState, ctx: ViewContext): HTMLElement {
  const root = renderAdjudicateView(state, ctx);
  document.body.replaceChildren(root);
  return root;
}

afterEach(() => {
  disposeAdjudicatePdfPaneCache();
  document.body.replaceChildren();
});

describe('renderAdjudicateView: 読み込み系状態', () => {
  test('loadError は再試行ボタン付きで表示する', () => {
    const { ctx, callbacks } = makeCtx();
    const root = render(makeState({ loadError: 'boom' }), ctx);
    expect(root.querySelector('#adjudicate-error')?.textContent).toContain('boom');
    (root.querySelector('#adjudicate-retry') as HTMLButtonElement).click();
    expect(callbacks.onRetryLoad).toHaveBeenCalledTimes(1);
  });

  test('rows 未読込は読み込み中表示', () => {
    const { ctx } = makeCtx();
    const root = render(makeState({ rows: null }), ctx);
    expect(root.querySelector('#adjudicate-loading')).not.toBeNull();
  });

  test('rows 0 件は空状態メッセージ', () => {
    const { ctx } = makeCtx();
    const root = render(makeState({ rows: [] }), ctx);
    expect(root.querySelector('#adjudicate-empty')).not.toBeNull();
  });

  test('workingLoading 中は裁定データの読み込み中表示', () => {
    const { ctx } = makeCtx();
    const root = render(makeState({ rows: [makeRow()], workingLoading: true }), ctx);
    expect(root.querySelector('#adjudicate-working-loading')).not.toBeNull();
  });

  test('workingError（working=null）は一覧の上にエラーを出す', () => {
    const { ctx } = makeCtx();
    const root = render(makeState({ rows: [makeRow()], workingError: '対象外です' }), ctx);
    expect(root.querySelector('#adjudicate-working-error')?.textContent).toBe('対象外です');
    expect(root.querySelector('#adjudicate-list')).not.toBeNull();
  });
});

describe('renderAdjudicateView: study 一覧', () => {
  test('waiting / ambiguous / ready(未達) はディム表示され開始ボタンが無い', () => {
    const { ctx } = makeCtx();
    const rows: AdjudicateStudyRow[] = [
      makeRow({
        study: makeStudy({ studyId: 's-waiting', studyLabel: 'Waiting' }),
        pair: { kind: 'waiting', annotators: [] },
        gate: null,
      }),
      makeRow({
        study: makeStudy({ studyId: 's-ambiguous', studyLabel: 'Ambiguous' }),
        pair: { kind: 'ambiguous', annotators: ['a@example.com', 'b@example.com', 'c@example.com'] },
        gate: null,
      }),
      makeRow({
        study: makeStudy({ studyId: 's-notready', studyLabel: 'NotReady' }),
        gate: {
          progressA: { annotator: 'a@example.com', decided: 1, total: 4, complete: false },
          progressB: { annotator: 'b@example.com', decided: 4, total: 4, complete: true },
          ready: false,
        },
      }),
    ];
    const root = render(makeState({ rows }), ctx);
    const trs = root.querySelectorAll('#adjudicate-list tbody tr');
    expect(trs).toHaveLength(3);
    trs.forEach((tr) => {
      expect(tr.className).toContain('adjudicate__list-row--dimmed');
      expect(tr.querySelector('button')).toBeNull();
    });
    expect(root.textContent).toContain('両者の検証完了待ちです');
    expect(root.textContent).toContain('対象 annotator を特定できません');
    expect(root.textContent).toContain('1/4');
  });

  test('pair が ready でも gate が null（想定外の不整合）は状況欄を空にしてディム表示する（防御）', () => {
    const { ctx } = makeCtx();
    const root = render(makeState({ rows: [makeRow({ gate: null })] }), ctx);
    const tr = root.querySelector('#adjudicate-list tbody tr') as HTMLElement;
    expect(tr.className).toContain('adjudicate__list-row--dimmed');
    expect(tr.querySelectorAll('td')[1]?.textContent).toBe('');
  });

  test('ready な study は「裁定を開始」ボタンで onSelectStudy を呼ぶ', () => {
    const { ctx, callbacks } = makeCtx();
    const root = render(makeState({ rows: [makeRow()] }), ctx);
    const row = root.querySelector('[data-study-id="study-1"]') as HTMLElement;
    expect(row.className).not.toContain('dimmed');
    (row.querySelector('.adjudicate__open-button') as HTMLButtonElement).click();
    expect(callbacks.onSelectStudy).toHaveBeenCalledWith('study-1');
  });
});

describe('renderAdjudicateView: 裁定中（working）', () => {
  test('「一覧に戻る」で onBackToList を呼ぶ', () => {
    const { ctx, callbacks } = makeCtx();
    const root = render(makeState({ rows: [makeRow()], working: makeWorking() }), ctx);
    (root.querySelector('#adjudicate-back') as HTMLButtonElement).click();
    expect(callbacks.onBackToList).toHaveBeenCalledTimes(1);
  });

  test('needsArmConfirmation=false は群構成カードを出さない', () => {
    const { ctx } = makeCtx();
    const root = render(
      makeState({ rows: [makeRow()], working: makeWorking({ needsArmConfirmation: false }) }),
      ctx,
    );
    expect(root.querySelector('#adjudicate-arm-card')).toBeNull();
  });

  test('群構成が一致していれば「このまま採用」で onConfirmArms(armDraft) を呼ぶ', () => {
    const { ctx, callbacks } = makeCtx();
    const draft = [{ armKey: 'arm:1', armName: '介入群' }];
    const root = render(
      makeState({
        rows: [makeRow()],
        working: makeWorking({
          needsArmConfirmation: true,
          armsMatched: true,
          armsA: [{ armKey: 'arm:1', armName: '介入群' }],
          armsB: [{ armKey: 'arm:1', armName: '介入群' }],
          armDraft: draft,
        }),
      }),
      ctx,
    );
    expect(root.querySelector('#adjudicate-arm-card')).not.toBeNull();
    (root.querySelector('#adjudicate-arm-adopt') as HTMLButtonElement).click();
    expect(callbacks.onConfirmArms).toHaveBeenCalledWith(draft);
  });

  test('群構成が不一致なら編集フォームを出し、追加・削除・確定・編集が発火する', () => {
    const { ctx, callbacks } = makeCtx();
    const draft = [
      { armKey: 'arm:1', armName: '介入群' },
      { armKey: 'arm:2', armName: '対照群' },
    ];
    const root = render(
      makeState({
        rows: [makeRow()],
        working: makeWorking({
          needsArmConfirmation: true,
          armsMatched: false,
          armsA: [{ armKey: 'arm:1', armName: '介入群' }],
          armsB: [{ armKey: 'arm:1', armName: '対照群' }],
          armDraft: draft,
        }),
      }),
      ctx,
    );
    expect(root.textContent).toContain('一致しません');
    const inputs = root.querySelectorAll<HTMLInputElement>('.adjudicate__arm-draft-input');
    expect(inputs).toHaveLength(2);
    const firstInput = inputs[0] as HTMLInputElement;
    firstInput.value = '新名称';
    firstInput.dispatchEvent(new Event('change'));
    expect(callbacks.onArmDraftChange).toHaveBeenCalledWith(0, '新名称');

    (root.querySelector('#adjudicate-arm-add') as HTMLButtonElement).click();
    expect(callbacks.onArmDraftAdd).toHaveBeenCalledTimes(1);

    root.querySelectorAll<HTMLButtonElement>('.adjudicate__arm-draft-remove')[1]?.click();
    expect(callbacks.onArmDraftRemove).toHaveBeenCalledWith(1);

    (root.querySelector('#adjudicate-arm-confirm') as HTMLButtonElement).click();
    expect(callbacks.onConfirmArms).toHaveBeenCalledWith(draft);
  });

  test('群構成が確定済みなら確定済みカードを出す（編集 UI は出さない）', () => {
    const { ctx } = makeCtx();
    const root = render(
      makeState({
        rows: [makeRow()],
        working: makeWorking({
          needsArmConfirmation: true,
          consensusArmStructure: { version: 1, arms: [{ armKey: 'arm:1', armName: '介入群（確定）' }] },
        }),
      }),
      ctx,
    );
    expect(root.querySelector('#adjudicate-arm-card')?.textContent).toContain('介入群（確定）');
    expect(root.querySelector('.adjudicate__arm-draft')).toBeNull();
  });

  test('セル一覧: 一致・不一致件数のサマリを表示する', () => {
    const { ctx } = makeCtx();
    const cells = [makeCell({ matches: true }), makeCell({ cellKey: 'k2', matches: false })];
    const root = render(
      makeState({ rows: [makeRow()], working: makeWorking({ cells }), mismatchOnlyFilter: false }),
      ctx,
    );
    expect(root.querySelector('#adjudicate-summary')?.textContent).toBe('一致 1 件 / 不一致 1 件');
  });

  test('「不一致のみ」フィルタの切替が発火する', () => {
    const { ctx, callbacks } = makeCtx();
    const root = render(makeState({ rows: [makeRow()], working: makeWorking() }), ctx);
    const checkbox = root.querySelector('#adjudicate-filter-mismatch') as HTMLInputElement;
    expect(checkbox.checked).toBe(true); // 既定 ON
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));
    expect(callbacks.onToggleMismatchOnly).toHaveBeenCalledWith(false);
  });

  test('フィルタ ON で一致セルのみのときは「表示するセルがありません」', () => {
    const { ctx } = makeCtx();
    const root = render(
      makeState({
        rows: [makeRow()],
        working: makeWorking({ cells: [makeCell({ matches: true })] }),
        mismatchOnlyFilter: true,
      }),
      ctx,
    );
    expect(root.querySelector('#adjudicate-cells-empty')).not.toBeNull();
  });

  test('「一致セルを一括採用」で onAcceptAllMatches を呼ぶ', () => {
    const { ctx, callbacks } = makeCtx();
    const root = render(makeState({ rows: [makeRow()], working: makeWorking() }), ctx);
    (root.querySelector('#adjudicate-accept-all') as HTMLButtonElement).click();
    expect(callbacks.onAcceptAllMatches).toHaveBeenCalledTimes(1);
  });

  test('未裁定セルの行: A / B 採用・第 3 の値・not_reported・スキップが発火する', () => {
    const { ctx, callbacks } = makeCtx();
    const cell = makeCell();
    const root = render(
      makeState({ rows: [makeRow()], working: makeWorking({ cells: [cell] }), mismatchOnlyFilter: false }),
      ctx,
    );
    (root.querySelector('.adjudicate__action--choose-a') as HTMLButtonElement).click();
    expect(callbacks.onChooseA).toHaveBeenCalledWith(cell.cellKey);
    (root.querySelector('.adjudicate__action--choose-b') as HTMLButtonElement).click();
    expect(callbacks.onChooseB).toHaveBeenCalledWith(cell.cellKey);

    const input = root.querySelector('.adjudicate__custom-input') as HTMLInputElement;
    input.value = '第 3 の値';
    (root.querySelector('.adjudicate__action--custom') as HTMLButtonElement).click();
    expect(callbacks.onCustomValue).toHaveBeenCalledWith(cell.cellKey, '第 3 の値');

    (root.querySelector('.adjudicate__action--not-reported') as HTMLButtonElement).click();
    expect(callbacks.onNotReported).toHaveBeenCalledWith(cell.cellKey);

    (root.querySelector('.adjudicate__action--skip') as HTMLButtonElement).click();
    expect(callbacks.onSkip).toHaveBeenCalledWith(cell.cellKey);
  });

  test('schema_version 不一致セルはバッジを出す', () => {
    const { ctx } = makeCtx();
    const cell = makeCell({ schemaVersionMismatch: true });
    const root = render(
      makeState({ rows: [makeRow()], working: makeWorking({ cells: [cell] }), mismatchOnlyFilter: false }),
      ctx,
    );
    expect(root.querySelector('.adjudicate__badge--schema-mismatch')).not.toBeNull();
  });

  test('未入力（null）の値は「（未入力）」と表示する', () => {
    const { ctx } = makeCtx();
    const cell = makeCell({ valueA: null, valueB: null });
    const root = render(
      makeState({ rows: [makeRow()], working: makeWorking({ cells: [cell] }), mismatchOnlyFilter: false }),
      ctx,
    );
    const tds = root.querySelectorAll('#adjudicate-cells tbody td');
    expect(tds[2]?.textContent).toBe('（未入力）');
    expect(tds[3]?.textContent).toBe('（未入力）');
  });

  test('consensus 判定済みのセルは確定値 + 取り消しボタンを出す（undo）', () => {
    const { ctx, callbacks } = makeCtx();
    const cell = makeCell();
    const decision = {
      decidedAt: 't1',
      decidedBy: 'judge@example.com',
      studyId: 'study-1',
      fieldId: 'f-1',
      entityKey: '-',
      annotator: 'consensus' as const,
      annotatorType: 'consensus' as const,
      schemaVersion: 1,
      action: 'edit' as const,
      value: '120',
      note: null,
    };
    const root = render(
      makeState({
        rows: [makeRow()],
        working: makeWorking({ cells: [cell], consensusDecisions: [decision] }),
        mismatchOnlyFilter: false,
      }),
      ctx,
    );
    expect(root.textContent).toContain('確定値: 120');
    (root.querySelector('.adjudicate__action--undo') as HTMLButtonElement).click();
    expect(callbacks.onUndo).toHaveBeenCalledWith(cell.cellKey);
  });

  test('スキップ済みのセルは「スキップを取り消す」ボタンを出す', () => {
    const { ctx, callbacks } = makeCtx();
    const cell = makeCell();
    const root = render(
      makeState({
        rows: [makeRow()],
        working: makeWorking({ cells: [cell], skippedCellKeys: [cell.cellKey] }),
        mismatchOnlyFilter: false,
      }),
      ctx,
    );
    (root.querySelector('.adjudicate__action--unskip') as HTMLButtonElement).click();
    expect(callbacks.onUnskip).toHaveBeenCalledWith(cell.cellKey);
  });

  test('群構成未確定の arm / outcome_result セルは操作をロックする', () => {
    const { ctx } = makeCtx();
    const armCell = makeCell({
      cellKey: 'arm-cell',
      field: makeField({ fieldId: 'f-arm', entityLevel: 'arm' }),
      entityKey: 'arm:1',
    });
    const root = render(
      makeState({
        rows: [makeRow()],
        working: makeWorking({ needsArmConfirmation: true, consensusArmStructure: null, cells: [armCell] }),
        mismatchOnlyFilter: false,
      }),
      ctx,
    );
    expect(root.querySelector('.adjudicate__locked-note')?.textContent).toContain('群構成の確定が必要です');
    expect(root.querySelector('.adjudicate__action--choose-a')).toBeNull();
  });

  test('rob_domain セルは群構成未確定でもロックされない', () => {
    const { ctx } = makeCtx();
    const robCell = makeCell({
      cellKey: 'rob-cell',
      field: makeField({ fieldId: 'f-rob', entityLevel: 'rob_domain' }),
      entityKey: 'rob:d1',
    });
    const root = render(
      makeState({
        rows: [makeRow()],
        working: makeWorking({ needsArmConfirmation: true, consensusArmStructure: null, cells: [robCell] }),
        mismatchOnlyFilter: false,
      }),
      ctx,
    );
    expect(root.querySelector('.adjudicate__locked-note')).toBeNull();
    expect(root.querySelector('.adjudicate__action--choose-a')).not.toBeNull();
  });

  // --- issue #63: PDF ペインの Evidence ハイライト + Decisions.note 表示 ------------------

  test('AI 根拠（Evidence）があるセルには「根拠を表示」ボタンを出す', () => {
    const { ctx } = makeCtx();
    const cell = makeCell();
    const root = render(
      makeState({
        rows: [makeRow()],
        working: makeWorking({ cells: [cell], evidence: [makeEvidence()] }),
        mismatchOnlyFilter: false,
      }),
      ctx,
    );
    const button = root.querySelector<HTMLButtonElement>('.adjudicate__evidence-button');
    expect(button).not.toBeNull();
    expect(button?.getAttribute('aria-label')).toBe('総サンプルサイズ の AI 根拠を PDF で表示');
  });

  test('AI 根拠（Evidence）が無いセルには「根拠を表示」ボタンを出さない（human_independent 由来等）', () => {
    const { ctx } = makeCtx();
    const cell = makeCell();
    const root = render(
      makeState({
        rows: [makeRow()],
        working: makeWorking({ cells: [cell], evidence: [] }),
        mismatchOnlyFilter: false,
      }),
      ctx,
    );
    expect(root.querySelector('.adjudicate__evidence-button')).toBeNull();
  });

  test('「根拠を表示」クリックは例外を投げない（PDF ペインへの委譲。文書未読込でも安全）', () => {
    const { ctx } = makeCtx();
    const cell = makeCell();
    const root = render(
      makeState({
        rows: [makeRow()],
        working: makeWorking({ cells: [cell], evidence: [makeEvidence()] }),
        mismatchOnlyFilter: false,
      }),
      ctx,
    );
    const button = root.querySelector<HTMLButtonElement>('.adjudicate__evidence-button') as HTMLButtonElement;
    expect(() => button.click()).not.toThrow();
  });

  test('A / B の値に note があれば横に表示する（誰の note か分かる形で）', () => {
    const { ctx } = makeCtx();
    const cell = makeCell({ noteA: 'Table 2 を採用', noteB: null });
    const root = render(
      makeState({
        rows: [makeRow()],
        working: makeWorking({ cells: [cell] }),
        mismatchOnlyFilter: false,
      }),
      ctx,
    );
    const notes = root.querySelectorAll('.adjudicate__cell-note');
    expect(notes).toHaveLength(1);
    expect(notes[0]?.textContent).toBe('A のメモ: Table 2 を採用');
  });

  test('note が両側とも無ければ note 表示を出さない', () => {
    const { ctx } = makeCtx();
    const cell = makeCell({ noteA: null, noteB: null });
    const root = render(
      makeState({
        rows: [makeRow()],
        working: makeWorking({ cells: [cell] }),
        mismatchOnlyFilter: false,
      }),
      ctx,
    );
    expect(root.querySelector('.adjudicate__cell-note')).toBeNull();
  });

  test('オフラインキュー退避中（queuedWrites > 0）はバナーを表示する（issue #63）', () => {
    const { ctx } = makeCtx();
    const root = render(
      makeState({ rows: [makeRow()], working: makeWorking(), queuedWrites: 2 }),
      ctx,
    );
    expect(root.querySelector('#adjudicate-queued')?.textContent).toBe('オフライン: 2 件キュー中');
  });

  test('queuedWrites=0 のときはバナーを表示しない', () => {
    const { ctx } = makeCtx();
    const root = render(
      makeState({ rows: [makeRow()], working: makeWorking(), queuedWrites: 0 }),
      ctx,
    );
    expect(root.querySelector('#adjudicate-queued')).toBeNull();
  });
});

describe('renderAdjudicateView: レビュアー間一致度カード（issue #66）', () => {
  test('未計算: 説明文 + 「一致度を計算」ボタンを出し、クリックで onLoadAgreement を呼ぶ', () => {
    const { ctx, callbacks } = makeCtx();
    const root = render(makeState({ rows: [makeRow()] }), ctx);
    expect(root.querySelector('#adjudicate-agreement-card')).not.toBeNull();
    expect(root.querySelector('#agreement-load')).not.toBeNull();
    expect(root.querySelector('#agreement-table')).toBeNull();
    (root.querySelector('#agreement-load') as HTMLButtonElement).click();
    expect(callbacks.onLoadAgreement).toHaveBeenCalledTimes(1);
  });

  test('計算中: ローディング文言のみ表示しボタンは出さない', () => {
    const { ctx } = makeCtx();
    const root = render(makeState({ rows: [makeRow()], agreementLoading: true }), ctx);
    expect(root.querySelector('#agreement-loading')).not.toBeNull();
    expect(root.querySelector('#agreement-load')).toBeNull();
  });

  test('失敗: role="alert" のエラー文言 + 再試行用の「一致度を計算」ボタンを出す', () => {
    const { ctx, callbacks } = makeCtx();
    const root = render(makeState({ rows: [makeRow()], agreementError: 'network boom' }), ctx);
    const error = root.querySelector('#agreement-error');
    expect(error?.getAttribute('role')).toBe('alert');
    expect(error?.textContent).toContain('network boom');
    (root.querySelector('#agreement-load') as HTMLButtonElement).click();
    expect(callbacks.onLoadAgreement).toHaveBeenCalledTimes(1);
  });

  test('対象なし: 計算済み（studyCount=0）はエラー扱いにせず role="alert" を付けない', () => {
    const { ctx } = makeCtx();
    const emptyReport = makeAgreementReport({ studyCount: 0, fields: [], overall: { pairCount: 0, agreementCount: 0, agreementRate: null, kappa: null }, disagreements: [] });
    const root = render(makeState({ rows: [makeRow()], agreement: emptyReport }), ctx);
    const notice = root.querySelector('#agreement-error');
    expect(notice).not.toBeNull();
    expect(notice?.hasAttribute('role')).toBe(false);
    expect(root.querySelector('#agreement-table')).toBeNull();
  });

  test('表示: サマリ・項目別テーブル・不一致一覧・CSV ボタンを表示する', () => {
    const { ctx, callbacks } = makeCtx();
    const root = render(makeState({ rows: [makeRow()], agreement: makeAgreementReport() }), ctx);
    expect(root.querySelector('#agreement-summary-line')?.textContent).toBe(
      '対象研究 1 件・全体一致率 80.0%・全体 κ 0.60',
    );
    const fieldRow = root.querySelector('#agreement-table tbody tr');
    expect(fieldRow?.textContent).toContain('総サンプルサイズ');
    expect(fieldRow?.textContent).toContain('10');
    expect(fieldRow?.textContent).toContain('8 (80.0%)');
    expect(fieldRow?.textContent).toContain('0.60');

    const disagreementRow = root.querySelector('#agreement-disagreements tbody tr');
    expect(disagreementRow?.textContent).toContain('Smith 2020');
    expect(disagreementRow?.textContent).toContain('120');
    expect(disagreementRow?.textContent).toContain('130');

    (root.querySelector('#agreement-csv-summary') as HTMLButtonElement).click();
    expect(callbacks.onDownloadAgreementCsv).toHaveBeenCalledWith('summary');
    (root.querySelector('#agreement-csv-disagreements') as HTMLButtonElement).click();
    expect(callbacks.onDownloadAgreementCsv).toHaveBeenCalledWith('disagreements');
  });

  test('κ が null の項目は「—」表示（一致率が算出できる場合）', () => {
    const { ctx } = makeCtx();
    const report = makeAgreementReport({
      fields: [
        {
          fieldId: 'f-1',
          fieldName: 'sample_size',
          fieldLabel: '総サンプルサイズ',
          pairCount: 3,
          agreementCount: 3,
          agreementRate: 1,
          kappa: null,
        },
      ],
    });
    const root = render(makeState({ rows: [makeRow()], agreement: report }), ctx);
    const fieldRow = root.querySelector('#agreement-table tbody tr');
    expect(fieldRow?.textContent).toContain('—');
  });

  test('対象セル 0 件の項目は一致率・κ とも「—」表示', () => {
    const { ctx } = makeCtx();
    const report = makeAgreementReport({
      fields: [
        {
          fieldId: 'f-2',
          fieldName: 'unused',
          fieldLabel: '未使用項目',
          pairCount: 0,
          agreementCount: 0,
          agreementRate: null,
          kappa: null,
        },
      ],
    });
    const root = render(makeState({ rows: [makeRow()], agreement: report }), ctx);
    const fieldRow = root.querySelector('#agreement-table tbody tr');
    expect(fieldRow?.textContent).toContain('0 (—)');
    expect(fieldRow?.textContent).toContain('—');
  });

  test('不一致セルが 0 件のときは一覧の代わりに空メッセージを出す', () => {
    const { ctx } = makeCtx();
    const report = makeAgreementReport({ disagreements: [] });
    const root = render(makeState({ rows: [makeRow()], agreement: report }), ctx);
    expect(root.querySelector('#agreement-disagreements-empty')).not.toBeNull();
    expect(root.querySelector('#agreement-disagreements')).toBeNull();
  });

  test('未入力の値は「未入力」と表示する（A 側・B 側どちらも）', () => {
    const { ctx } = makeCtx();
    const report = makeAgreementReport({
      disagreements: [
        {
          studyId: 'study-1',
          studyLabel: 'Smith 2020',
          entityKey: 'arm:1',
          fieldId: 'f-arm',
          fieldLabel: '群名',
          valueA: null,
          valueB: '介入群',
        },
        {
          studyId: 'study-1',
          studyLabel: 'Smith 2020',
          entityKey: 'arm:2',
          fieldId: 'f-arm',
          fieldLabel: '群名',
          valueA: '対照群',
          valueB: null,
        },
      ],
    });
    const root = render(makeState({ rows: [makeRow()], agreement: report }), ctx);
    const rows = root.querySelectorAll('#agreement-disagreements tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('未入力');
    expect(rows[1]?.textContent).toContain('未入力');
  });
});
