// S6 パイロット / S7 一括抽出の実行前画面に置く抽出対象フィールドのチェックリスト
// （issue #80 案 A: run 単位のフィールド選択）。既定 = 全選択。section 単位で折りたたみでき、
// section 見出しに「全選択 / 全解除」トグルを持つ。#/pilot と #/extract は同時にマウントされない
// ため描画ロジックを共有し、id / class だけ画面別に prefix する
// （renderConflictWarning と同じ「別画面で使い回す」構成）
import type { SchemaField } from '../../domain/schemaField';
import {
  groupFieldsBySection,
  isFieldSelected,
  isSectionFullySelected,
  selectedFieldCount,
  type FieldSelection,
} from '../../features/extraction/fieldSelection';
import { el } from '../ui/dom';

export interface FieldSelectionChecklistProps {
  /** 'extract' | 'pilot'。id / class の prefix */
  idPrefix: string;
  fields: readonly SchemaField[];
  selection: FieldSelection;
  collapsedSections: readonly string[];
  onToggleField(fieldId: string, selected: boolean): void;
  onToggleSection(fieldIds: readonly string[], selected: boolean): void;
  onToggleCollapse(section: string): void;
}

/** 選択 0 件のとき true（呼び出し側の実行ボタン disabled 判定に使う） */
export function hasZeroFieldsSelected(
  selection: FieldSelection,
  fields: readonly SchemaField[],
): boolean {
  return selectedFieldCount(selection, fields.map((field) => field.fieldId)) === 0;
}

/**
 * 「対象項目: n / m」の n/m 部分（全選択時は「全項目（m）」）。チェックリストの全体サマリ行と
 * S7 実行確認カードの両方で同じ文言を使う
 */
export function fieldSelectionSummaryText(
  selection: FieldSelection,
  fields: readonly SchemaField[],
): string {
  const allFieldIds = fields.map((field) => field.fieldId);
  const selectedCount = selectedFieldCount(selection, allFieldIds);
  return selection === null
    ? `全項目（${allFieldIds.length}）`
    : `${selectedCount} / ${allFieldIds.length}`;
}

function renderSectionHead(
  props: FieldSelectionChecklistProps,
  section: string,
  sectionFields: readonly SchemaField[],
  listId: string,
): HTMLElement {
  const collapsed = props.collapsedSections.includes(section);
  const collapseButton = el(
    'button',
    {
      className: `${props.idPrefix}__field-collapse`,
      attributes: {
        type: 'button',
        'aria-expanded': String(!collapsed),
        'aria-controls': listId,
      },
    },
    [`${collapsed ? '▸' : '▾'} ${section}`],
  );
  collapseButton.addEventListener('click', () => props.onToggleCollapse(section));

  const sectionFieldIds = sectionFields.map((field) => field.fieldId);
  const selectedCount = sectionFieldIds.filter((fieldId) =>
    isFieldSelected(props.selection, fieldId),
  ).length;
  const fullySelected = isSectionFullySelected(props.selection, sectionFieldIds);
  const sectionToggle = el('button', {
    className: `${props.idPrefix}__field-section-toggle`,
    text: fullySelected ? '全解除' : '全選択',
    attributes: { type: 'button' },
  });
  sectionToggle.addEventListener('click', () =>
    props.onToggleSection(sectionFieldIds, !fullySelected),
  );

  return el('div', { className: `${props.idPrefix}__field-section-head` }, [
    collapseButton,
    el('span', {
      className: `${props.idPrefix}__field-section-count`,
      text: `選択 ${selectedCount} / 全 ${sectionFields.length}`,
    }),
    sectionToggle,
  ]);
}

function renderFieldItem(props: FieldSelectionChecklistProps, field: SchemaField): HTMLElement {
  const checkbox = el('input', {
    className: `${props.idPrefix}__field-checkbox`,
    attributes: {
      type: 'checkbox',
      'aria-label': `${field.fieldLabel}（${field.fieldName}）を抽出対象にする`,
    },
  });
  checkbox.checked = isFieldSelected(props.selection, field.fieldId);
  checkbox.addEventListener('change', () =>
    props.onToggleField(field.fieldId, checkbox.checked),
  );
  return el('li', { className: `${props.idPrefix}__field-item` }, [
    el('label', { className: `${props.idPrefix}__field-choice` }, [
      checkbox,
      el('span', { className: `${props.idPrefix}__field-label`, text: field.fieldLabel }),
      el('code', { className: `${props.idPrefix}__field-name`, text: field.fieldName }),
    ]),
  ]);
}

/** チェックリスト本体（見出し + section ごとの折りたたみ + 全体サマリ行）を組み立てる */
export function renderFieldSelectionChecklist(props: FieldSelectionChecklistProps): HTMLElement {
  const sections = groupFieldsBySection(props.fields);
  const sectionElements = sections.map((group, index) => {
    const listId = `${props.idPrefix}-field-section-${index}`;
    const collapsed = props.collapsedSections.includes(group.section);
    const list = el(
      'ul',
      { id: listId, className: `${props.idPrefix}__field-list` },
      group.fields.map((field) => renderFieldItem(props, field)),
    );
    if (collapsed) {
      list.hidden = true;
    }
    return el('div', { className: `${props.idPrefix}__field-section` }, [
      renderSectionHead(props, group.section, group.fields, listId),
      list,
    ]);
  });

  const summary = el('p', {
    id: `${props.idPrefix}-field-summary`,
    className: `${props.idPrefix}__field-summary`,
    text: `対象項目: ${fieldSelectionSummaryText(props.selection, props.fields)}`,
  });

  const children: HTMLElement[] = [...sectionElements, summary];
  if (hasZeroFieldsSelected(props.selection, props.fields)) {
    children.push(
      el('p', {
        id: `${props.idPrefix}-field-error`,
        className: `${props.idPrefix}__error`,
        attributes: { role: 'alert' },
        text: '抽出対象の項目を 1 つ以上選択してください',
      }),
    );
  }
  return el('div', { id: `${props.idPrefix}-fields`, className: `${props.idPrefix}__fields` }, children);
}
