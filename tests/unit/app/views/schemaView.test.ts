// #/schema view の描画テスト（ui-states.md §3 の各状態）。
// render は純粋関数のため、状態を組み立てて DOM を検証する
import { renderSchemaView } from '../../../../src/app/views/schemaView';
import type { SchemaViewCallbacks, ViewContext } from '../../../../src/app/views/types';
import { createInitialState, type AppState } from '../../../../src/app/store';
import type { DocumentRecord } from '../../../../src/domain/document';
import type { SchemaField } from '../../../../src/domain/schemaField';
import type { SchemaVersion } from '../../../../src/domain/schemaVersion';
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
    onConfirm: jest.fn(),
    onCancelEditor: jest.fn(),
    onStartNewVersion: jest.fn(),
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
      schema: callbacks,
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
    studyLabel: 'Smith 2020',
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
    expect(view.querySelector('h2')?.textContent).toBe('スキーマデザイン');
    expect(view.querySelector('#schema-no-project')).not.toBeNull();
    expect(view.querySelector('#schema-draft-form')).toBeNull();
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
        makeDocument({ documentId: 'doc-2', studyLabel: 'NoText 2021', textRef: null }),
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
      const model = view.querySelector('#schema-model') as HTMLInputElement;
      expect(model.value).toBe('gemini-test');
      model.value = 'gemini-next';
      model.dispatchEvent(new Event('change'));
      expect(callbacks.onChangeModel).toHaveBeenCalledWith('gemini-next');

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
      'AI がスキーマをドラフトしています…（12 秒経過）',
    );
  });

  describe('編集中（editorRows != null）', () => {
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
      (view.querySelector('#schema-editor-cancel') as HTMLButtonElement).click();
      expect(callbacks.onCancelEditor).toHaveBeenCalledTimes(1);
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
