// run 単位のフィールド選択（issue #80 案 A）の純粋ロジック。
// S6 パイロット / S7 一括抽出の実行前画面に置く項目チェックリストが使う選択状態の操作を
// ここへ集約する（store / view から独立してテストできるようにする）。
//
// 規約: 選択状態は「null = 全選択」（既定）。runExtraction の `fieldIds`（全選択時は null）と
// 揃えているため、`resolveFieldIdsForRun` はほぼ素通しで済む。選択を編集する関数
// （toggleFieldSelection / toggleFieldSection）は、全 field が選択された状態になったら
// 自動的に null へ正規化する（「全選択なら null」の不変条件を常に保つ）
import type { SchemaField } from '../../domain/schemaField';

/** 項目選択状態。null = 全選択。非 null は選択中の field_id の配列（順不同・常に正規化済み） */
export type FieldSelection = string[] | null;

/** サブセット run のバッジ注記素材（S7: study_id → 直近完了 run の選択数 / 全項目数） */
export interface FieldSubsetBadge {
  /** その run が対象にした field 数 */
  selected: number;
  /** その run の schema_version の全 field 数 */
  total: number;
}

/** 指定 field が選択されているか */
export function isFieldSelected(selection: FieldSelection, fieldId: string): boolean {
  return selection === null || selection.includes(fieldId);
}

/** 選択中の件数（全選択時は allFieldIds の件数） */
export function selectedFieldCount(selection: FieldSelection, allFieldIds: readonly string[]): number {
  return selection === null ? allFieldIds.length : selection.length;
}

/** section 内の全 field が選択されているか（section 見出しトグルのボタン文言切替に使う） */
export function isSectionFullySelected(
  selection: FieldSelection,
  sectionFieldIds: readonly string[],
): boolean {
  return sectionFieldIds.every((fieldId) => isFieldSelected(selection, fieldId));
}

/** 選択を「選択中 field_id の Set」へ具体化する（null → 全件） */
function materialize(selection: FieldSelection, allFieldIds: readonly string[]): Set<string> {
  return new Set(selection ?? allFieldIds);
}

/** 全 field を含むなら null（全選択）へ正規化する。それ以外は配列のまま返す */
function normalize(materialized: ReadonlySet<string>, allFieldIds: readonly string[]): FieldSelection {
  return materialized.size >= allFieldIds.length ? null : [...materialized];
}

/** 単一 field のチェックボックス切替 */
export function toggleFieldSelection(
  selection: FieldSelection,
  allFieldIds: readonly string[],
  fieldId: string,
  selected: boolean,
): FieldSelection {
  const materialized = materialize(selection, allFieldIds);
  if (selected) {
    materialized.add(fieldId);
  } else {
    materialized.delete(fieldId);
  }
  return normalize(materialized, allFieldIds);
}

/** section 見出しの全選択 / 全解除トグル */
export function toggleFieldSection(
  selection: FieldSelection,
  allFieldIds: readonly string[],
  sectionFieldIds: readonly string[],
  selected: boolean,
): FieldSelection {
  const materialized = materialize(selection, allFieldIds);
  for (const fieldId of sectionFieldIds) {
    if (selected) {
      materialized.add(fieldId);
    } else {
      materialized.delete(fieldId);
    }
  }
  return normalize(materialized, allFieldIds);
}

/** 折りたたみ中の section 名一覧（既定 = 空 = 全展開）の切替 */
export function toggleCollapsedSection(collapsed: readonly string[], section: string): string[] {
  return collapsed.includes(section)
    ? collapsed.filter((candidate) => candidate !== section)
    : [...collapsed, section];
}

/**
 * runExtraction へ渡す fieldIds を組み立てる（全選択時は null。空配列は使わない規約）。
 * selection は toggle 系で既に正規化済みのため、ここでは素通しで良い
 */
export function resolveFieldIdsForRun(selection: FieldSelection): string[] | null {
  return selection === null ? null : [...selection];
}

/** fieldIds（null = 全項目）で fields を絞り込む。fields の並び順は維持する */
export function filterFieldsBySelection(
  fields: readonly SchemaField[],
  fieldIds: readonly string[] | null,
): SchemaField[] {
  if (fieldIds === null) {
    return [...fields];
  }
  const idSet = new Set(fieldIds);
  return fields.filter((field) => idSet.has(field.fieldId));
}

/** section 単位にグルーピングする（初出順を維持。field の並び順自体は変えない） */
export interface FieldSection {
  section: string;
  fields: SchemaField[];
}

export function groupFieldsBySection(fields: readonly SchemaField[]): FieldSection[] {
  const order: string[] = [];
  const bySection = new Map<string, SchemaField[]>();
  for (const field of fields) {
    let list = bySection.get(field.section);
    if (list === undefined) {
      list = [];
      bySection.set(field.section, list);
      order.push(field.section);
    }
    list.push(field);
  }
  return order.map((section) => ({ section, fields: bySection.get(section) as SchemaField[] }));
}
