// #/schema: スキーマデザイン（S5 / ui-states.md §3）。
// 状態: プロジェクト未選択 / 読み込み中 / 失敗 / ドラフト前（サンプル論文セレクタ + モデル入力）/
// ドラフト生成中（経過時間は store 管理）/ 編集中（表形式エディタ + 検証エラー）/
// 確定済み（現行版サマリ + 版履歴 + 新しい版を作る）。
// データは AppState.schema（schemaService が更新）から描く
import type { EntityLevel, FieldDataType, SchemaField } from '../../domain/schemaField';
import type { SchemaVersion } from '../../domain/schemaVersion';
import type { SchemaEditorRow } from '../../features/schema/types';
import type { FieldValidationError } from '../../features/schema/validateField';
import { el } from '../ui/dom';
import { createModelSelect } from '../ui/modelSelect';
import type { AppState, SchemaState } from '../store';
import type { ViewContext } from './types';

const ENTITY_LEVELS: readonly EntityLevel[] = ['study', 'arm', 'outcome_result', 'rob_domain'];
const DATA_TYPES: readonly FieldDataType[] = ['text', 'integer', 'float', 'boolean', 'enum', 'date'];

/** data_type 列の凡例（表形式エディタのボタン下に常時表示） */
const DATA_TYPE_DESCRIPTIONS: Record<FieldDataType, string> = {
  text: '自由記述の文字列（例: プラセボ対照）',
  integer: '整数（例: 120）',
  float: '小数を含む数値（例: 12.5）',
  boolean: 'はい / いいえの 2 値（例: TRUE）',
  enum: '決まった選択肢から 1 つ。「許容値」列に | 区切りで指定（例: high|some|low）',
  date: '日付（例: 2024-01-15）',
};

const CREATED_BY_TYPE_LABELS: Record<SchemaVersion['createdByType'], string> = {
  ai_draft: 'AI ドラフト',
  user_edit: '手動編集',
  pilot_revision: 'パイロット改訂',
};

const ERROR_COLUMN_LABELS: Record<FieldValidationError['column'], string> = {
  fieldName: 'field_name',
  fieldLabel: 'field_label',
  section: 'section',
  allowedValues: '許容値',
  extractionInstruction: '抽出指示',
};

function reloadButton(ctx: ViewContext): HTMLButtonElement {
  const button = el('button', {
    id: 'schema-reload',
    text: '再読み込み',
    attributes: { type: 'button' },
  });
  button.addEventListener('click', () => ctx.schema.onReload());
  return button;
}

/** ドラフト前: サンプル論文セレクタ（1〜3 本）+ requested_model + 実行ボタン */
function renderDraftForm(state: AppState, ctx: ViewContext): HTMLElement {
  const { records } = state.documents;
  const { selectedDocumentIds, model, draftError } = state.schema;

  const children: HTMLElement[] = [
    el('h3', { text: 'AI に表のデザインをドラフトさせる' }),
    el('p', {
      className: 'view__lead',
      text: 'プロトコルとサンプル論文（1〜3 本）から抽出項目のドラフトを生成します。生成後に表形式エディタで確認・編集してから版として確定します。',
    }),
  ];

  if (records === null) {
    children.push(el('p', { id: 'schema-documents-loading', text: '文献一覧を読み込んでいます…' }));
  } else if (records.length === 0) {
    children.push(
      el('p', {
        id: 'schema-documents-empty',
        text: 'まだ文献がありません。先に文献取り込みで PDF を取り込んでください。',
      }),
    );
  } else {
    const items = records.map((doc) => {
      const checkbox = el('input', { attributes: { type: 'checkbox' } });
      checkbox.checked = selectedDocumentIds.includes(doc.documentId);
      checkbox.disabled = doc.textRef === null;
      checkbox.addEventListener('change', () =>
        ctx.schema.onToggleSample(doc.documentId, checkbox.checked),
      );
      const labelChildren: (HTMLElement | string)[] = [checkbox, doc.filename];
      if (doc.textRef === null) {
        labelChildren.push(
          el('small', { className: 'schema__sample-note', text: 'テキスト層なしのため選択不可' }),
        );
      }
      return el('li', {}, [el('label', { className: 'schema__sample-option' }, labelChildren)]);
    });
    children.push(
      el('fieldset', { className: 'schema__samples' }, [
        el('legend', { text: `サンプル論文（${selectedDocumentIds.length} / 3 本選択中）` }),
        el('ul', { id: 'schema-sample-list', className: 'schema__sample-list' }, items),
      ]),
    );
  }

  const modelSelect = createModelSelect(document, {
    id: 'schema-model',
    ariaLabel: 'モデル名（requested_model）',
    value: model,
    placeholderLabel: '選択してください',
    onChange: (value) => ctx.schema.onChangeModel(value),
    className: 'schema__model-input',
  });
  children.push(
    el('div', { className: 'schema__field' }, [
      el('label', { text: 'モデル（requested_model）', attributes: { for: 'schema-model' } }),
      modelSelect,
    ]),
  );

  children.push(
    el('p', {
      id: 'schema-draft-error',
      className: 'schema__error',
      text: draftError ?? '',
      attributes: { 'aria-live': 'polite' },
    }),
  );

  const runButton = el('button', {
    id: 'schema-draft-run',
    className: 'schema__primary',
    text: 'AI に表のデザインをドラフトさせる',
    attributes: { type: 'button' },
  });
  runButton.addEventListener('click', () => ctx.schema.onRunDraft());
  children.push(el('div', { className: 'schema__actions' }, [runButton]));

  return el('div', { id: 'schema-draft-form', className: 'schema__draft-form' }, children);
}

/** ドラフト生成中: 経過時間つき進捗（store 管理のため他の再描画でも消えない） */
function renderDraftProgress(schema: SchemaState): HTMLElement {
  return el('p', {
    id: 'schema-draft-progress',
    className: 'schema__status',
    text: `AI が表のデザインをドラフトしています…（${schema.draftElapsedSeconds} 秒経過）`,
    attributes: { role: 'status' },
  });
}

function textCell(
  value: string,
  options: { ariaLabel: string; invalid?: boolean },
  onCommit: (value: string) => void,
): HTMLTableCellElement {
  const input = el('input', {
    className: 'schema__cell-input',
    attributes: { type: 'text', 'aria-label': options.ariaLabel },
  });
  input.value = value;
  if (options.invalid === true) {
    input.setAttribute('aria-invalid', 'true');
    input.classList.add('schema__cell-input--error');
  }
  input.addEventListener('change', () => onCommit(input.value));
  return el('td', {}, [input]);
}

function selectCell(
  values: readonly string[],
  current: string,
  ariaLabel: string,
  onCommit: (value: string) => void,
): HTMLTableCellElement {
  const select = el('select', { attributes: { 'aria-label': ariaLabel } });
  for (const value of values) {
    const option = el('option', { text: value, attributes: { value } });
    option.selected = value === current;
    select.append(option);
  }
  select.addEventListener('change', () => onCommit(select.value));
  return el('td', {}, [select]);
}

const emptyToNull = (value: string): string | null => (value.trim() === '' ? null : value.trim());

function renderEditorRow(
  row: SchemaEditorRow,
  index: number,
  invalidColumns: ReadonlySet<string>,
  ctx: ViewContext,
): HTMLElement {
  const invalid = (column: FieldValidationError['column']): boolean =>
    invalidColumns.has(`${index}:${column}`);
  const edit = (patch: Partial<SchemaEditorRow>): void => ctx.schema.onEditRow(index, patch);

  const requiredCheckbox = el('input', {
    attributes: { type: 'checkbox', 'aria-label': `${index + 1} 行目の必須` },
  });
  requiredCheckbox.checked = row.required;
  requiredCheckbox.addEventListener('change', () => edit({ required: requiredCheckbox.checked }));

  const instruction = el('textarea', {
    className: 'schema__cell-instruction',
    attributes: { rows: '2', 'aria-label': `${index + 1} 行目の抽出指示` },
  });
  instruction.value = row.extractionInstruction;
  if (invalid('extractionInstruction')) {
    instruction.setAttribute('aria-invalid', 'true');
    instruction.classList.add('schema__cell-input--error');
  }
  instruction.addEventListener('change', () => edit({ extractionInstruction: instruction.value }));

  const removeButton = el('button', {
    className: 'schema__row-remove',
    text: '削除',
    attributes: { type: 'button', 'aria-label': `${index + 1} 行目を削除` },
  });
  removeButton.addEventListener('click', () => ctx.schema.onRemoveRow(index));

  return el('tr', {}, [
    el('td', { className: 'schema__row-index', text: String(index + 1) }),
    textCell(
      row.section,
      { ariaLabel: `${index + 1} 行目の section`, invalid: invalid('section') },
      (value) => edit({ section: value }),
    ),
    textCell(
      row.fieldName,
      { ariaLabel: `${index + 1} 行目の field_name`, invalid: invalid('fieldName') },
      (value) => edit({ fieldName: value }),
    ),
    textCell(
      row.fieldLabel,
      { ariaLabel: `${index + 1} 行目の field_label`, invalid: invalid('fieldLabel') },
      (value) => edit({ fieldLabel: value }),
    ),
    selectCell(ENTITY_LEVELS, row.entityLevel, `${index + 1} 行目の entity_level`, (value) =>
      edit({ entityLevel: value as EntityLevel }),
    ),
    selectCell(DATA_TYPES, row.dataType, `${index + 1} 行目の data_type`, (value) =>
      edit({ dataType: value as FieldDataType }),
    ),
    textCell(row.unit ?? '', { ariaLabel: `${index + 1} 行目の単位` }, (value) =>
      edit({ unit: emptyToNull(value) }),
    ),
    textCell(
      row.allowedValues ?? '',
      { ariaLabel: `${index + 1} 行目の許容値`, invalid: invalid('allowedValues') },
      (value) => edit({ allowedValues: emptyToNull(value) }),
    ),
    el('td', { className: 'schema__row-required' }, [requiredCheckbox]),
    el('td', {}, [instruction]),
    textCell(row.example ?? '', { ariaLabel: `${index + 1} 行目の例` }, (value) =>
      edit({ example: emptyToNull(value) }),
    ),
    el('td', {}, [removeButton]),
  ]);
}

/** 編集中: 表形式エディタ + 検証エラー + プリセット挿入 + 版として確定 */
function renderEditor(
  rows: readonly SchemaEditorRow[],
  schema: SchemaState,
  ctx: ViewContext,
): HTMLElement {
  const invalidColumns = new Set(
    schema.editorErrors.map((error) => `${error.index}:${error.column}`),
  );

  const header = el('tr', {}, [
    el('th', { text: '#' }),
    el('th', { text: 'section' }),
    el('th', { text: 'field_name' }),
    el('th', { text: 'field_label' }),
    el('th', { text: 'entity_level' }),
    el('th', { text: 'data_type' }),
    el('th', { text: '単位' }),
    el('th', { text: '許容値（| 区切り）' }),
    el('th', { text: '必須' }),
    el('th', { text: '抽出指示' }),
    el('th', { text: '例' }),
    el('th', { text: '操作' }),
  ]);
  const table = el('table', { id: 'schema-editor-table', className: 'schema__table' }, [
    el('thead', {}, [header]),
    el('tbody', {}, rows.map((row, index) => renderEditorRow(row, index, invalidColumns, ctx))),
  ]);

  const addRowButton = el('button', {
    id: 'schema-add-row',
    text: '行を追加',
    attributes: { type: 'button' },
  });
  addRowButton.addEventListener('click', () => ctx.schema.onAddRow());
  const presetBinary = el('button', {
    id: 'schema-preset-binary',
    text: '二値アウトカムのプリセットを挿入',
    attributes: { type: 'button' },
  });
  presetBinary.addEventListener('click', () => ctx.schema.onInsertPreset('binary'));
  const presetContinuous = el('button', {
    id: 'schema-preset-continuous',
    text: '連続アウトカムのプリセットを挿入',
    attributes: { type: 'button' },
  });
  presetContinuous.addEventListener('click', () => ctx.schema.onInsertPreset('continuous'));
  const presetRob2 = el('button', {
    id: 'schema-preset-rob2',
    text: 'RoB 2 テンプレートを挿入',
    attributes: { type: 'button' },
  });
  presetRob2.addEventListener('click', () => ctx.schema.onInsertPreset('rob2'));
  const presetRob2Sq = el('button', {
    id: 'schema-preset-rob2-sq',
    text: 'RoB 2（SQ 完全版）テンプレートを挿入',
    attributes: { type: 'button' },
  });
  presetRob2Sq.addEventListener('click', () => ctx.schema.onInsertPreset('rob2_sq'));
  const presetRobinsI = el('button', {
    id: 'schema-preset-robins-i',
    text: 'ROBINS-I テンプレートを挿入',
    attributes: { type: 'button' },
  });
  presetRobinsI.addEventListener('click', () => ctx.schema.onInsertPreset('robins_i'));
  const presetRobinsISq = el('button', {
    id: 'schema-preset-robins-i-sq',
    text: 'ROBINS-I（SQ 完全版）テンプレートを挿入',
    attributes: { type: 'button' },
  });
  presetRobinsISq.addEventListener('click', () => ctx.schema.onInsertPreset('robins_i_sq'));

  const errorItems = schema.editorErrors.map((error) =>
    el('li', {
      text: `${error.index + 1} 行目 ${ERROR_COLUMN_LABELS[error.column]}: ${error.message}`,
    }),
  );

  const noteInput = el('input', {
    id: 'schema-note',
    className: 'schema__note-input',
    attributes: {
      type: 'text',
      placeholder: '改訂理由（任意。例: パイロットで単位の揺れが判明）',
      'aria-label': '改訂理由',
    },
  });
  const confirmButton = el('button', {
    id: 'schema-confirm',
    className: 'schema__primary schema__confirm',
    text: schema.confirming ? '確定しています…' : '版として確定',
    attributes: { type: 'button' },
  });
  confirmButton.disabled = schema.confirming || schema.editorErrors.length > 0;
  confirmButton.addEventListener('click', () => ctx.schema.onConfirm(noteInput.value));
  const cancelButton = el('button', {
    id: 'schema-editor-cancel',
    text: 'キャンセル',
    attributes: { type: 'button' },
  });
  cancelButton.disabled = schema.confirming;
  cancelButton.addEventListener('click', () => ctx.schema.onCancelEditor());

  const dataTypeHelp = el('div', { id: 'schema-datatype-help', className: 'schema__datatype-help' }, [
    el('span', { className: 'schema__datatype-help-title', text: 'data_type の種類:' }),
    el(
      'ul',
      { className: 'schema__datatype-help-list' },
      DATA_TYPES.map((type) =>
        el('li', {}, [el('code', { text: type }), ` = ${DATA_TYPE_DESCRIPTIONS[type]}`]),
      ),
    ),
  ]);

  const children: HTMLElement[] = [
    el('h3', { text: `表のデザイン編集（${rows.length} 項目）` }),
    el('div', { className: 'schema__editor-actions' }, [
      addRowButton,
      presetBinary,
      presetContinuous,
      presetRob2,
      presetRob2Sq,
      presetRobinsI,
      presetRobinsISq,
    ]),
    dataTypeHelp,
    el('div', { className: 'schema__table-wrap' }, [table]),
  ];
  if (errorItems.length > 0) {
    children.push(
      el('ul', { id: 'schema-editor-errors', className: 'schema__editor-errors' }, errorItems),
    );
  }
  children.push(
    el('p', {
      id: 'schema-confirm-error',
      className: 'schema__error',
      text: schema.draftError ?? '',
      attributes: { 'aria-live': 'polite' },
    }),
    el('div', { className: 'schema__actions' }, [noteInput, confirmButton, cancelButton]),
  );
  return el('div', { id: 'schema-editor', className: 'schema__editor' }, children);
}

function renderCurrentFieldRow(field: SchemaField): HTMLElement {
  return el('tr', {}, [
    el('td', { text: String(field.fieldIndex) }),
    el('td', { text: field.section }),
    el('td', { text: field.fieldName }),
    el('td', { text: field.fieldLabel }),
    el('td', { text: field.entityLevel }),
    el('td', { text: field.dataType }),
    el('td', { text: field.required ? '必須' : '—' }),
  ]);
}

/** 確定済み: 現行版の読み取り専用サマリ + 版履歴 + 「新しい版を作る」 */
function renderConfirmed(
  latest: SchemaVersion,
  versions: readonly SchemaVersion[],
  schema: SchemaState,
  ctx: ViewContext,
): HTMLElement {
  const fields = schema.currentFields ?? [];

  const children: HTMLElement[] = [];
  const meta =
    `現行版: v${latest.schemaVersion}（${CREATED_BY_TYPE_LABELS[latest.createdByType]} / ` +
    `Protocol v${latest.protocolVersion} 依拠 / ${latest.createdAt} / ${latest.createdBy}）`;
  children.push(
    el('p', { id: 'schema-current-meta', className: 'schema__current-meta', text: meta }),
  );
  if (latest.note !== null) {
    children.push(el('p', { className: 'schema__current-note', text: `改訂理由: ${latest.note}` }));
  }

  const header = el('tr', {}, [
    el('th', { text: '#' }),
    el('th', { text: 'section' }),
    el('th', { text: 'field_name' }),
    el('th', { text: 'field_label' }),
    el('th', { text: 'entity_level' }),
    el('th', { text: 'data_type' }),
    el('th', { text: '必須' }),
  ]);
  children.push(
    el('div', { className: 'schema__table-wrap' }, [
      el('table', { id: 'schema-current-table', className: 'schema__table' }, [
        el('thead', {}, [header]),
        el('tbody', {}, fields.map(renderCurrentFieldRow)),
      ]),
    ]),
  );

  const newVersionButton = el('button', {
    id: 'schema-new-version',
    className: 'schema__primary',
    text: '新しい版を作る(現行版から編集)',
    attributes: { type: 'button' },
  });
  newVersionButton.addEventListener('click', () => ctx.schema.onStartNewVersion());
  children.push(el('div', { className: 'schema__actions' }, [newVersionButton, reloadButton(ctx)]));

  if (versions.length > 1) {
    const items = versions.map((version) =>
      el('li', {
        text:
          `v${version.schemaVersion}(${CREATED_BY_TYPE_LABELS[version.createdByType]} / ` +
          `${version.createdAt}${version.parentVersion === null ? '' : ` / v${version.parentVersion} から派生`})`,
      }),
    );
    children.push(
      el('div', { className: 'schema__history' }, [
        el('h3', { text: '版履歴' }),
        el('ul', { id: 'schema-history', className: 'schema__history-list' }, items),
      ]),
    );
  }

  return el('div', { id: 'schema-confirmed', className: 'schema__confirmed' }, children);
}

function renderBody(state: AppState, ctx: ViewContext): HTMLElement {
  const { schema } = state;
  if (schema.loadError !== null) {
    return el('div', {}, [
      el('p', {
        id: 'schema-load-error',
        className: 'schema__error',
        text: `表のデザインを読み込めませんでした: ${schema.loadError}`,
      }),
      el('div', { className: 'schema__actions' }, [reloadButton(ctx)]),
    ]);
  }
  if (schema.versions === null || schema.loading) {
    return el('p', { id: 'schema-loading', text: '表のデザインを読み込んでいます…' });
  }
  if (schema.drafting) {
    return renderDraftProgress(schema);
  }
  if (schema.editorRows !== null) {
    return renderEditor(schema.editorRows, schema, ctx);
  }
  const latest = schema.versions[0];
  if (latest === undefined) {
    return renderDraftForm(state, ctx);
  }
  return renderConfirmed(latest, schema.versions, schema, ctx);
}

export function renderSchemaView(state: AppState, ctx: ViewContext): HTMLElement {
  const children: HTMLElement[] = [
    el('h2', { text: '表のデザイン' }),
    el('p', {
      className: 'view__lead',
      text:
        '抽出したい項目のリストをこのページで作成します。スプレッドシートでいえば 1 行目の見出し' +
        '（列の名前）にあたります。例:「著者名」「出版年」「対象患者数」など。これを設計する工程を' +
        '表のデザインと呼んでいます。',
    }),
  ];
  if (state.currentProject === null) {
    children.push(
      el('p', {
        id: 'schema-no-project',
        className: 'view__notice',
        text: '先にプロジェクトを選択してください（Popup から作成 / 選択できます）。',
      }),
    );
  } else {
    children.push(renderBody(state, ctx));
  }
  return el('section', { className: 'view view--schema' }, children);
}
