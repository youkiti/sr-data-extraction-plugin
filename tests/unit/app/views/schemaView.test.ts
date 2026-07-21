// #/schema view の描画テスト（ui-states.md §3 の各状態）。
// render は純粋関数のため、状態を組み立てて DOM を検証する
import { renderSchemaView } from '../../../../src/app/views/schemaView';
import type { SchemaViewCallbacks, ViewContext } from '../../../../src/app/views/types';
import { createInitialState, type AppState } from '../../../../src/app/store';
import type { DocumentRecord } from '../../../../src/domain/document';
import type { SchemaField } from '../../../../src/domain/schemaField';
import type { SchemaVersion } from '../../../../src/domain/schemaVersion';
import type { PresetDialogState } from '../../../../src/features/schema/presets/prespecDialog';
import {
  createRobPrespecDialogState,
  type RobPrespecDialogState,
} from '../../../../src/features/schema/presets/robPrespec';
import {
  createRobinsIPrespecDialogState,
  type RobinsIPrespecDialogState,
} from '../../../../src/features/schema/presets/robinsIPrespec';
import { createQuadas3PrespecDialogState } from '../../../../src/features/schema/presets/quadas3Prespec';
import { createQuipsPrespecDialogState } from '../../../../src/features/schema/presets/quipsPrespec';
import { setUiLanguage } from '../../../../src/lib/i18n';
import type { SchemaEditorRow } from '../../../../src/features/schema/types';

function makeCtx(): { ctx: ViewContext; callbacks: jest.Mocked<SchemaViewCallbacks> } {
  const callbacks = {
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
      },
      protocol: {
        onSubmit: jest.fn(),
        onStartEdit: jest.fn(),
        onCancelEdit: jest.fn(),
        onSelectVersion: jest.fn(),
        onReload: jest.fn(),
      },
      schema: callbacks,
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

function makeState(
  patch: Partial<AppState['schema']> = {},
  options: { withProject?: boolean; documents?: DocumentRecord[] | null } = {},
): AppState {
  const state = createInitialState();
  if (options.withProject !== false) {
    state.currentProject = {
      projectId: 'p1',
      spreadsheetId: 's1',
      driveFolderId: 'f1',
      name: 'テスト SR',
    };
  }
  if (options.documents !== undefined) {
    state.documents = { ...state.documents, records: options.documents };
  }
  state.schema = { ...state.schema, ...patch };
  return state;
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
    textRef: 'https://drive.google.com/file/d/txt-1/view',
    textStatus: 'ok',
    pageCount: 2,
    charCount: 4000,
    importedAt: '2026-07-01T00:00:00Z',
    importedBy: 'tester@example.com',
    note: null,
    ...overrides,
  };
}

function makeEditorRow(overrides: Partial<SchemaEditorRow> = {}): SchemaEditorRow {
  return {
    fieldId: null,
    section: 'methods',
    fieldName: 'study_design',
    fieldLabel: '研究デザイン',
    entityLevel: 'study',
    dataType: 'text',
    unit: null,
    allowedValues: null,
    required: true,
    extractionInstruction: 'Report the design.',
    example: null,
    aiGenerated: true,
    note: null,
    ...overrides,
  };
}

function makeVersion(schemaVersion: number, overrides: Partial<SchemaVersion> = {}): SchemaVersion {
  return {
    schemaVersion,
    parentVersion: null,
    protocolVersion: 1,
    createdByType: 'ai_draft',
    createdAt: `2026-07-0${schemaVersion}T00:00:00Z`,
    createdBy: 'tester@example.com',
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
    fieldName: 'study_design',
    fieldLabel: '研究デザイン',
    entityLevel: 'study',
    dataType: 'text',
    unit: null,
    allowedValues: null,
    required: true,
    extractionInstruction: 'Report the design.',
    example: null,
    aiGenerated: true,
    note: null,
    ...overrides,
  };
}

describe('renderSchemaView', () => {
  test('プロジェクト未選択: 見出しと案内のみ', () => {
    const { ctx } = makeCtx();
    const view = renderSchemaView(makeState({}, { withProject: false }), ctx);
    expect(view.querySelector('h2')?.textContent).toBe('表のデザイン');
    expect(view.querySelector('#schema-no-project')).not.toBeNull();
    expect(view.querySelector('#schema-draft-form')).toBeNull();
    // 見出し直下の説明文はプロジェクト未選択時も常時表示（issue #31）
    expect(view.querySelector('h2 + .view__lead')?.textContent).toContain(
      'これを設計する工程を表のデザインと呼んでいます。',
    );
  });

  test('読み込み中（versions = null / loading）: ローディング表示', () => {
    const { ctx } = makeCtx();
    expect(renderSchemaView(makeState(), ctx).querySelector('#schema-loading')).not.toBeNull();
    expect(
      renderSchemaView(makeState({ versions: [], loading: true }), ctx).querySelector(
        '#schema-loading',
      ),
    ).not.toBeNull();
  });

  test('読み込み失敗: エラー文言 + 再読み込み', () => {
    const { ctx, callbacks } = makeCtx();
    const view = renderSchemaView(makeState({ loadError: '403' }), ctx);
    expect(view.querySelector('#schema-load-error')?.textContent).toContain('403');
    (view.querySelector('#schema-reload') as HTMLButtonElement).click();
    expect(callbacks.onReload).toHaveBeenCalledTimes(1);
  });

  describe('ドラフト前（versions = []）', () => {
    test('文献一覧の読み込み中 / 空を案内する', () => {
      const { ctx } = makeCtx();
      const loading = renderSchemaView(makeState({ versions: [] }, { documents: null }), ctx);
      expect(loading.querySelector('#schema-documents-loading')).not.toBeNull();

      const empty = renderSchemaView(makeState({ versions: [] }, { documents: [] }), ctx);
      expect(empty.querySelector('#schema-documents-empty')?.textContent).toContain(
        'まだ文献がありません',
      );
    });

    test('サンプル論文セレクタ: 選択状態・テキスト層なしの無効化・切替コールバック', () => {
      const { ctx, callbacks } = makeCtx();
      const docs = [
        makeDocument(),
        makeDocument({ documentId: 'doc-2', studyId: 'study-2', textRef: null }),
      ];
      const view = renderSchemaView(
        makeState({ versions: [], selectedDocumentIds: ['doc-1'] }, { documents: docs }),
        ctx,
      );
      expect(view.querySelector('.schema__samples legend')?.textContent).toContain('1 / 3 本選択中');
      const checkboxes = view.querySelectorAll<HTMLInputElement>(
        '#schema-sample-list input[type="checkbox"]',
      );
      expect(checkboxes[0]?.checked).toBe(true);
      expect(checkboxes[1]?.disabled).toBe(true);
      expect(view.textContent).toContain('テキスト層なしのため選択不可');

      checkboxes[0]!.checked = false;
      checkboxes[0]!.dispatchEvent(new Event('change'));
      expect(callbacks.onToggleSample).toHaveBeenCalledWith('doc-1', false);
    });

    test('モデル入力・実行ボタン・エラー表示が配線されている', () => {
      const { ctx, callbacks } = makeCtx();
      const view = renderSchemaView(
        makeState(
          { versions: [], model: 'gemini-test', draftError: 'API キーが未設定です' },
          { documents: [makeDocument()] },
        ),
        ctx,
      );
      // 単価表にないモデル（gemini-test）は「その他」+ 直接入力テキストで復元される
      const model = view.querySelector('#schema-model') as HTMLSelectElement;
      const custom = view.querySelector('#schema-model-custom') as HTMLInputElement;
      expect(model.value).toBe('__other__');
      expect(custom.hidden).toBe(false);
      expect(custom.value).toBe('gemini-test');
      model.value = 'gemini-2.0-flash';
      model.dispatchEvent(new Event('change'));
      expect(callbacks.onChangeModel).toHaveBeenCalledWith('gemini-2.0-flash');

      expect(view.querySelector('#schema-draft-error')?.textContent).toBe('API キーが未設定です');
      (view.querySelector('#schema-draft-run') as HTMLButtonElement).click();
      expect(callbacks.onRunDraft).toHaveBeenCalledTimes(1);
    });
  });

  test('ドラフト生成中: 経過時間つきの進捗を表示する', () => {
    const { ctx } = makeCtx();
    const view = renderSchemaView(
      makeState({ versions: [], drafting: true, draftElapsedSeconds: 12 }),
      ctx,
    );
    expect(view.querySelector('#schema-draft-progress')?.textContent).toBe(
      'AI が表のデザインをドラフトしています…（12 秒経過）',
    );
  });

  describe('編集中（editorRows != null）', () => {
    test('data_type の凡例（型ごとの説明 + 例）をボタン下に表示する', () => {
      const { ctx } = makeCtx();
      const view = renderSchemaView(
        makeState({ versions: [], editorRows: [makeEditorRow()] }),
        ctx,
      );
      const help = view.querySelector('#schema-datatype-help');
      expect(help?.textContent).toContain('data_type の種類');
      expect(help?.textContent).toContain('text = 自由記述の文字列（例: プラセボ対照）');
      expect(help?.textContent).toContain('integer = 整数（例: 120）');
      expect(help?.textContent).toContain('float = 小数を含む数値（例: 12.5）');
      expect(help?.textContent).toContain('boolean = はい / いいえの 2 値（例: TRUE）');
      expect(help?.textContent).toContain('「許容値」列に | 区切りで指定');
      expect(help?.textContent).toContain('date = 日付（例: 2024-01-15）');
    });

    test('行の各セルが値を持ち、change で onEditRow に patch を渡す', () => {
      const { ctx, callbacks } = makeCtx();
      const view = renderSchemaView(
        makeState({
          versions: [],
          editorRows: [makeEditorRow({ unit: 'mg/day', example: '120' })],
        }),
        ctx,
      );
      const nameInput = view.querySelector(
        'input[aria-label="1 行目の field_name"]',
      ) as HTMLInputElement;
      expect(nameInput.value).toBe('study_design');
      nameInput.value = 'design_type';
      nameInput.dispatchEvent(new Event('change'));
      expect(callbacks.onEditRow).toHaveBeenCalledWith(0, { fieldName: 'design_type' });

      const unitInput = view.querySelector(
        'input[aria-label="1 行目の単位"]',
      ) as HTMLInputElement;
      unitInput.value = '  ';
      unitInput.dispatchEvent(new Event('change'));
      expect(callbacks.onEditRow).toHaveBeenCalledWith(0, { unit: null });

      const levelSelect = view.querySelector(
        'select[aria-label="1 行目の entity_level"]',
      ) as HTMLSelectElement;
      expect(levelSelect.value).toBe('study');
      levelSelect.value = 'arm';
      levelSelect.dispatchEvent(new Event('change'));
      expect(callbacks.onEditRow).toHaveBeenCalledWith(0, { entityLevel: 'arm' });

      const typeSelect = view.querySelector(
        'select[aria-label="1 行目の data_type"]',
      ) as HTMLSelectElement;
      typeSelect.value = 'enum';
      typeSelect.dispatchEvent(new Event('change'));
      expect(callbacks.onEditRow).toHaveBeenCalledWith(0, { dataType: 'enum' });

      const requiredCheckbox = view.querySelector(
        'input[aria-label="1 行目の必須"]',
      ) as HTMLInputElement;
      expect(requiredCheckbox.checked).toBe(true);
      requiredCheckbox.checked = false;
      requiredCheckbox.dispatchEvent(new Event('change'));
      expect(callbacks.onEditRow).toHaveBeenCalledWith(0, { required: false });

      const instruction = view.querySelector(
        'textarea[aria-label="1 行目の抽出指示"]',
      ) as HTMLTextAreaElement;
      instruction.value = 'Updated.';
      instruction.dispatchEvent(new Event('change'));
      expect(callbacks.onEditRow).toHaveBeenCalledWith(0, { extractionInstruction: 'Updated.' });

      const exampleInput = view.querySelector(
        'input[aria-label="1 行目の例"]',
      ) as HTMLInputElement;
      exampleInput.value = '例';
      exampleInput.dispatchEvent(new Event('change'));
      expect(callbacks.onEditRow).toHaveBeenCalledWith(0, { example: '例' });

      const allowedInput = view.querySelector(
        'input[aria-label="1 行目の許容値"]',
      ) as HTMLInputElement;
      allowedInput.value = 'a|b';
      allowedInput.dispatchEvent(new Event('change'));
      expect(callbacks.onEditRow).toHaveBeenCalledWith(0, { allowedValues: 'a|b' });

      const sectionInput = view.querySelector(
        'input[aria-label="1 行目の section"]',
      ) as HTMLInputElement;
      sectionInput.value = 'outcomes';
      sectionInput.dispatchEvent(new Event('change'));
      expect(callbacks.onEditRow).toHaveBeenCalledWith(0, { section: 'outcomes' });

      const labelInput = view.querySelector(
        'input[aria-label="1 行目の field_label"]',
      ) as HTMLInputElement;
      labelInput.value = '表示名';
      labelInput.dispatchEvent(new Event('change'));
      expect(callbacks.onEditRow).toHaveBeenCalledWith(0, { fieldLabel: '表示名' });
    });

    test('行削除・行追加・プリセット挿入・キャンセルが配線されている', () => {
      const { ctx, callbacks } = makeCtx();
      const view = renderSchemaView(
        makeState({ versions: [], editorRows: [makeEditorRow()] }),
        ctx,
      );
      (view.querySelector('button[aria-label="1 行目を削除"]') as HTMLButtonElement).click();
      expect(callbacks.onRemoveRow).toHaveBeenCalledWith(0);
      (view.querySelector('#schema-add-row') as HTMLButtonElement).click();
      expect(callbacks.onAddRow).toHaveBeenCalledTimes(1);
      (view.querySelector('#schema-preset-binary') as HTMLButtonElement).click();
      expect(callbacks.onInsertPreset).toHaveBeenCalledWith('binary');
      (view.querySelector('#schema-preset-continuous') as HTMLButtonElement).click();
      expect(callbacks.onInsertPreset).toHaveBeenCalledWith('continuous');
      (view.querySelector('#schema-preset-rob2') as HTMLButtonElement).click();
      expect(callbacks.onInsertPreset).toHaveBeenCalledWith('rob2');
      (view.querySelector('#schema-preset-rob2-sq') as HTMLButtonElement).click();
      expect(callbacks.onInsertPreset).toHaveBeenCalledWith('rob2_sq');
      (view.querySelector('#schema-preset-robins-i') as HTMLButtonElement).click();
      expect(callbacks.onInsertPreset).toHaveBeenCalledWith('robins_i');
      (view.querySelector('#schema-preset-robins-i-sq') as HTMLButtonElement).click();
      expect(callbacks.onInsertPreset).toHaveBeenCalledWith('robins_i_sq');
      (view.querySelector('#schema-preset-quadas3') as HTMLButtonElement).click();
      expect(callbacks.onInsertPreset).toHaveBeenCalledWith('quadas3');
      (view.querySelector('#schema-preset-quips') as HTMLButtonElement).click();
      expect(callbacks.onInsertPreset).toHaveBeenCalledWith('quips');
      (view.querySelector('#schema-editor-cancel') as HTMLButtonElement).click();
      expect(callbacks.onCancelEditor).toHaveBeenCalledTimes(1);
    });

    describe('RoB プリセット事前設定ダイアログ（issue #103。ui-states.md §3）', () => {
      function makeDialog(patch: Partial<RobPrespecDialogState> = {}): RobPrespecDialogState {
        return { ...createRobPrespecDialogState('rob2', null), ...patch };
      }

      function renderWithDialog(
        dialog: PresetDialogState | null,
      ): { view: HTMLElement; callbacks: jest.Mocked<SchemaViewCallbacks> } {
        const { ctx, callbacks } = makeCtx();
        const view = renderSchemaView(
          makeState({ versions: [], editorRows: [makeEditorRow()], presetDialog: dialog }),
          ctx,
        );
        return { view, callbacks };
      }

      test('presetDialog が null なら描画しない', () => {
        const { view } = renderWithDialog(null);
        expect(view.querySelector('#schema-preset-dialog')).toBeNull();
      });

      test('rob2（軽量版）: 任意の見出し・design 固定表示・「指定しない」ラジオ + スキップあり、ボタンが配線されている', () => {
        const { view, callbacks } = renderWithDialog(makeDialog());
        const dialog = view.querySelector('#schema-preset-dialog') as HTMLElement;
        expect(dialog.getAttribute('role')).toBe('dialog');
        expect(dialog.getAttribute('aria-labelledby')).toBe('schema-preset-dialog-title');
        expect(view.querySelector('#schema-preset-dialog-title')?.textContent).toBe(
          'RoB 2 テンプレートの事前設定（任意）',
        );
        expect(view.querySelector('#schema-prespec-design')?.textContent).toContain(
          'individually-randomized parallel-group trial',
        );
        expect(view.querySelector('#schema-prespec-design')?.textContent).toContain('別版');
        expect(view.querySelector('#schema-prespec-effect-none')).not.toBeNull();
        (view.querySelector('#schema-prespec-confirm') as HTMLButtonElement).click();
        expect(callbacks.onConfirmPresetDialog).toHaveBeenCalledTimes(1);
        (view.querySelector('#schema-prespec-skip') as HTMLButtonElement).click();
        expect(callbacks.onSkipPresetDialog).toHaveBeenCalledTimes(1);
        (view.querySelector('#schema-prespec-cancel') as HTMLButtonElement).click();
        expect(callbacks.onCancelPresetDialog).toHaveBeenCalledTimes(1);
      });

      test('rob2_sq: スキップと「指定しない」ラジオが無く、effect は必須表記', () => {
        const { view } = renderWithDialog({
          ...createRobPrespecDialogState('rob2_sq', null),
        });
        expect(view.querySelector('#schema-preset-dialog-title')?.textContent).toBe(
          'RoB 2（SQ 完全版）の事前設定',
        );
        expect(view.querySelector('#schema-prespec-skip')).toBeNull();
        expect(view.querySelector('#schema-prespec-effect-none')).toBeNull();
        expect(view.querySelector('.schema__prespec-effect legend')?.textContent).toContain(
          '必須',
        );
      });

      test('テキスト入力の change が onUpdatePresetDialog に配線されている', () => {
        const { view, callbacks } = renderWithDialog(makeDialog({ experimental: '既定値' }));
        const experimental = view.querySelector(
          '#schema-prespec-experimental',
        ) as HTMLInputElement;
        expect(experimental.value).toBe('既定値');
        experimental.value = 'CBT-I';
        experimental.dispatchEvent(new Event('change'));
        expect(callbacks.onUpdatePresetDialog).toHaveBeenCalledWith({ experimental: 'CBT-I' });
        const comparator = view.querySelector('#schema-prespec-comparator') as HTMLInputElement;
        comparator.value = 'waitlist';
        comparator.dispatchEvent(new Event('change'));
        expect(callbacks.onUpdatePresetDialog).toHaveBeenCalledWith({ comparator: 'waitlist' });
        const outcome = view.querySelector('#schema-prespec-outcome') as HTMLInputElement;
        outcome.value = 'SOL';
        outcome.dispatchEvent(new Event('change'));
        expect(callbacks.onUpdatePresetDialog).toHaveBeenCalledWith({ outcome: 'SOL' });
        const numericalResult = view.querySelector(
          '#schema-prespec-numerical-result',
        ) as HTMLInputElement;
        numericalResult.value = 'Table 2';
        numericalResult.dispatchEvent(new Event('change'));
        expect(callbacks.onUpdatePresetDialog).toHaveBeenCalledWith({
          numericalResult: 'Table 2',
        });
      });

      test('effect ラジオの選択が onUpdatePresetDialog に配線されている（未選択への change は無視）', () => {
        const { view, callbacks } = renderWithDialog(makeDialog());
        const assignment = view.querySelector(
          '#schema-prespec-effect-assignment',
        ) as HTMLInputElement;
        assignment.checked = true;
        assignment.dispatchEvent(new Event('change'));
        expect(callbacks.onUpdatePresetDialog).toHaveBeenCalledWith({ effect: 'assignment' });
        const adhering = view.querySelector('#schema-prespec-effect-adhering') as HTMLInputElement;
        adhering.checked = true;
        adhering.dispatchEvent(new Event('change'));
        expect(callbacks.onUpdatePresetDialog).toHaveBeenCalledWith({ effect: 'adhering' });
        const none = view.querySelector('#schema-prespec-effect-none') as HTMLInputElement;
        none.checked = true;
        none.dispatchEvent(new Event('change'));
        expect(callbacks.onUpdatePresetDialog).toHaveBeenCalledWith({ effect: null });
        // checked = false の change（ラジオ切替の解除側）は無視する
        callbacks.onUpdatePresetDialog.mockClear();
        assignment.checked = false;
        assignment.dispatchEvent(new Event('change'));
        expect(callbacks.onUpdatePresetDialog).not.toHaveBeenCalled();
      });

      test('deviation 種別チェックは adhering 選択時のみ表示され、トグルが配線されている', () => {
        const { view: withoutAdhering } = renderWithDialog(makeDialog({ effect: 'assignment' }));
        expect(withoutAdhering.querySelector('#schema-prespec-deviations')).toBeNull();

        const { view, callbacks } = renderWithDialog(
          makeDialog({ effect: 'adhering', deviationTypes: ['non_protocol_interventions'] }),
        );
        const fieldset = view.querySelector('#schema-prespec-deviations') as HTMLElement;
        expect(fieldset.querySelector('legend')?.textContent).toContain('最低 1 つ必須');
        const nonProtocol = view.querySelector('#schema-prespec-dev-non-protocol') as HTMLInputElement;
        expect(nonProtocol.checked).toBe(true);
        nonProtocol.checked = false;
        nonProtocol.dispatchEvent(new Event('change'));
        expect(callbacks.onUpdatePresetDialog).toHaveBeenCalledWith({ deviationTypes: [] });
        const nonAdherence = view.querySelector(
          '#schema-prespec-dev-non-adherence',
        ) as HTMLInputElement;
        expect(nonAdherence.checked).toBe(false);
        nonAdherence.checked = true;
        nonAdherence.dispatchEvent(new Event('change'));
        expect(callbacks.onUpdatePresetDialog).toHaveBeenCalledWith({
          deviationTypes: ['non_protocol_interventions', 'non_adherence'],
        });
        expect(view.querySelector('#schema-prespec-dev-implementation')).not.toBeNull();
      });

      describe('ROBINS-I ダイアログ（issue #103 PR2）', () => {
        function makeRobinsIDialog(
          patch: Partial<RobinsIPrespecDialogState> = {},
        ): RobinsIPrespecDialogState {
          return { ...createRobinsIPrespecDialogState('robins_i', null), ...patch };
        }

        test('robins_i（軽量版）: 任意の見出し・スキップ + 「指定しない」ラジオあり、各項目が描画される', () => {
          const { view, callbacks } = renderWithDialog(makeRobinsIDialog());
          expect(view.querySelector('#schema-preset-dialog-title')?.textContent).toBe(
            'ROBINS-I テンプレートの事前設定（任意）',
          );
          expect(view.querySelector('#schema-prespec-skip')).not.toBeNull();
          expect(view.querySelector('#schema-prespec-ri-effect-none')).not.toBeNull();
          for (const id of [
            'schema-prespec-ri-design',
            'schema-prespec-ri-participants',
            'schema-prespec-ri-experimental',
            'schema-prespec-ri-comparator',
            'schema-prespec-ri-outcome',
            'schema-prespec-ri-confounders',
            'schema-prespec-ri-cointerventions',
            'schema-prespec-ri-bh-none',
            'schema-prespec-ri-bh-benefit',
            'schema-prespec-ri-bh-harm',
          ]) {
            expect(view.querySelector(`#${id}`)).not.toBeNull();
          }
          (view.querySelector('#schema-prespec-skip') as HTMLButtonElement).click();
          expect(callbacks.onSkipPresetDialog).toHaveBeenCalledTimes(1);
        });

        test('robins_i_sq: スキップと「指定しない」ラジオが無く、effect は必須表記', () => {
          const { view } = renderWithDialog({
            ...createRobinsIPrespecDialogState('robins_i_sq', null),
          });
          expect(view.querySelector('#schema-preset-dialog-title')?.textContent).toBe(
            'ROBINS-I（SQ 完全版）の事前設定',
          );
          expect(view.querySelector('#schema-prespec-skip')).toBeNull();
          expect(view.querySelector('#schema-prespec-ri-effect-none')).toBeNull();
        });

        test('テキスト / リスト入力の change が onUpdatePresetDialog に配線されている', () => {
          const { view, callbacks } = renderWithDialog(
            makeRobinsIDialog({ participants: '既定値' }),
          );
          const participants = view.querySelector(
            '#schema-prespec-ri-participants',
          ) as HTMLInputElement;
          expect(participants.value).toBe('既定値');
          participants.value = 'adults';
          participants.dispatchEvent(new Event('change'));
          expect(callbacks.onUpdatePresetDialog).toHaveBeenCalledWith({ participants: 'adults' });
          const design = view.querySelector('#schema-prespec-ri-design') as HTMLInputElement;
          design.value = 'individually randomized';
          design.dispatchEvent(new Event('change'));
          expect(callbacks.onUpdatePresetDialog).toHaveBeenCalledWith({
            design: 'individually randomized',
          });
          const confounders = view.querySelector(
            '#schema-prespec-ri-confounders',
          ) as HTMLTextAreaElement;
          confounders.value = 'age\nseverity';
          confounders.dispatchEvent(new Event('change'));
          expect(callbacks.onUpdatePresetDialog).toHaveBeenCalledWith({
            confoundingDomains: 'age\nseverity',
          });
          const coInterventions = view.querySelector(
            '#schema-prespec-ri-cointerventions',
          ) as HTMLTextAreaElement;
          coInterventions.value = 'co-drug B';
          coInterventions.dispatchEvent(new Event('change'));
          expect(callbacks.onUpdatePresetDialog).toHaveBeenCalledWith({
            coInterventions: 'co-drug B',
          });
          const experimental = view.querySelector(
            '#schema-prespec-ri-experimental',
          ) as HTMLInputElement;
          experimental.value = 'drug A';
          experimental.dispatchEvent(new Event('change'));
          expect(callbacks.onUpdatePresetDialog).toHaveBeenCalledWith({ experimental: 'drug A' });
          const comparator = view.querySelector(
            '#schema-prespec-ri-comparator',
          ) as HTMLInputElement;
          comparator.value = 'usual care';
          comparator.dispatchEvent(new Event('change'));
          expect(callbacks.onUpdatePresetDialog).toHaveBeenCalledWith({ comparator: 'usual care' });
          const outcome = view.querySelector('#schema-prespec-ri-outcome') as HTMLInputElement;
          outcome.value = 'mortality';
          outcome.dispatchEvent(new Event('change'));
          expect(callbacks.onUpdatePresetDialog).toHaveBeenCalledWith({ outcome: 'mortality' });
        });

        test('effect / benefit-harm ラジオの選択が onUpdatePresetDialog に配線されている', () => {
          const { view, callbacks } = renderWithDialog(makeRobinsIDialog());
          const assignment = view.querySelector(
            '#schema-prespec-ri-effect-assignment',
          ) as HTMLInputElement;
          assignment.checked = true;
          assignment.dispatchEvent(new Event('change'));
          expect(callbacks.onUpdatePresetDialog).toHaveBeenCalledWith({ effect: 'assignment' });
          const adhering = view.querySelector(
            '#schema-prespec-ri-effect-adhering',
          ) as HTMLInputElement;
          adhering.checked = true;
          adhering.dispatchEvent(new Event('change'));
          expect(callbacks.onUpdatePresetDialog).toHaveBeenCalledWith({
            effect: 'starting_adhering',
          });
          const none = view.querySelector('#schema-prespec-ri-effect-none') as HTMLInputElement;
          none.checked = true;
          none.dispatchEvent(new Event('change'));
          expect(callbacks.onUpdatePresetDialog).toHaveBeenCalledWith({ effect: null });
          const benefit = view.querySelector('#schema-prespec-ri-bh-benefit') as HTMLInputElement;
          benefit.checked = true;
          benefit.dispatchEvent(new Event('change'));
          expect(callbacks.onUpdatePresetDialog).toHaveBeenCalledWith({ benefitHarm: 'benefit' });
          const harm = view.querySelector('#schema-prespec-ri-bh-harm') as HTMLInputElement;
          harm.checked = true;
          harm.dispatchEvent(new Event('change'));
          expect(callbacks.onUpdatePresetDialog).toHaveBeenCalledWith({ benefitHarm: 'harm' });
          const bhNone = view.querySelector('#schema-prespec-ri-bh-none') as HTMLInputElement;
          bhNone.checked = true;
          bhNone.dispatchEvent(new Event('change'));
          expect(callbacks.onUpdatePresetDialog).toHaveBeenCalledWith({ benefitHarm: null });
        });

        test('検証エラーは共通の #schema-prespec-error（role="alert"）に表示される', () => {
          const { view } = renderWithDialog(
            makeRobinsIDialog({
              kind: 'robins_i_sq',
              error: 'schema.prespecErrRobinsIEffectRequired',
            }),
          );
          const error = view.querySelector('#schema-prespec-error') as HTMLElement;
          expect(error.getAttribute('role')).toBe('alert');
          expect(error.textContent).toContain('effect of interest');
        });
      });

      describe('QUADAS-3 / QUIPS ダイアログ（issue #103 PR3）', () => {
        test('quadas3: 任意の見出し・スキップあり・Phase 1〜2 の 7 項目が描画され change が配線されている', () => {
          const { view, callbacks } = renderWithDialog(createQuadas3PrespecDialogState(null));
          expect(view.querySelector('#schema-preset-dialog-title')?.textContent).toBe(
            'QUADAS-3 テンプレートの事前設定（任意）',
          );
          expect(view.querySelector('#schema-prespec-skip')).not.toBeNull();
          for (const id of [
            'schema-prespec-q3-population',
            'schema-prespec-q3-index-test',
            'schema-prespec-q3-target-condition',
            'schema-prespec-q3-intended-use',
            'schema-prespec-q3-test-role',
            'schema-prespec-q3-reference-standard',
            'schema-prespec-q3-analysis-unit',
          ]) {
            expect(view.querySelector(`#${id}`)).not.toBeNull();
          }
          const population = view.querySelector('#schema-prespec-q3-population') as HTMLInputElement;
          population.value = 'adults';
          population.dispatchEvent(new Event('change'));
          expect(callbacks.onUpdatePresetDialog).toHaveBeenCalledWith({ population: 'adults' });
          const indexTest = view.querySelector('#schema-prespec-q3-index-test') as HTMLInputElement;
          indexTest.value = 'D-dimer';
          indexTest.dispatchEvent(new Event('change'));
          expect(callbacks.onUpdatePresetDialog).toHaveBeenCalledWith({ indexTest: 'D-dimer' });
          const targetCondition = view.querySelector(
            '#schema-prespec-q3-target-condition',
          ) as HTMLInputElement;
          targetCondition.value = 'DVT';
          targetCondition.dispatchEvent(new Event('change'));
          expect(callbacks.onUpdatePresetDialog).toHaveBeenCalledWith({ targetCondition: 'DVT' });
          const intendedUse = view.querySelector('#schema-prespec-q3-intended-use') as HTMLInputElement;
          intendedUse.value = 'primary care';
          intendedUse.dispatchEvent(new Event('change'));
          expect(callbacks.onUpdatePresetDialog).toHaveBeenCalledWith({
            intendedUsePopulation: 'primary care',
          });
          const testRole = view.querySelector('#schema-prespec-q3-test-role') as HTMLInputElement;
          testRole.value = 'triage';
          testRole.dispatchEvent(new Event('change'));
          expect(callbacks.onUpdatePresetDialog).toHaveBeenCalledWith({ testRole: 'triage' });
          const referenceStandard = view.querySelector(
            '#schema-prespec-q3-reference-standard',
          ) as HTMLInputElement;
          referenceStandard.value = 'ultrasonography';
          referenceStandard.dispatchEvent(new Event('change'));
          expect(callbacks.onUpdatePresetDialog).toHaveBeenCalledWith({
            referenceStandard: 'ultrasonography',
          });
          const analysisUnit = view.querySelector('#schema-prespec-q3-analysis-unit') as HTMLInputElement;
          analysisUnit.value = 'per patient';
          analysisUnit.dispatchEvent(new Event('change'));
          expect(callbacks.onUpdatePresetDialog).toHaveBeenCalledWith({ analysisUnit: 'per patient' });
        });

        test('quips: 任意の見出し・スキップあり・5 項目（LIST は textarea）が描画され change が配線されている', () => {
          const { view, callbacks } = renderWithDialog(createQuipsPrespecDialogState(null));
          expect(view.querySelector('#schema-preset-dialog-title')?.textContent).toBe(
            'QUIPS テンプレートの事前設定（任意）',
          );
          expect(view.querySelector('#schema-prespec-skip')).not.toBeNull();
          const population = view.querySelector('#schema-prespec-quips-population') as HTMLInputElement;
          population.value = 'adults';
          population.dispatchEvent(new Event('change'));
          expect(callbacks.onUpdatePresetDialog).toHaveBeenCalledWith({ population: 'adults' });
          const pf = view.querySelector('#schema-prespec-quips-pf') as HTMLInputElement;
          pf.value = 'FAB';
          pf.dispatchEvent(new Event('change'));
          expect(callbacks.onUpdatePresetDialog).toHaveBeenCalledWith({ prognosticFactor: 'FAB' });
          const outcome = view.querySelector('#schema-prespec-quips-outcome') as HTMLInputElement;
          outcome.value = 'disability';
          outcome.dispatchEvent(new Event('change'));
          expect(callbacks.onUpdatePresetDialog).toHaveBeenCalledWith({ outcome: 'disability' });
          const keyCharacteristics = view.querySelector(
            '#schema-prespec-quips-key-characteristics',
          ) as HTMLTextAreaElement;
          keyCharacteristics.value = 'age\nsex';
          keyCharacteristics.dispatchEvent(new Event('change'));
          expect(callbacks.onUpdatePresetDialog).toHaveBeenCalledWith({
            keyCharacteristics: 'age\nsex',
          });
          const confounders = view.querySelector(
            '#schema-prespec-quips-confounders',
          ) as HTMLTextAreaElement;
          confounders.value = 'baseline severity';
          confounders.dispatchEvent(new Event('change'));
          expect(callbacks.onUpdatePresetDialog).toHaveBeenCalledWith({
            importantConfounders: 'baseline severity',
          });
        });
      });

      test('検証エラーは role="alert" で表示し、エラーなしなら要素を出さない', () => {
        const { view: withoutError } = renderWithDialog(makeDialog());
        expect(withoutError.querySelector('#schema-prespec-error')).toBeNull();
        const { view } = renderWithDialog(makeDialog({ error: 'schema.prespecErrEffectRequired' }));
        const error = view.querySelector('#schema-prespec-error') as HTMLElement;
        expect(error.getAttribute('role')).toBe('alert');
        expect(error.textContent).toContain('effect of interest');
      });
    });

    test('検証エラー: エラー一覧 + 該当セルの aria-invalid + 確定ボタン無効化', () => {
      const { ctx } = makeCtx();
      const view = renderSchemaView(
        makeState({
          versions: [],
          editorRows: [makeEditorRow({ fieldName: 'NG name' })],
          editorErrors: [
            { index: 0, column: 'fieldName', message: 'field_name は snake_case にしてください' },
          ],
        }),
        ctx,
      );
      expect(view.querySelector('#schema-editor-errors')?.textContent).toContain(
        '1 行目 field_name',
      );
      const nameInput = view.querySelector(
        'input[aria-label="1 行目の field_name"]',
      ) as HTMLInputElement;
      expect(nameInput.getAttribute('aria-invalid')).toBe('true');
      expect((view.querySelector('#schema-confirm') as HTMLButtonElement).disabled).toBe(true);
    });

    test('抽出指示のエラーは textarea を強調する', () => {
      const { ctx } = makeCtx();
      const view = renderSchemaView(
        makeState({
          versions: [],
          editorRows: [makeEditorRow({ extractionInstruction: '' })],
          editorErrors: [
            { index: 0, column: 'extractionInstruction', message: '抽出指示は必須です' },
          ],
        }),
        ctx,
      );
      const instruction = view.querySelector(
        'textarea[aria-label="1 行目の抽出指示"]',
      ) as HTMLTextAreaElement;
      expect(instruction.getAttribute('aria-invalid')).toBe('true');
    });

    test('版として確定: note を渡し、確定中はボタンを無効化・文言変更する', () => {
      const { ctx, callbacks } = makeCtx();
      const view = renderSchemaView(
        makeState({ versions: [], editorRows: [makeEditorRow()] }),
        ctx,
      );
      const note = view.querySelector('#schema-note') as HTMLInputElement;
      note.value = '初版';
      (view.querySelector('#schema-confirm') as HTMLButtonElement).click();
      expect(callbacks.onConfirm).toHaveBeenCalledWith('初版');

      const confirming = renderSchemaView(
        makeState({ versions: [], editorRows: [makeEditorRow()], confirming: true }),
        ctx,
      );
      const button = confirming.querySelector('#schema-confirm') as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      expect(button.textContent).toBe('確定しています…');
      expect(
        (confirming.querySelector('#schema-editor-cancel') as HTMLButtonElement).disabled,
      ).toBe(true);
    });

    test('確定エラー（draftError）をエディタ内に表示する', () => {
      const { ctx } = makeCtx();
      const view = renderSchemaView(
        makeState({ versions: [], editorRows: [makeEditorRow()], draftError: 'append failed' }),
        ctx,
      );
      expect(view.querySelector('#schema-confirm-error')?.textContent).toBe('append failed');
    });
  });

  describe('確定済み（versions >= 1・エディタ非表示）', () => {
    test('現行版のメタ・改訂理由・項目テーブルを表示する', () => {
      const { ctx, callbacks } = makeCtx();
      const view = renderSchemaView(
        makeState({
          versions: [makeVersion(1, { note: '初版', createdByType: 'user_edit' })],
          currentFields: [makeField(), makeField({ fieldId: 'f-2', fieldName: 'country', fieldIndex: 2, required: false })],
        }),
        ctx,
      );
      expect(view.querySelector('#schema-current-meta')?.textContent).toContain('現行版: v1');
      expect(view.querySelector('#schema-current-meta')?.textContent).toContain('手動編集');
      expect(view.textContent).toContain('改訂理由: 初版');
      const rows = view.querySelectorAll('#schema-current-table tbody tr');
      expect(rows).toHaveLength(2);
      expect(rows[0]?.textContent).toContain('study_design');
      expect(rows[0]?.textContent).toContain('必須');
      expect(rows[1]?.textContent).toContain('—');

      (view.querySelector('#schema-new-version') as HTMLButtonElement).click();
      expect(callbacks.onStartNewVersion).toHaveBeenCalledTimes(1);
      (view.querySelector('#schema-reload') as HTMLButtonElement).click();
      expect(callbacks.onReload).toHaveBeenCalledTimes(1);
    });

    test('版履歴は 2 版以上のときだけ表示し、派生元を含める', () => {
      const { ctx } = makeCtx();
      // currentFields 未読込（null）でもテーブルは空で崩れない
      const single = renderSchemaView(makeState({ versions: [makeVersion(1)] }), ctx);
      expect(single.querySelector('#schema-history')).toBeNull();
      expect(single.querySelectorAll('#schema-current-table tbody tr')).toHaveLength(0);

      const multi = renderSchemaView(
        makeState({
          versions: [makeVersion(2, { parentVersion: 1 }), makeVersion(1)],
          currentFields: [],
        }),
        ctx,
      );
      const items = multi.querySelectorAll('#schema-history li');
      expect(items).toHaveLength(2);
      expect(items[0]?.textContent).toContain('v1 から派生');
    });
  });
});

describe('renderSchemaView（表示言語 en。issue #93）', () => {
  afterEach(() => {
    setUiLanguage('ja');
  });

  test('見出し・リード・ドラフトフォームが en で描画される', () => {
    setUiLanguage('en');
    const { ctx } = makeCtx();
    const view = renderSchemaView(makeState({ versions: [] }, { documents: [] }), ctx);
    expect(view.querySelector('h2')?.textContent).toBe('Table design');
    expect(view.textContent).toContain('the table design');
    expect(view.querySelector('#schema-documents-empty')?.textContent).toBe(
      'No documents yet. Import PDFs on the Documents screen first.',
    );
    expect(view.querySelector('#schema-draft-run')?.textContent).toBe(
      'Have AI draft the table design',
    );
  });

  test('エディタの検証エラー（和名列）が en で描画される', () => {
    setUiLanguage('en');
    const { ctx } = makeCtx();
    const view = renderSchemaView(
      makeState({
        versions: [],
        editorRows: [makeEditorRow({ allowedValues: '' })],
        editorErrors: [{ index: 0, column: 'allowedValues', message: 'ng' }],
      }),
      ctx,
    );
    expect(view.querySelector('#schema-editor-errors')?.textContent).toBe(
      'Row 1, Allowed values: ng',
    );
  });

  test('事前設定ダイアログの検証エラーは表示言語に追従する（issue #126 項目3）', () => {
    // state には MessageKey（'schema.prespecErrEffectRequired'）を保持し、描画時に
    // 現在言語で t() 解決する。エラーを set した後で言語を切り替えても、再描画すれば
    // 新しい言語の文言になることを確認する（旧実装は t() 解決済み文字列を state に
    // 保存していたため、この再描画でも ja のまま残っていた）
    const { ctx } = makeCtx();
    const dialog = {
      ...createRobPrespecDialogState('rob2_sq', null),
      error: 'schema.prespecErrEffectRequired' as const,
    };

    setUiLanguage('ja');
    const jaView = renderSchemaView(
      makeState({ versions: [], editorRows: [makeEditorRow()], presetDialog: dialog }),
      ctx,
    );
    expect(jaView.querySelector('#schema-prespec-error')?.textContent).toBe(
      'effect of interest（assignment / adhering）を選択してください',
    );

    setUiLanguage('en');
    const enView = renderSchemaView(
      makeState({ versions: [], editorRows: [makeEditorRow()], presetDialog: dialog }),
      ctx,
    );
    expect(enView.querySelector('#schema-prespec-error')?.textContent).toBe(
      'Select the effect of interest (assignment / adhering)',
    );
  });
});
