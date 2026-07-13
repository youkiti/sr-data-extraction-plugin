import { rateText, renderDashboardView } from '../../../../src/app/views/dashboardView';
import { createInitialState, type AppState } from '../../../../src/app/store';
import type { DashboardViewCallbacks, ViewContext } from '../../../../src/app/views/types';
import type { DashboardData } from '../../../../src/features/verification/dashboard';

function makeCtx(): { ctx: ViewContext; callbacks: jest.Mocked<DashboardViewCallbacks> } {
  const callbacks = { onReload: jest.fn() };
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
        onUpdatePresetDialog: jest.fn(),
        onConfirmPresetDialog: jest.fn(),
        onSkipPresetDialog: jest.fn(),
        onCancelPresetDialog: jest.fn(),
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
      dashboard: callbacks,
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
        onSelectPair: jest.fn(),
        onArmMappingChange: jest.fn(),
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

function makeData(overrides: Partial<DashboardData> = {}): DashboardData {
  return {
    sections: ['methods', 'outcomes'],
    rows: [
      {
        studyId: 'study-1',
        studyLabel: 'Smith 2020',
        cells: [
          { section: 'methods', decided: 1, total: 2, entityKey: '-' },
          { section: 'outcomes', decided: 0, total: 3, entityKey: 'arm:1' },
        ],
        progress: { decided: 1, total: 5 },
        accuracy: { accept: 1, edit: 0, reject: 0, notReported: 0, decided: 1 },
        anchor: { numerator: 1, denominator: 4 },
        notReported: { numerator: 0, denominator: 5 },
      },
      {
        studyId: 'study 2', // URL エンコード確認用の空白入り ID
        studyLabel: 'Jones 2021',
        cells: [null, { section: 'outcomes', decided: 0, total: 0, entityKey: null }],
        progress: { decided: 0, total: 0 },
        accuracy: { accept: 0, edit: 0, reject: 0, notReported: 0, decided: 0 },
        anchor: { numerator: 0, denominator: 0 },
        notReported: { numerator: 0, denominator: 0 },
      },
    ],
    totals: {
      progress: { decided: 1, total: 5 },
      accuracy: { accept: 1, edit: 0, reject: 0, notReported: 0, decided: 1 },
      anchor: { numerator: 1, denominator: 4 },
      notReported: { numerator: 0, denominator: 5 },
    },
    ...overrides,
  };
}

function makeState(patch: Partial<AppState['dashboard']> = {}): AppState {
  const state = createInitialState();
  state.currentProject = {
    projectId: 'p1',
    spreadsheetId: 's1',
    driveFolderId: 'f1',
    name: 'テスト SR',
  };
  state.dashboard = { ...state.dashboard, ...patch };
  return state;
}

describe('rateText', () => {
  test('分母 0 は「—」、それ以外は n / m（%）', () => {
    expect(rateText({ numerator: 0, denominator: 0 })).toBe('—');
    expect(rateText({ numerator: 1, denominator: 4 })).toBe('1 / 4（25%）');
  });
});

describe('renderDashboardView', () => {
  test('読み込み中（data 未読込 / loading = true）は #dashboard-loading', () => {
    const { ctx } = makeCtx();
    const unloaded = renderDashboardView(makeState(), ctx);
    expect(unloaded.querySelector('#dashboard-loading')?.textContent).toContain(
      '進捗を読み込んでいます',
    );
    const loading = renderDashboardView(makeState({ data: makeData(), loading: true }), ctx);
    expect(loading.querySelector('#dashboard-loading')).not.toBeNull();
    expect(loading.querySelector('#dashboard-matrix')).toBeNull();
  });

  test('読み込み失敗は #dashboard-load-error + 再読み込み', () => {
    const { ctx, callbacks } = makeCtx();
    const root = renderDashboardView(makeState({ loadError: '権限がありません' }), ctx);
    const error = root.querySelector('#dashboard-load-error');
    expect(error?.getAttribute('role')).toBe('alert');
    expect(error?.textContent).toContain('権限がありません');
    (root.querySelector('#dashboard-reload') as HTMLButtonElement).click();
    expect(callbacks.onReload).toHaveBeenCalled();
  });

  test('0 件は #dashboard-empty + #/extract への導線', () => {
    const { ctx } = makeCtx();
    const root = renderDashboardView(
      makeState({ data: makeData({ rows: [], sections: [] }) }),
      ctx,
    );
    expect(root.querySelector('#dashboard-empty')?.textContent).toContain('まだ抽出がありません');
    expect(root.querySelector('#dashboard-empty a')?.getAttribute('href')).toBe('#/extract');
  });

  test('通常: サマリに検証進捗・anchor 失敗率・not_reported 率を出す', () => {
    const { ctx } = makeCtx();
    const root = renderDashboardView(makeState({ data: makeData() }), ctx);
    const summary = root.querySelector('#dashboard-summary');
    expect(summary?.textContent).toContain('検証進捗');
    expect(summary?.textContent).toContain('1 / 5（20%）');
    expect(summary?.textContent).toContain('AI 採用率（人が無修正で承認）');
    expect(summary?.textContent).toContain('1 / 1（100%）');
    expect(summary?.textContent).toContain('AI 精度内訳');
    expect(summary?.textContent).toContain('承認 1・修正 0・棄却 0・報告なし 0');
    expect(summary?.textContent).toContain('anchor 失敗率');
    expect(summary?.textContent).toContain('1 / 4（25%）');
    expect(summary?.textContent).toContain('not_reported 率');
    expect(summary?.textContent).toContain('0 / 5（0%）');
  });

  test('通常: マトリクスは行見出し = study_label、セル = ディープリンク付き判定数', () => {
    const { ctx } = makeCtx();
    const root = renderDashboardView(makeState({ data: makeData() }), ctx);
    const matrix = root.querySelector('#dashboard-matrix') as HTMLTableElement;
    const headers = [...matrix.querySelectorAll('thead th')].map((th) => th.textContent);
    expect(headers).toEqual([
      '研究',
      'methods',
      'outcomes',
      'AI 採用率',
      'anchor 失敗率',
      'not_reported 率',
    ]);

    const row1 = matrix.querySelectorAll('tbody tr')[0] as HTMLTableRowElement;
    expect(row1.querySelector('th')?.textContent).toBe('Smith 2020（1 / 5）');
    const links = [...row1.querySelectorAll('a')];
    expect(links.map((a) => a.textContent)).toEqual(['1 / 2', '0 / 3']);
    expect(links[0]?.getAttribute('href')).toBe('#/verify?study=study-1&entity=-');
    expect(links[1]?.getAttribute('href')).toBe('#/verify?study=study-1&entity=arm%3A1');
    expect(links[0]?.getAttribute('aria-label')).toBe(
      'Smith 2020 の methods を検証（判定済み 1 / 2）',
    );
    // AI 採用率セル = accept / decided、内訳を title に持つ
    const rateCells = [...row1.querySelectorAll('td.dashboard__rate')];
    expect(rateCells[0]?.textContent).toBe('1 / 1（100%）');
    expect(rateCells[0]?.getAttribute('title')).toBe('承認 1・修正 0・棄却 0・報告なし 0');
  });

  test('通常: スキーマに無い section とセル 0 件は「—」でリンクなし、率の分母 0 も「—」', () => {
    const { ctx } = makeCtx();
    const root = renderDashboardView(makeState({ data: makeData() }), ctx);
    const row2 = root.querySelectorAll('#dashboard-matrix tbody tr')[1] as HTMLTableRowElement;
    expect(row2.querySelectorAll('a')).toHaveLength(0);
    const cells = [...row2.querySelectorAll('td')].map((td) => td.textContent);
    // methods(—) / outcomes(—) / AI 採用率(—) / anchor(—) / not_reported(—)
    expect(cells).toEqual(['—', '—', '—', '—', '—']);
    // 空白入り document_id の行見出し（リンクは無いが表示は保つ）
    expect(row2.querySelector('th')?.textContent).toBe('Jones 2021（0 / 0）');
  });
});
