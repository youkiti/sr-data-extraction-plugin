import { renderExportView } from '../../../../src/app/views/exportView';
import { createInitialState, type AppState, type ExportState } from '../../../../src/app/store';
import { setUiLanguage } from '../../../../src/lib/i18n';
import type { ExportViewCallbacks, ViewContext } from '../../../../src/app/views/types';
import type { BuiltExport, ClassicExportFormat } from '../../../../src/features/export/buildExport';
import { buildMethodsText } from '../../../../src/features/export/methodsBoilerplate';
import type { BuiltRSet, RSetFile } from '../../../../src/features/export/rset/buildRSet';

// 実装の文言は素通しする（他テストは実際の文案を検証したいため）。
// 「未反映プレースホルダが 0 件」という、正典の文案では実際には起こらない組み合わせだけ
// mockReturnValueOnce で差し替え、注意書き非表示の分岐（本来は将来の文案改訂向けの防御）を検証する
jest.mock('../../../../src/features/export/methodsBoilerplate', () => ({
  ...jest.requireActual('../../../../src/features/export/methodsBoilerplate'),
  buildMethodsText: jest.fn(
    jest.requireActual('../../../../src/features/export/methodsBoilerplate').buildMethodsText,
  ),
}));

const buildMethodsTextMock = buildMethodsText as jest.Mock;

function makeCtx(): { ctx: ViewContext; callbacks: jest.Mocked<ExportViewCallbacks> } {
  const callbacks = {
    onSelectFormat: jest.fn(),
    onGenerate: jest.fn(),
    onConfirmGenerate: jest.fn(),
    onCancelGenerate: jest.fn(),
    onDownload: jest.fn(),
    onReload: jest.fn(),
    onChangeMethodsLanguage: jest.fn(),
    onChangeMethodsWorkflow: jest.fn(),
    onCopyMethods: jest.fn(),
  };
  return {
    ctx: {
      home: {
    onReload: jest.fn(),
    onGrantFolderAccess: jest.fn(),
    onSkipMissingFiles: jest.fn(),
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
        onTiabGrantAccess: jest.fn(),
        onTiabHandoffImport: jest.fn(),
        onTiabHandoffDismiss: jest.fn(),
        onOpenExcludeStudy: jest.fn(),
        onOpenExcludeDocument: jest.fn(),
        onUpdateExclusionDialog: jest.fn(),
        onCancelExclusion: jest.fn(),
        onConfirmExclusion: jest.fn(),
        onRestoreStudy: jest.fn(),
        onRestoreDocument: jest.fn(),
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
        onToggleHighAccuracyImages: jest.fn(),
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
        onToggleHighAccuracyImages: jest.fn(),
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
      export: callbacks,
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

function makeBuilt(format: ClassicExportFormat, overrides: Partial<BuiltExport> = {}): BuiltExport {
  return {
    format,
    csv: 'csv',
    header: ['study_label', 'total_n'],
    previewRows: [['Smith 2020', '120']],
    rowCount: 1,
    studyCount: 1,
    unverifiedCellCount: 0,
    skippedStudyLabels: [],
    droppedRowCount: 0,
    ...overrides,
  };
}

function makeBuiltAll(
  overrides: Partial<Record<ClassicExportFormat, Partial<BuiltExport>>> = {},
): Record<ClassicExportFormat, BuiltExport> {
  return {
    study_wide: makeBuilt('study_wide', overrides.study_wide ?? {}),
    results_long: makeBuilt('results_long', {
      unverifiedCellCount: null,
      ...(overrides.results_long ?? {}),
    }),
    audit: makeBuilt('audit', overrides.audit ?? {}),
  };
}

/** R セットの 8 ファイルを最小構成で持つ fake（データ行 1 件・未検証 0 件が既定） */
function makeRSetFile(name: string, rowCount: number, content = 'a,b\r\n1,2\r\n'): RSetFile {
  return { name, content, rowCount };
}

function makeBuiltRSet(overrides: Partial<BuiltRSet> = {}): BuiltRSet {
  return {
    files: [
      makeRSetFile('tab1.csv', 1),
      makeRSetFile('tab1_status.csv', 1),
      makeRSetFile('ma.csv', 1, 'outcome_id,arm_id\r\nmortality,1\r\n'),
      makeRSetFile('ma_status.csv', 1),
      makeRSetFile('rob.csv', 0),
      makeRSetFile('data_dictionary.csv', 1),
      makeRSetFile('export_issues.csv', 0),
      makeRSetFile('export_manifest.json', 0, '{}\n'),
    ],
    issues: [],
    manifest: {
      export_format_version: '1.0',
      schema_version: 2,
      exported_at: '2026-07-03T09:00:00.000Z',
      app_version: '1.2.3',
      review_mode: 'single_with_ai',
      final_annotator_rule: 'consensus が 1 件ならそれ、なければ唯一の human 行',
      files: {},
      issues_summary: {},
    },
    ...overrides,
  };
}

function makeState(patch: Partial<ExportState> = {}): AppState {
  const state = createInitialState();
  state.export = { ...state.export, ...patch };
  return state;
}

describe('renderExportView', () => {
  test('読み込み中（未読込）は #export-loading を出す', () => {
    const { ctx } = makeCtx();
    const view = renderExportView(makeState(), ctx);
    expect(view.querySelector('#export-loading')?.textContent).toBe(
      'エクスポート素材を読み込んでいます…',
    );
    // built 済みでも loading 中は読み込み表示を維持する
    const reloading = renderExportView(makeState({ built: makeBuiltAll(), loading: true }), ctx);
    expect(reloading.querySelector('#export-loading')).not.toBeNull();
  });

  test('読み込み失敗は role=alert + 再読み込みボタン', () => {
    const { ctx, callbacks } = makeCtx();
    const view = renderExportView(makeState({ loadError: '権限がありません' }), ctx);
    const error = view.querySelector('#export-load-error');
    expect(error?.getAttribute('role')).toBe('alert');
    expect(error?.textContent).toContain('権限がありません');
    (view.querySelector('#export-reload') as HTMLButtonElement).click();
    expect(callbacks.onReload).toHaveBeenCalledTimes(1);
  });

  test('通常: 形式ラジオ + サマリ + プレビュー + 生成ボタンを出す', () => {
    const { ctx, callbacks } = makeCtx();
    const view = renderExportView(makeState({ built: makeBuiltAll() }), ctx);
    const radios = view.querySelectorAll<HTMLInputElement>('#export-format input[type=radio]');
    expect(radios).toHaveLength(4); // study_wide / results_long / audit / r_set（issue #60）
    expect(radios[0]?.checked).toBe(true); // 既定 = study_wide

    const summary = view.querySelector('#export-summary');
    expect(summary?.textContent).toContain('データ行数');
    expect(summary?.textContent).toContain('対象 study 数');
    expect(summary?.textContent).toContain('未検証セル数');

    const preview = view.querySelector('#export-preview');
    expect(preview?.querySelectorAll('th')).toHaveLength(2);
    expect(preview?.querySelector('tbody')?.textContent).toContain('Smith 2020');
    expect(view.querySelector('#export-preview-more')).toBeNull(); // 全行表示済み

    const generate = view.querySelector('#export-generate') as HTMLButtonElement;
    expect(generate.disabled).toBe(false);
    generate.click();
    expect(callbacks.onGenerate).toHaveBeenCalledTimes(1);

    // ラジオ切替でコールバック
    (radios[2] as HTMLInputElement).checked = true;
    radios[2]?.dispatchEvent(new Event('change'));
    expect(callbacks.onSelectFormat).toHaveBeenCalledWith('audit');

    (radios[3] as HTMLInputElement).checked = true;
    radios[3]?.dispatchEvent(new Event('change'));
    expect(callbacks.onSelectFormat).toHaveBeenCalledWith('r_set');
  });

  test('results_long の未検証セル数は「—」で出す', () => {
    const { ctx } = makeCtx();
    const view = renderExportView(makeState({ built: makeBuiltAll(), format: 'results_long' }), ctx);
    const summary = view.querySelector('#export-summary');
    expect(summary?.textContent).toContain('—');
  });

  test('除外警告: skipped 文献の列挙と dropped 行数（0 件は非表示）', () => {
    const { ctx } = makeCtx();
    const clean = renderExportView(makeState({ built: makeBuiltAll() }), ctx);
    expect(clean.querySelector('#export-skipped')).toBeNull();
    expect(clean.querySelector('#export-dropped')).toBeNull();

    const view = renderExportView(
      makeState({
        built: makeBuiltAll({
          study_wide: { skippedStudyLabels: ['Doe 2019'], droppedRowCount: 2 },
        }),
      }),
      ctx,
    );
    expect(view.querySelector('#export-skipped')?.textContent).toContain('Doe 2019');
    expect(view.querySelector('#export-dropped')?.textContent).toContain('2 行');
  });

  test('プレビューが全行に満たないときは「…他 n 行」を出す', () => {
    const { ctx } = makeCtx();
    const view = renderExportView(
      makeState({ built: makeBuiltAll({ study_wide: { rowCount: 25 } }) }),
      ctx,
    );
    expect(view.querySelector('#export-preview-more')?.textContent).toBe('…他 24 行');
    expect(view.querySelector('.export__preview-caption')?.textContent).toContain('全 25 行');
  });

  test('データ行 0 件は生成ボタン無効 + 案内文', () => {
    const { ctx } = makeCtx();
    const view = renderExportView(
      makeState({ built: makeBuiltAll({ study_wide: { rowCount: 0, previewRows: [] } }) }),
      ctx,
    );
    expect((view.querySelector('#export-generate') as HTMLButtonElement).disabled).toBe(true);
    expect(view.querySelector('.export__empty-note')?.textContent).toBe(
      'この形式で出力できるデータ行がありません。',
    );
  });

  test('警告ダイアログ: role=alertdialog + 続行 / 中止コールバック', () => {
    const { ctx, callbacks } = makeCtx();
    const view = renderExportView(
      makeState({
        built: makeBuiltAll({ study_wide: { unverifiedCellCount: 3 } }),
        confirmingWarning: true,
      }),
      ctx,
    );
    const dialog = view.querySelector('#export-warning');
    expect(dialog?.getAttribute('role')).toBe('alertdialog');
    expect(dialog?.getAttribute('aria-labelledby')).toBe('export-warning-title');
    expect(view.querySelector('#export-warning-title')?.textContent).toBe(
      '未検証の項目が 3 件あります。',
    );
    (view.querySelector('#export-warning-continue') as HTMLButtonElement).click();
    expect(callbacks.onConfirmGenerate).toHaveBeenCalledTimes(1);
    (view.querySelector('#export-warning-cancel') as HTMLButtonElement).click();
    expect(callbacks.onCancelGenerate).toHaveBeenCalledTimes(1);
  });

  test('警告ダイアログ: audit 形式はプレースホルダ行の注記を足し、null 件数は 0 扱い', () => {
    const { ctx } = makeCtx();
    const audit = renderExportView(
      makeState({
        format: 'audit',
        built: makeBuiltAll({ audit: { unverifiedCellCount: 2 } }),
        confirmingWarning: true,
      }),
      ctx,
    );
    expect(audit.querySelector('#export-warning')?.textContent).toContain('プレースホルダ行');

    // 防御分岐: unverifiedCellCount = null（results_long）でダイアログ状態になっても 0 件表示
    const longFormat = renderExportView(
      makeState({ format: 'results_long', built: makeBuiltAll(), confirmingWarning: true }),
      ctx,
    );
    expect(longFormat.querySelector('#export-warning-title')?.textContent).toBe(
      '未検証の項目が 0 件あります。',
    );
    expect(longFormat.querySelector('#export-warning')?.textContent).not.toContain(
      'プレースホルダ行',
    );
  });

  test('生成中: #export-generating + ラジオ・生成ボタン無効化', () => {
    const { ctx } = makeCtx();
    const view = renderExportView(makeState({ built: makeBuiltAll(), generating: true }), ctx);
    expect(view.querySelector('#export-generating')?.textContent).toBe(
      'CSV を生成して Drive に保存しています…',
    );
    expect((view.querySelector('#export-generate') as HTMLButtonElement).disabled).toBe(true);
    const radios = view.querySelectorAll<HTMLInputElement>('#export-format input[type=radio]');
    expect([...radios].every((radio) => radio.disabled)).toBe(true);
  });

  test('生成失敗: role=alert のエラー表示', () => {
    const { ctx } = makeCtx();
    const view = renderExportView(
      makeState({ built: makeBuiltAll(), generateError: 'Drive 容量不足' }),
      ctx,
    );
    const error = view.querySelector('#export-generate-error');
    expect(error?.getAttribute('role')).toBe('alert');
    expect(error?.textContent).toContain('Drive 容量不足');
  });

  test('生成完了: Drive リンク + ローカル保存 + ExportLog 記録済みの確認表示', () => {
    const { ctx, callbacks } = makeCtx();
    const view = renderExportView(
      makeState({
        built: makeBuiltAll(),
        result: {
          format: 'study_wide',
          filename: 'study_wide_20260703-090000.csv',
          fileRef: 'https://drive/file-1',
          rowCount: 1,
          exportedAt: '2026-07-03T09:00:00.000Z',
          csv: 'csv',
        },
      }),
      ctx,
    );
    const card = view.querySelector('#export-result');
    expect(card?.textContent).toContain(
      'study_wide_20260703-090000.csv を Drive に保存しました（ExportLog に記録済み）。',
    );
    const link = view.querySelector('#export-result-link');
    expect(link?.getAttribute('href')).toBe('https://drive/file-1');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener');
    (view.querySelector('#export-download') as HTMLButtonElement).click();
    expect(callbacks.onDownload).toHaveBeenCalledTimes(1);
  });
});

describe('renderExportView: R セット（issue #60）', () => {
  function rSetState(patch: Partial<ExportState> = {}): AppState {
    return makeState({
      built: makeBuiltAll(),
      format: 'r_set',
      rSet: makeBuiltRSet(),
      ...patch,
    });
  }

  test('サマリ（ファイル数 / データ行数 / 未検証セル数 / export_issues 件数）+ ファイル一覧 + ma.csv プレビュー', () => {
    const { ctx, callbacks } = makeCtx();
    const view = renderExportView(rSetState(), ctx);

    const radios = view.querySelectorAll<HTMLInputElement>('#export-format input[type=radio]');
    expect(radios[3]?.checked).toBe(true); // r_set が選択中

    const summary = view.querySelector('#export-rset-summary');
    expect(summary?.textContent).toContain('ファイル数');
    expect(summary?.textContent).toContain('8');
    expect(summary?.textContent).toContain('データ行数');
    expect(summary?.textContent).toContain('未検証セル数');
    expect(summary?.textContent).toContain('export_issues 件数');

    const fileList = view.querySelector('#export-rset-files');
    expect(fileList?.textContent).toContain('tab1.csv: 1 行');
    expect(fileList?.textContent).toContain('export_manifest.json');

    const preview = view.querySelector('#export-rset-preview');
    expect(preview?.querySelectorAll('th')).toHaveLength(2);
    expect(preview?.querySelector('tbody')?.textContent).toContain('mortality');

    const generate = view.querySelector('#export-generate') as HTMLButtonElement;
    expect(generate.disabled).toBe(false);
    expect(generate.textContent).toBe('8 ファイルを生成して Drive に保存');
    generate.click();
    expect(callbacks.onGenerate).toHaveBeenCalledTimes(1);
  });

  test('データ行 0 件は生成ボタン無効 + 案内文', () => {
    const { ctx } = makeCtx();
    const view = renderExportView(
      rSetState({
        rSet: makeBuiltRSet({
          files: makeBuiltRSet().files.map((file) => ({ ...file, rowCount: 0 })),
        }),
      }),
      ctx,
    );
    expect((view.querySelector('#export-generate') as HTMLButtonElement).disabled).toBe(true);
    expect(view.querySelector('.export__empty-note')?.textContent).toBe(
      'R セットで出力できるデータ行がありません。',
    );
  });

  test('警告ダイアログ: R セット向けの補足注記付きで未検証件数を表示', () => {
    const { ctx, callbacks } = makeCtx();
    const view = renderExportView(
      rSetState({
        rSet: makeBuiltRSet({
          issues: [
            { issueType: 'unverified_cell', studyId: 's1', fieldId: 'f1', entityKey: 'e', detail: 'd' },
            { issueType: 'unverified_cell', studyId: 's2', fieldId: 'f2', entityKey: 'e', detail: 'd' },
          ],
        }),
        confirmingWarning: true,
      }),
      ctx,
    );
    const dialog = view.querySelector('#export-warning');
    expect(dialog?.getAttribute('role')).toBe('alertdialog');
    expect(view.querySelector('#export-warning-title')?.textContent).toBe(
      '未検証の項目が 2 件あります。',
    );
    expect(dialog?.textContent).toContain('tab1_status.csv / ma_status.csv / rob.csv');
    (view.querySelector('#export-warning-continue') as HTMLButtonElement).click();
    expect(callbacks.onConfirmGenerate).toHaveBeenCalledTimes(1);
    (view.querySelector('#export-warning-cancel') as HTMLButtonElement).click();
    expect(callbacks.onCancelGenerate).toHaveBeenCalledTimes(1);
  });

  test('生成中: #export-generating + ラジオ・生成ボタン無効化', () => {
    const { ctx } = makeCtx();
    const view = renderExportView(rSetState({ generating: true }), ctx);
    expect(view.querySelector('#export-generating')?.textContent).toBe(
      '8 ファイルを生成して Drive に保存しています…',
    );
    expect((view.querySelector('#export-generate') as HTMLButtonElement).disabled).toBe(true);
  });

  test('生成失敗: role=alert のエラー表示', () => {
    const { ctx } = makeCtx();
    const view = renderExportView(rSetState({ generateError: 'Drive 容量不足' }), ctx);
    const error = view.querySelector('#export-generate-error');
    expect(error?.getAttribute('role')).toBe('alert');
    expect(error?.textContent).toContain('Drive 容量不足');
  });

  test('生成完了: フォルダリンク + ファイル一覧 + ローカル保存 + UTF-8 案内文', () => {
    const { ctx, callbacks } = makeCtx();
    const built = makeBuiltRSet();
    const view = renderExportView(
      rSetState({
        rSetResult: {
          folderRef: 'https://drive/rset-folder',
          folderName: 'rset_20260703-090000',
          exportedAt: '2026-07-03T09:00:00.000Z',
          built,
        },
      }),
      ctx,
    );
    const card = view.querySelector('#export-rset-result');
    expect(card?.textContent).toContain(
      'rset_20260703-090000 フォルダに 8 ファイルを Drive に保存しました（ExportLog に記録済み）。',
    );
    const link = view.querySelector('#export-rset-result-link');
    expect(link?.getAttribute('href')).toBe('https://drive/rset-folder');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener');
    expect(view.querySelector('#export-rset-result-files')?.textContent).toContain('ma.csv: 1 行');

    const note = view.querySelector('#export-rset-utf8-note');
    expect(note?.textContent).toContain('UTF-8（BOM なし）');
    expect(note?.textContent).toContain('readr::read_csv()');

    (view.querySelector('#export-rset-download') as HTMLButtonElement).click();
    expect(callbacks.onDownload).toHaveBeenCalledTimes(1);
  });
});

describe('renderExportView: 論文 Methods 記載例カード（issue #67）', () => {
  const facts = {
    toolVersion: '1.2.3',
    modelIds: ['gemini-3.5-flash-001'],
    providers: ['Gemini'],
    pilotStudyCount: 3,
    scannedDocumentCount: 0,
  };

  test('methodsFacts 未読込（null）はカード自体を出さない', () => {
    const { ctx } = makeCtx();
    const view = renderExportView(makeState({ built: makeBuiltAll(), methodsFacts: null }), ctx);
    expect(view.querySelector('#export-methods')).toBeNull();
  });

  test('既定（English・単一レビュアー）の本文とコピー・未反映注意書きを表示する', () => {
    const { ctx, callbacks } = makeCtx();
    const view = renderExportView(makeState({ built: makeBuiltAll(), methodsFacts: facts }), ctx);
    const textArea = view.querySelector('#methods-text') as HTMLTextAreaElement;
    expect(textArea.value.startsWith('Data extraction. Data were extracted using')).toBe(true);
    expect(textArea.value).toContain('gemini-3.5-flash-001');
    expect(textArea.readOnly).toBe(true);

    expect(view.querySelector('#methods-lang-en')?.getAttribute('aria-pressed')).toBe('true');
    expect(view.querySelector('#methods-lang-ja')?.getAttribute('aria-pressed')).toBe('false');
    expect(view.querySelector('#methods-workflow-single')?.getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(view.querySelector('#methods-workflow-dual')?.getAttribute('aria-pressed')).toBe(
      'false',
    );

    // n_sample 等が自動反映できないため注意書きが出る
    expect(view.querySelector('#methods-unresolved-note')?.textContent).toBe(
      '{{ }} の箇所はご自身の情報に置き換えてください',
    );

    (view.querySelector('#methods-copy') as HTMLButtonElement).click();
    expect(callbacks.onCopyMethods).toHaveBeenCalledTimes(1);
  });

  test('言語タブ / ワークフロートグルのクリックでコールバックが呼ばれる', () => {
    const { ctx, callbacks } = makeCtx();
    const view = renderExportView(makeState({ built: makeBuiltAll(), methodsFacts: facts }), ctx);
    (view.querySelector('#methods-lang-ja') as HTMLButtonElement).click();
    expect(callbacks.onChangeMethodsLanguage).toHaveBeenCalledWith('ja');
    (view.querySelector('#methods-workflow-dual') as HTMLButtonElement).click();
    expect(callbacks.onChangeMethodsWorkflow).toHaveBeenCalledWith('dual');
  });

  test('日本語 + 二重独立を選択している状態を反映する', () => {
    const { ctx } = makeCtx();
    const view = renderExportView(
      makeState({
        built: makeBuiltAll(),
        methodsFacts: facts,
        methodsLanguage: 'ja',
        methodsWorkflow: 'dual',
      }),
      ctx,
    );
    const textArea = view.querySelector('#methods-text') as HTMLTextAreaElement;
    expect(textArea.value.startsWith('データ抽出. データ抽出には')).toBe(true);
    expect(textArea.value).toContain('レビュアー 2 名（{{reviewer_initials}}）が独立に');
    expect(view.querySelector('#methods-lang-ja')?.getAttribute('aria-pressed')).toBe('true');
    expect(view.querySelector('#methods-workflow-dual')?.getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  test('未反映プレースホルダが残らない場合は注意書きを出さない', () => {
    const { ctx } = makeCtx();
    // 正典の文案では n_sample / reviewer_initials / supplement_ref が必ず残るため実際には
    // 起こらない組み合わせだが、将来の文案改訂に備えた防御分岐を検証するため差し替える
    buildMethodsTextMock.mockReturnValueOnce({ text: '差し替え済み本文', unresolved: [] });
    const view = renderExportView(makeState({ built: makeBuiltAll(), methodsFacts: facts }), ctx);
    expect((view.querySelector('#methods-text') as HTMLTextAreaElement).value).toBe(
      '差し替え済み本文',
    );
    expect(view.querySelector('#methods-unresolved-note')).toBeNull();
  });
});

describe('renderExportView（表示言語 en。issue #93）', () => {
  afterEach(() => {
    setUiLanguage('ja');
  });

  test('見出し・形式説明・読み込み中が en で描画される', () => {
    setUiLanguage('en');
    const { ctx } = makeCtx();
    const view = renderExportView(makeState(), ctx);
    expect(view.querySelector('h2')?.textContent).toBe('Export');
    expect(view.querySelector('#export-loading')?.textContent).toBe(
      'Loading the export materials…',
    );

    const errorView = renderExportView(makeState({ loadError: 'HTTP 500' }), ctx);
    expect(errorView.querySelector('#export-load-error')?.textContent).toBe(
      'Failed to load the export materials: HTTP 500',
    );
  });
});
