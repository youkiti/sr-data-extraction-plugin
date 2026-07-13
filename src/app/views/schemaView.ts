// #/schema: スキーマデザイン（S5 / ui-states.md §3）。
// 状態: プロジェクト未選択 / 読み込み中 / 失敗 / ドラフト前（サンプル論文セレクタ + モデル入力）/
// ドラフト生成中（経過時間は store 管理）/ 編集中（表形式エディタ + 検証エラー +
// RoB プリセット事前設定ダイアログ〔issue #103〕）/
// 確定済み（現行版サマリ + 版履歴 + 新しい版を作る）。
// データは AppState.schema（schemaService が更新）から描く
import type { EntityLevel, FieldDataType, SchemaField } from '../../domain/schemaField';
import type { SchemaVersion } from '../../domain/schemaVersion';
import type { PresetDialogState } from '../../features/schema/presets/prespecDialog';
import type { Quadas3PrespecDialogState } from '../../features/schema/presets/quadas3Prespec';
import type { QuipsPrespecDialogState } from '../../features/schema/presets/quipsPrespec';
import type {
  Rob2Effect,
  RobPrespecDialogState,
} from '../../features/schema/presets/robPrespec';
import { toggleDeviationType } from '../../features/schema/presets/robPrespec';
import type {
  RobinsIBenefitHarm,
  RobinsIPrespecDialogState,
} from '../../features/schema/presets/robinsIPrespec';
import type {
  Rob2DeviationType,
  RobinsIEffect,
} from '../../features/schema/presets/robTemplates';
import type { SchemaEditorRow } from '../../features/schema/types';
import type { FieldValidationError } from '../../features/schema/validateField';
import { t, type MessageKey } from '../../lib/i18n';
import { el } from '../ui/dom';
import { createModelSelect } from '../ui/modelSelect';
import type { AppState, SchemaState } from '../store';
import type { ViewContext } from './types';

const ENTITY_LEVELS: readonly EntityLevel[] = ['study', 'arm', 'outcome_result', 'rob_domain'];
const DATA_TYPES: readonly FieldDataType[] = ['text', 'integer', 'float', 'boolean', 'enum', 'date'];

// 表示言語に追従させるため、ラベルは描画時に t() で解決する（キー対応表のみ固定。issue #93）
/** data_type 列の凡例（表形式エディタのボタン下に常時表示） */
const DATA_TYPE_DESCRIPTION_KEYS: Record<FieldDataType, MessageKey> = {
  text: 'schema.dataTypeText',
  integer: 'schema.dataTypeInteger',
  float: 'schema.dataTypeFloat',
  boolean: 'schema.dataTypeBoolean',
  enum: 'schema.dataTypeEnum',
  date: 'schema.dataTypeDate',
};

const CREATED_BY_TYPE_LABEL_KEYS: Record<SchemaVersion['createdByType'], MessageKey> = {
  ai_draft: 'schema.createdByAiDraft',
  user_edit: 'schema.createdByUserEdit',
  pilot_revision: 'schema.createdByPilotRevision',
};

/** 検証エラーの列名（field_name 等のコード用語はそのまま。和名列だけ翻訳する） */
function errorColumnLabel(column: FieldValidationError['column']): string {
  const keys: Partial<Record<FieldValidationError['column'], MessageKey>> = {
    allowedValues: 'schema.colAllowedValues',
    extractionInstruction: 'schema.colExtractionInstruction',
  };
  const literals: Partial<Record<FieldValidationError['column'], string>> = {
    fieldName: 'field_name',
    fieldLabel: 'field_label',
    section: 'section',
  };
  const key = keys[column];
  return key !== undefined ? t(key) : (literals[column] as string);
}

function reloadButton(ctx: ViewContext): HTMLButtonElement {
  const button = el('button', {
    id: 'schema-reload',
    text: t('common.reload'),
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
    el('h3', { text: t('schema.draftTitle') }),
    el('p', {
      className: 'view__lead',
      text: t('schema.draftLead'),
    }),
  ];

  if (records === null) {
    children.push(el('p', { id: 'schema-documents-loading', text: t('schema.documentsLoading') }));
  } else if (records.length === 0) {
    children.push(
      el('p', {
        id: 'schema-documents-empty',
        text: t('schema.documentsEmpty'),
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
          el('small', { className: 'schema__sample-note', text: t('schema.sampleNoTextLayer') }),
        );
      }
      return el('li', {}, [el('label', { className: 'schema__sample-option' }, labelChildren)]);
    });
    children.push(
      el('fieldset', { className: 'schema__samples' }, [
        el('legend', { text: t('schema.samplesLegend', { count: selectedDocumentIds.length }) }),
        el('ul', { id: 'schema-sample-list', className: 'schema__sample-list' }, items),
      ]),
    );
  }

  const modelSelect = createModelSelect(document, {
    id: 'schema-model',
    ariaLabel: t('schema.modelAria'),
    value: model,
    placeholderLabel: t('schema.modelPlaceholder'),
    onChange: (value) => ctx.schema.onChangeModel(value),
    className: 'schema__model-input',
  });
  children.push(
    el('div', { className: 'schema__field' }, [
      el('label', { text: t('schema.modelLabel'), attributes: { for: 'schema-model' } }),
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
    text: t('schema.draftTitle'),
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
    text: t('schema.draftProgress', { seconds: schema.draftElapsedSeconds }),
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
    attributes: { type: 'checkbox', 'aria-label': t('schema.rowRequiredAria', { row: index + 1 }) },
  });
  requiredCheckbox.checked = row.required;
  requiredCheckbox.addEventListener('change', () => edit({ required: requiredCheckbox.checked }));

  const instruction = el('textarea', {
    className: 'schema__cell-instruction',
    attributes: { rows: '2', 'aria-label': t('schema.rowInstructionAria', { row: index + 1 }) },
  });
  instruction.value = row.extractionInstruction;
  if (invalid('extractionInstruction')) {
    instruction.setAttribute('aria-invalid', 'true');
    instruction.classList.add('schema__cell-input--error');
  }
  instruction.addEventListener('change', () => edit({ extractionInstruction: instruction.value }));

  const removeButton = el('button', {
    className: 'schema__row-remove',
    text: t('schema.rowRemove'),
    attributes: { type: 'button', 'aria-label': t('schema.rowRemoveAria', { row: index + 1 }) },
  });
  removeButton.addEventListener('click', () => ctx.schema.onRemoveRow(index));

  return el('tr', {}, [
    el('td', { className: 'schema__row-index', text: String(index + 1) }),
    textCell(
      row.section,
      { ariaLabel: t('schema.rowSectionAria', { row: index + 1 }), invalid: invalid('section') },
      (value) => edit({ section: value }),
    ),
    textCell(
      row.fieldName,
      { ariaLabel: t('schema.rowFieldNameAria', { row: index + 1 }), invalid: invalid('fieldName') },
      (value) => edit({ fieldName: value }),
    ),
    textCell(
      row.fieldLabel,
      { ariaLabel: t('schema.rowFieldLabelAria', { row: index + 1 }), invalid: invalid('fieldLabel') },
      (value) => edit({ fieldLabel: value }),
    ),
    selectCell(ENTITY_LEVELS, row.entityLevel, t('schema.rowEntityLevelAria', { row: index + 1 }), (value) =>
      edit({ entityLevel: value as EntityLevel }),
    ),
    selectCell(DATA_TYPES, row.dataType, t('schema.rowDataTypeAria', { row: index + 1 }), (value) =>
      edit({ dataType: value as FieldDataType }),
    ),
    textCell(row.unit ?? '', { ariaLabel: t('schema.rowUnitAria', { row: index + 1 }) }, (value) =>
      edit({ unit: emptyToNull(value) }),
    ),
    textCell(
      row.allowedValues ?? '',
      { ariaLabel: t('schema.rowAllowedValuesAria', { row: index + 1 }), invalid: invalid('allowedValues') },
      (value) => edit({ allowedValues: emptyToNull(value) }),
    ),
    el('td', { className: 'schema__row-required' }, [requiredCheckbox]),
    el('td', {}, [instruction]),
    textCell(row.example ?? '', { ariaLabel: t('schema.rowExampleAria', { row: index + 1 }) }, (value) =>
      edit({ example: emptyToNull(value) }),
    ),
    el('td', {}, [removeButton]),
  ]);
}

/** deviation 種別チェックボックスの表示定義（公式 template の列挙順・原文併記） */
const DEVIATION_CHECKBOXES: readonly {
  id: string;
  type: Rob2DeviationType;
  labelKey: MessageKey;
}[] = [
  {
    id: 'schema-prespec-dev-non-protocol',
    type: 'non_protocol_interventions',
    labelKey: 'schema.prespecDevNonProtocol',
  },
  {
    id: 'schema-prespec-dev-implementation',
    type: 'implementation_failures',
    labelKey: 'schema.prespecDevImplementation',
  },
  {
    id: 'schema-prespec-dev-non-adherence',
    type: 'non_adherence',
    labelKey: 'schema.prespecDevNonAdherence',
  },
];

/** ダイアログ共通: テキスト入力（label + input。change で patch を送る） */
function prespecTextField(
  id: string,
  label: string,
  value: string,
  onCommit: (value: string) => void,
): HTMLElement {
  const input = el('input', {
    id,
    attributes: { type: 'text', 'aria-label': label },
  }) as HTMLInputElement;
  input.value = value;
  input.addEventListener('change', () => onCommit(input.value));
  return el('label', { className: 'schema__prespec-field' }, [el('span', { text: label }), input]);
}

/** ダイアログ共通: 複数行リスト入力（1 行 1 項目の textarea。change で patch を送る） */
function prespecListField(
  id: string,
  label: string,
  value: string,
  onCommit: (value: string) => void,
): HTMLElement {
  const input = el('textarea', {
    id,
    className: 'schema__prespec-list',
    attributes: { rows: '3', 'aria-label': label },
  }) as HTMLTextAreaElement;
  input.value = value;
  input.addEventListener('change', () => onCommit(input.value));
  return el('label', { className: 'schema__prespec-field' }, [el('span', { text: label }), input]);
}

/** ダイアログ共通: ラジオ 1 個（checked のときだけ onSelect を発火する） */
function prespecRadio(
  id: string,
  name: string,
  checked: boolean,
  label: string,
  onSelect: () => void,
): HTMLElement {
  const input = el('input', { id, attributes: { type: 'radio', name } }) as HTMLInputElement;
  input.checked = checked;
  input.addEventListener('change', () => {
    if (input.checked) {
      onSelect();
    }
  });
  return el('label', { className: 'schema__prespec-radio' }, [input, label]);
}

/** ダイアログ共通: 検証エラー表示 + 操作ボタン（確定 / スキップ〔軽量版のみ〕/ キャンセル）を追加する */
function appendPrespecFooter(
  children: HTMLElement[],
  error: string | null,
  showSkip: boolean,
  ctx: ViewContext,
): void {
  if (error !== null) {
    children.push(
      el('p', {
        id: 'schema-prespec-error',
        className: 'schema__error',
        attributes: { role: 'alert' },
        text: error,
      }),
    );
  }
  const confirmButton = el('button', {
    id: 'schema-prespec-confirm',
    className: 'schema__primary',
    text: t('schema.prespecConfirm'),
    attributes: { type: 'button' },
  });
  confirmButton.addEventListener('click', () => ctx.schema.onConfirmPresetDialog());
  const actions: HTMLElement[] = [confirmButton];
  if (showSkip) {
    const skipButton = el('button', {
      id: 'schema-prespec-skip',
      text: t('schema.prespecSkip'),
      attributes: { type: 'button' },
    });
    skipButton.addEventListener('click', () => ctx.schema.onSkipPresetDialog());
    actions.push(skipButton);
  }
  const cancelButton = el('button', {
    id: 'schema-prespec-cancel',
    text: t('common.cancel'),
    attributes: { type: 'button' },
  });
  cancelButton.addEventListener('click', () => ctx.schema.onCancelPresetDialog());
  actions.push(cancelButton);
  children.push(el('div', { className: 'schema__prespec-actions' }, actions));
}

/** ダイアログ共通: role=dialog のコンテナ */
function prespecDialogContainer(children: HTMLElement[]): HTMLElement {
  return el(
    'div',
    {
      id: 'schema-preset-dialog',
      className: 'schema__preset-dialog',
      attributes: { role: 'dialog', 'aria-labelledby': 'schema-preset-dialog-title' },
    },
    children,
  );
}

/**
 * RoB 2 の事前設定ダイアログ（issue #103 PR1。ui-states.md §3「プリセット事前設定ダイアログ」）。
 * rob2（軽量版）= 全項目任意 + 「スキップして挿入」あり / rob2_sq = effect of interest 必須。
 * ラベル・説明は表示言語（t()）、注入される Review context は英語（robPrespec.ts が生成）
 */
function renderRob2PresetDialog(dialog: RobPrespecDialogState, ctx: ViewContext): HTMLElement {
  const isSq = dialog.kind === 'rob2_sq';

  const textField = (
    id: string,
    label: string,
    value: string,
    key: 'experimental' | 'comparator' | 'outcome' | 'numericalResult',
  ): HTMLElement =>
    prespecTextField(id, label, value, (next) => ctx.schema.onUpdatePresetDialog({ [key]: next }));

  const effectRadio = (id: string, value: Rob2Effect | null, label: string): HTMLElement =>
    prespecRadio(id, 'schema-prespec-effect', dialog.effect === value, label, () =>
      ctx.schema.onUpdatePresetDialog({ effect: value }),
    );

  const children: HTMLElement[] = [
    el('h3', {
      id: 'schema-preset-dialog-title',
      text: isSq ? t('schema.prespecTitleSq') : t('schema.prespecTitle'),
    }),
    el('p', {
      className: 'view__lead',
      text: isSq ? t('schema.prespecLeadSq') : t('schema.prespecLead'),
    }),
    el('p', {
      id: 'schema-prespec-design',
      className: 'schema__prespec-design',
      text: t('schema.prespecDesign'),
    }),
    textField(
      'schema-prespec-experimental',
      t('schema.prespecExperimental'),
      dialog.experimental,
      'experimental',
    ),
    textField(
      'schema-prespec-comparator',
      t('schema.prespecComparator'),
      dialog.comparator,
      'comparator',
    ),
    textField(
      'schema-prespec-outcome',
      t('schema.prespecOutcome'),
      dialog.outcome,
      'outcome',
    ),
    textField(
      'schema-prespec-numerical-result',
      t('schema.prespecNumericalResult'),
      dialog.numericalResult,
      'numericalResult',
    ),
  ];

  const effectRadios: HTMLElement[] = [];
  if (!isSq) {
    effectRadios.push(effectRadio('schema-prespec-effect-none', null, t('schema.prespecEffectNone')));
  }
  effectRadios.push(
    effectRadio(
      'schema-prespec-effect-assignment',
      'assignment',
      t('schema.prespecEffectAssignment'),
    ),
    effectRadio(
      'schema-prespec-effect-adhering',
      'adhering',
      t('schema.prespecEffectAdhering'),
    ),
  );
  children.push(
    el('fieldset', { className: 'schema__prespec-effect' }, [
      el('legend', { text: isSq ? t('schema.prespecEffectLegendRequired') : t('schema.prespecEffectLegendOptional') }),
      ...effectRadios,
    ]),
  );

  if (dialog.effect === 'adhering') {
    const checkboxes = DEVIATION_CHECKBOXES.map((def) => {
      const checkbox = el('input', {
        id: def.id,
        attributes: { type: 'checkbox' },
      }) as HTMLInputElement;
      checkbox.checked = dialog.deviationTypes.includes(def.type);
      checkbox.addEventListener('change', () =>
        ctx.schema.onUpdatePresetDialog({
          deviationTypes: toggleDeviationType(dialog.deviationTypes, def.type, checkbox.checked),
        }),
      );
      return el('label', { className: 'schema__prespec-checkbox' }, [checkbox, t(def.labelKey)]);
    });
    children.push(
      el('fieldset', { id: 'schema-prespec-deviations', className: 'schema__prespec-deviations' }, [
        el('legend', { text: t('schema.prespecDeviationsLegend') }),
        ...checkboxes,
      ]),
    );
  }

  appendPrespecFooter(children, dialog.error, !isSq, ctx);
  return prespecDialogContainer(children);
}

/**
 * ROBINS-I の事前設定ダイアログ（issue #103 PR2。ui-states.md §3「プリセット事前設定ダイアログ」）。
 * robins_i（軽量版）= 全項目任意 + 「スキップして挿入」あり / robins_i_sq = effect of interest 必須
 * （選択で D4 の SQ セットが排他的に切り替わる）。target trial・outcome + benefit/harm・
 * confounding domains / co-interventions リスト（1 行 1 項目）を任意入力できる
 */
function renderRobinsIPresetDialog(
  dialog: RobinsIPrespecDialogState,
  ctx: ViewContext,
): HTMLElement {
  const isSq = dialog.kind === 'robins_i_sq';

  const textField = (
    id: string,
    label: string,
    value: string,
    key: 'design' | 'participants' | 'experimental' | 'comparator' | 'outcome',
  ): HTMLElement =>
    prespecTextField(id, label, value, (next) => ctx.schema.onUpdatePresetDialog({ [key]: next }));

  const effectRadio = (id: string, value: RobinsIEffect | null, label: string): HTMLElement =>
    prespecRadio(id, 'schema-prespec-ri-effect', dialog.effect === value, label, () =>
      ctx.schema.onUpdatePresetDialog({ effect: value }),
    );

  const benefitHarmRadio = (
    id: string,
    value: RobinsIBenefitHarm | null,
    label: string,
  ): HTMLElement =>
    prespecRadio(id, 'schema-prespec-ri-benefit-harm', dialog.benefitHarm === value, label, () =>
      ctx.schema.onUpdatePresetDialog({ benefitHarm: value }),
    );

  const children: HTMLElement[] = [
    el('h3', {
      id: 'schema-preset-dialog-title',
      text: isSq ? t('schema.prespecRobinsITitleSq') : t('schema.prespecRobinsITitle'),
    }),
    el('p', {
      className: 'view__lead',
      text: isSq ? t('schema.prespecRobinsILeadSq') : t('schema.prespecRobinsILead'),
    }),
    textField('schema-prespec-ri-design', t('schema.prespecRobinsIDesign'), dialog.design, 'design'),
    textField(
      'schema-prespec-ri-participants',
      t('schema.prespecRobinsIParticipants'),
      dialog.participants,
      'participants',
    ),
    textField(
      'schema-prespec-ri-experimental',
      t('schema.prespecRobinsIExperimental'),
      dialog.experimental,
      'experimental',
    ),
    textField(
      'schema-prespec-ri-comparator',
      t('schema.prespecRobinsIComparator'),
      dialog.comparator,
      'comparator',
    ),
    textField(
      'schema-prespec-ri-outcome',
      t('schema.prespecRobinsIOutcome'),
      dialog.outcome,
      'outcome',
    ),
    el('fieldset', { className: 'schema__prespec-effect' }, [
      el('legend', { text: t('schema.prespecBenefitHarmLegend') }),
      benefitHarmRadio('schema-prespec-ri-bh-none', null, t('schema.prespecEffectNone')),
      benefitHarmRadio(
        'schema-prespec-ri-bh-benefit',
        'benefit',
        t('schema.prespecBenefitHarmBenefit'),
      ),
      benefitHarmRadio('schema-prespec-ri-bh-harm', 'harm', t('schema.prespecBenefitHarmHarm')),
    ]),
  ];

  const effectRadios: HTMLElement[] = [];
  if (!isSq) {
    effectRadios.push(
      effectRadio('schema-prespec-ri-effect-none', null, t('schema.prespecEffectNone')),
    );
  }
  effectRadios.push(
    effectRadio(
      'schema-prespec-ri-effect-assignment',
      'assignment',
      t('schema.prespecRobinsIEffectAssignment'),
    ),
    effectRadio(
      'schema-prespec-ri-effect-adhering',
      'starting_adhering',
      t('schema.prespecRobinsIEffectStartingAdhering'),
    ),
  );
  children.push(
    el('fieldset', { className: 'schema__prespec-effect' }, [
      el('legend', {
        text: isSq
          ? t('schema.prespecEffectLegendRequired')
          : t('schema.prespecEffectLegendOptional'),
      }),
      ...effectRadios,
    ]),
    prespecListField(
      'schema-prespec-ri-confounders',
      t('schema.prespecRobinsIConfounders'),
      dialog.confoundingDomains,
      (next) => ctx.schema.onUpdatePresetDialog({ confoundingDomains: next }),
    ),
    prespecListField(
      'schema-prespec-ri-cointerventions',
      t('schema.prespecRobinsICoInterventions'),
      dialog.coInterventions,
      (next) => ctx.schema.onUpdatePresetDialog({ coInterventions: next }),
    ),
  );

  appendPrespecFooter(children, dialog.error, !isSq, ctx);
  return prespecDialogContainer(children);
}

/**
 * QUADAS-3 の事前設定ダイアログ（issue #103 PR3）。Phase 1（synthesis question）+
 * Phase 2（ideal test accuracy trial の主要 component）を全項目任意で入力できる
 * （Phase 3〜4 は issue #109 のスコープ）。スキップ・全項目未入力は従来と同一の行
 */
function renderQuadas3PresetDialog(
  dialog: Quadas3PrespecDialogState,
  ctx: ViewContext,
): HTMLElement {
  const textField = (
    id: string,
    label: string,
    value: string,
    key:
      | 'population'
      | 'indexTest'
      | 'targetCondition'
      | 'intendedUsePopulation'
      | 'testRole'
      | 'referenceStandard'
      | 'analysisUnit',
  ): HTMLElement =>
    prespecTextField(id, label, value, (next) => ctx.schema.onUpdatePresetDialog({ [key]: next }));

  const children: HTMLElement[] = [
    el('h3', {
      id: 'schema-preset-dialog-title',
      text: t('schema.prespecQuadas3Title'),
    }),
    el('p', { className: 'view__lead', text: t('schema.prespecQuadas3Lead') }),
    textField(
      'schema-prespec-q3-population',
      t('schema.prespecQuadas3Population'),
      dialog.population,
      'population',
    ),
    textField(
      'schema-prespec-q3-index-test',
      t('schema.prespecQuadas3IndexTest'),
      dialog.indexTest,
      'indexTest',
    ),
    textField(
      'schema-prespec-q3-target-condition',
      t('schema.prespecQuadas3TargetCondition'),
      dialog.targetCondition,
      'targetCondition',
    ),
    textField(
      'schema-prespec-q3-intended-use',
      t('schema.prespecQuadas3IntendedUse'),
      dialog.intendedUsePopulation,
      'intendedUsePopulation',
    ),
    textField(
      'schema-prespec-q3-test-role',
      t('schema.prespecQuadas3TestRole'),
      dialog.testRole,
      'testRole',
    ),
    textField(
      'schema-prespec-q3-reference-standard',
      t('schema.prespecQuadas3ReferenceStandard'),
      dialog.referenceStandard,
      'referenceStandard',
    ),
    textField(
      'schema-prespec-q3-analysis-unit',
      t('schema.prespecQuadas3AnalysisUnit'),
      dialog.analysisUnit,
      'analysisUnit',
    ),
  ];

  appendPrespecFooter(children, dialog.error, true, ctx);
  return prespecDialogContainer(children);
}

/**
 * QUIPS の事前設定ダイアログ（issue #103 PR3）。原典に形式的な事前設定フェーズは無いが、
 * item 本文が参照する review 固有の定義（population / PF / outcome / LIST）を全項目任意で
 * 入力できる。スキップ・全項目未入力は従来と同一の行
 */
function renderQuipsPresetDialog(dialog: QuipsPrespecDialogState, ctx: ViewContext): HTMLElement {
  const children: HTMLElement[] = [
    el('h3', {
      id: 'schema-preset-dialog-title',
      text: t('schema.prespecQuipsTitle'),
    }),
    el('p', { className: 'view__lead', text: t('schema.prespecQuipsLead') }),
    prespecTextField(
      'schema-prespec-quips-population',
      t('schema.prespecQuipsPopulation'),
      dialog.population,
      (next) => ctx.schema.onUpdatePresetDialog({ population: next }),
    ),
    prespecTextField(
      'schema-prespec-quips-pf',
      t('schema.prespecQuipsPf'),
      dialog.prognosticFactor,
      (next) => ctx.schema.onUpdatePresetDialog({ prognosticFactor: next }),
    ),
    prespecTextField(
      'schema-prespec-quips-outcome',
      t('schema.prespecQuipsOutcome'),
      dialog.outcome,
      (next) => ctx.schema.onUpdatePresetDialog({ outcome: next }),
    ),
    prespecListField(
      'schema-prespec-quips-key-characteristics',
      t('schema.prespecQuipsKeyCharacteristics'),
      dialog.keyCharacteristics,
      (next) => ctx.schema.onUpdatePresetDialog({ keyCharacteristics: next }),
    ),
    prespecListField(
      'schema-prespec-quips-confounders',
      t('schema.prespecQuipsConfounders'),
      dialog.importantConfounders,
      (next) => ctx.schema.onUpdatePresetDialog({ importantConfounders: next }),
    ),
  ];

  appendPrespecFooter(children, dialog.error, true, ctx);
  return prespecDialogContainer(children);
}

/** プリセット事前設定ダイアログ（issue #103）: kind に応じてツール別レンダラへ振り分ける */
function renderPresetDialog(dialog: PresetDialogState, ctx: ViewContext): HTMLElement {
  switch (dialog.kind) {
    case 'rob2':
    case 'rob2_sq':
      return renderRob2PresetDialog(dialog, ctx);
    case 'robins_i':
    case 'robins_i_sq':
      return renderRobinsIPresetDialog(dialog, ctx);
    case 'quadas3':
      return renderQuadas3PresetDialog(dialog, ctx);
    case 'quips':
      return renderQuipsPresetDialog(dialog, ctx);
  }
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
    el('th', { text: t('schema.headUnit') }),
    el('th', { text: t('schema.headAllowedValues') }),
    el('th', { text: t('schema.headRequired') }),
    el('th', { text: t('schema.headInstruction') }),
    el('th', { text: t('schema.headExample') }),
    el('th', { text: t('schema.headActions') }),
  ]);
  const table = el('table', { id: 'schema-editor-table', className: 'schema__table' }, [
    el('thead', {}, [header]),
    el('tbody', {}, rows.map((row, index) => renderEditorRow(row, index, invalidColumns, ctx))),
  ]);

  const addRowButton = el('button', {
    id: 'schema-add-row',
    text: t('schema.addRow'),
    attributes: { type: 'button' },
  });
  addRowButton.addEventListener('click', () => ctx.schema.onAddRow());
  const presetBinary = el('button', {
    id: 'schema-preset-binary',
    text: t('schema.presetBinary'),
    attributes: { type: 'button' },
  });
  presetBinary.addEventListener('click', () => ctx.schema.onInsertPreset('binary'));
  const presetContinuous = el('button', {
    id: 'schema-preset-continuous',
    text: t('schema.presetContinuous'),
    attributes: { type: 'button' },
  });
  presetContinuous.addEventListener('click', () => ctx.schema.onInsertPreset('continuous'));
  const presetRob2 = el('button', {
    id: 'schema-preset-rob2',
    text: t('schema.presetRob2'),
    attributes: { type: 'button' },
  });
  presetRob2.addEventListener('click', () => ctx.schema.onInsertPreset('rob2'));
  const presetRob2Sq = el('button', {
    id: 'schema-preset-rob2-sq',
    text: t('schema.presetRob2Sq'),
    attributes: { type: 'button' },
  });
  presetRob2Sq.addEventListener('click', () => ctx.schema.onInsertPreset('rob2_sq'));
  const presetRobinsI = el('button', {
    id: 'schema-preset-robins-i',
    text: t('schema.presetRobinsI'),
    attributes: { type: 'button' },
  });
  presetRobinsI.addEventListener('click', () => ctx.schema.onInsertPreset('robins_i'));
  const presetRobinsISq = el('button', {
    id: 'schema-preset-robins-i-sq',
    text: t('schema.presetRobinsISq'),
    attributes: { type: 'button' },
  });
  presetRobinsISq.addEventListener('click', () => ctx.schema.onInsertPreset('robins_i_sq'));
  const presetQuadas3 = el('button', {
    id: 'schema-preset-quadas3',
    text: t('schema.presetQuadas3'),
    attributes: { type: 'button' },
  });
  presetQuadas3.addEventListener('click', () => ctx.schema.onInsertPreset('quadas3'));
  const presetQuips = el('button', {
    id: 'schema-preset-quips',
    text: t('schema.presetQuips'),
    attributes: { type: 'button' },
  });
  presetQuips.addEventListener('click', () => ctx.schema.onInsertPreset('quips'));

  const errorItems = schema.editorErrors.map((error) =>
    el('li', {
      text: t('schema.editorError', {
        row: error.index + 1,
        column: errorColumnLabel(error.column),
        message: error.message,
      }),
    }),
  );

  const noteInput = el('input', {
    id: 'schema-note',
    className: 'schema__note-input',
    attributes: {
      type: 'text',
      placeholder: t('schema.notePlaceholder'),
      'aria-label': t('schema.noteAria'),
    },
  });
  const confirmButton = el('button', {
    id: 'schema-confirm',
    className: 'schema__primary schema__confirm',
    text: schema.confirming ? t('schema.confirming') : t('schema.confirm'),
    attributes: { type: 'button' },
  });
  confirmButton.disabled = schema.confirming || schema.editorErrors.length > 0;
  confirmButton.addEventListener('click', () => ctx.schema.onConfirm(noteInput.value));
  const cancelButton = el('button', {
    id: 'schema-editor-cancel',
    text: t('common.cancel'),
    attributes: { type: 'button' },
  });
  cancelButton.disabled = schema.confirming;
  cancelButton.addEventListener('click', () => ctx.schema.onCancelEditor());

  const dataTypeHelp = el('div', { id: 'schema-datatype-help', className: 'schema__datatype-help' }, [
    el('span', { className: 'schema__datatype-help-title', text: t('schema.dataTypeHelpTitle') }),
    el(
      'ul',
      { className: 'schema__datatype-help-list' },
      DATA_TYPES.map((type) =>
        el('li', {}, [el('code', { text: type }), ` = ${t(DATA_TYPE_DESCRIPTION_KEYS[type])}`]),
      ),
    ),
  ]);

  const children: HTMLElement[] = [
    el('h3', { text: t('schema.editorTitle', { count: rows.length }) }),
    el('div', { className: 'schema__editor-actions' }, [
      addRowButton,
      presetBinary,
      presetContinuous,
      presetRob2,
      presetRob2Sq,
      presetRobinsI,
      presetRobinsISq,
      presetQuadas3,
      presetQuips,
    ]),
  ];
  // RoB プリセット事前設定ダイアログ（issue #103）: プリセットボタン直下に挿す
  if (schema.presetDialog !== null) {
    children.push(renderPresetDialog(schema.presetDialog, ctx));
  }
  children.push(dataTypeHelp, el('div', { className: 'schema__table-wrap' }, [table]));
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
    el('td', { text: field.required ? t('schema.requiredYes') : '—' }),
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
  const meta = t('schema.currentMeta', {
    version: latest.schemaVersion,
    createdByType: t(CREATED_BY_TYPE_LABEL_KEYS[latest.createdByType]),
    protocolVersion: latest.protocolVersion,
    createdAt: latest.createdAt,
    createdBy: latest.createdBy,
  });
  children.push(
    el('p', { id: 'schema-current-meta', className: 'schema__current-meta', text: meta }),
  );
  if (latest.note !== null) {
    children.push(el('p', { className: 'schema__current-note', text: t('schema.currentNote', { note: latest.note }) }));
  }

  const header = el('tr', {}, [
    el('th', { text: '#' }),
    el('th', { text: 'section' }),
    el('th', { text: 'field_name' }),
    el('th', { text: 'field_label' }),
    el('th', { text: 'entity_level' }),
    el('th', { text: 'data_type' }),
    el('th', { text: t('schema.headRequired') }),
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
    text: t('schema.newVersion'),
    attributes: { type: 'button' },
  });
  newVersionButton.addEventListener('click', () => ctx.schema.onStartNewVersion());
  children.push(el('div', { className: 'schema__actions' }, [newVersionButton, reloadButton(ctx)]));

  if (versions.length > 1) {
    const items = versions.map((version) =>
      el('li', {
        text:
          `v${version.schemaVersion}(${t(CREATED_BY_TYPE_LABEL_KEYS[version.createdByType])} / ` +
          `${version.createdAt}${
            version.parentVersion === null
              ? ''
              : t('schema.historyDerived', { parent: version.parentVersion })
          })`,
      }),
    );
    children.push(
      el('div', { className: 'schema__history' }, [
        el('h3', { text: t('schema.historyTitle') }),
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
        text: t('schema.loadError', { reason: schema.loadError }),
      }),
      el('div', { className: 'schema__actions' }, [reloadButton(ctx)]),
    ]);
  }
  if (schema.versions === null || schema.loading) {
    return el('p', { id: 'schema-loading', text: t('schema.loading') });
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
    el('h2', { text: t('app.navSchema') }),
    el('p', {
      className: 'view__lead',
      text: t('schema.lead'),
    }),
  ];
  if (state.currentProject === null) {
    children.push(
      el('p', {
        id: 'schema-no-project',
        className: 'view__notice',
        text: t('common.noProject'),
      }),
    );
  } else {
    children.push(renderBody(state, ctx));
  }
  return el('section', { className: 'view view--schema' }, children);
}
