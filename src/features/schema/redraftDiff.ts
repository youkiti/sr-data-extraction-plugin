// S5「AI 再ドラフト」の差分ロジック（issue #197 Chunk A）。
// プロトコル改訂後に AI へ表デザインを再ドラフトさせた結果（SchemaEditorRow[]）と、
// 現行スキーマ版（SchemaField[]）を突き合わせて差分を作る純粋関数群。
// DOM・store・ネットワークには一切依存しない（差分画面の描画・サービス配線は Chunk B）
import type { SchemaField } from '../../domain/schemaField';
import type { SchemaEditorRow } from './types';

/** 差分計算で比較する属性（fieldId / note / aiGenerated は比較しない） */
export type RedraftComparedKey =
  | 'section'
  | 'fieldLabel'
  | 'entityLevel'
  | 'dataType'
  | 'unit'
  | 'allowedValues'
  | 'required'
  | 'extractionInstruction'
  | 'example';

/** 比較する順序（差分表示の列順に対応させる） */
const COMPARED_KEYS: readonly RedraftComparedKey[] = [
  'section',
  'fieldLabel',
  'entityLevel',
  'dataType',
  'unit',
  'allowedValues',
  'required',
  'extractionInstruction',
  'example',
];

export interface RedraftAttributeChange {
  key: RedraftComparedKey;
  before: string | null;
  after: string | null;
}

export interface RedraftAddedItem {
  /** AI が提案した新規行（fieldId は null のまま） */
  row: SchemaEditorRow;
}
export interface RedraftChangedItem {
  /** 現行版の項目（fieldId を持つ） */
  current: SchemaField;
  /** AI 提案行（fieldId は null） */
  proposed: SchemaEditorRow;
  changes: RedraftAttributeChange[];
}
export interface RedraftRemovedItem {
  current: SchemaField;
}

export interface RedraftDiff {
  added: RedraftAddedItem[];
  changed: RedraftChangedItem[];
  removed: RedraftRemovedItem[];
  /** field_name 一致かつ全属性同一 */
  unchanged: SchemaField[];
  /** AI の提案対象外のため差分に出さず常時保持する行（RoB テンプレート由来） */
  protectedFields: SchemaField[];
  /**
   * 内部フィールド: applyRedraftDiff が「現行版の並び順を維持」するために使う、
   * current 配列の元順序（trim 済み field_name の列。protectedFields も含む全件）。
   * buildRedraftDiff / applyRedraftDiff のペアでのみ意味を持つ内部契約であり、
   * 差分画面の描画（Chunk B）はこのフィールドを直接参照しない想定
   */
  readonly currentFieldOrder: readonly string[];
}

/** 比較対象の属性をエディタ表示用の文字列へ変換する（boolean は 'true'/'false'、null はそのまま） */
type ComparableSource = Pick<
  SchemaField,
  | 'section'
  | 'fieldLabel'
  | 'entityLevel'
  | 'dataType'
  | 'unit'
  | 'allowedValues'
  | 'required'
  | 'extractionInstruction'
  | 'example'
>;

function stringifyAttr(key: RedraftComparedKey, source: ComparableSource): string | null {
  switch (key) {
    case 'section':
      return source.section;
    case 'fieldLabel':
      return source.fieldLabel;
    case 'entityLevel':
      return source.entityLevel;
    case 'dataType':
      return source.dataType;
    case 'unit':
      return source.unit;
    case 'allowedValues':
      return source.allowedValues;
    case 'required':
      return source.required ? 'true' : 'false';
    case 'extractionInstruction':
      return source.extractionInstruction;
    case 'example':
      return source.example;
  }
}

/**
 * current 側の項目が「保護行」か判定する。RoB テンプレート由来の項目は
 * draft-schema skill の system prompt が "Do not include risk-of-bias domains." と
 * 明示しており AI は絶対に提案しないため、差分（added/changed/removed）の対象から
 * 除外し常に維持する。除外しないとプリセット行が数十件まるごと
 * 「削除候補」として並んでしまい、承認 UI が使い物にならなくなる
 */
function isProtectedField(field: SchemaField): boolean {
  return field.entityLevel === 'rob_domain' || field.section.trim().startsWith('risk_of_bias');
}

function computeChanges(
  current: ComparableSource,
  proposed: ComparableSource,
): RedraftAttributeChange[] {
  const changes: RedraftAttributeChange[] = [];
  for (const key of COMPARED_KEYS) {
    const before = stringifyAttr(key, current);
    const after = stringifyAttr(key, proposed);
    if (before !== after) {
      changes.push({ key, before, after });
    }
  }
  return changes;
}

/**
 * AI 再ドラフト結果（drafted）と現行スキーマ版（current）を突き合わせて差分を作る。
 * 突き合わせキーは field_name（前後の空白を trim。大文字小文字は区別する = snake_case
 * 強制済みのため）
 */
export function buildRedraftDiff(
  current: readonly SchemaField[],
  drafted: readonly SchemaEditorRow[],
): RedraftDiff {
  const protectedFields: SchemaField[] = [];
  const protectedNames = new Set<string>();
  const nonProtectedCurrent: SchemaField[] = [];
  for (const field of current) {
    if (isProtectedField(field)) {
      protectedFields.push(field);
      protectedNames.add(field.fieldName.trim());
    } else {
      nonProtectedCurrent.push(field);
    }
  }

  // drafted 内の重複 field_name は先頭の 1 件を採用する（parseDraftSchemaResponse 側で
  // 重複が残りうるための防御）。保護行と同名の AI 提案はここで捨てる（重複ではなく除外）
  const draftedByName = new Map<string, SchemaEditorRow>();
  const seenDraftedNames = new Set<string>();
  for (const row of drafted) {
    const name = row.fieldName.trim();
    if (seenDraftedNames.has(name)) {
      continue;
    }
    seenDraftedNames.add(name);
    if (protectedNames.has(name)) {
      continue;
    }
    draftedByName.set(name, row);
  }

  const changed: RedraftChangedItem[] = [];
  const removed: RedraftRemovedItem[] = [];
  const unchanged: SchemaField[] = [];
  for (const field of nonProtectedCurrent) {
    const name = field.fieldName.trim();
    const proposed = draftedByName.get(name);
    if (proposed === undefined) {
      removed.push({ current: field });
      continue;
    }
    // 現行版とマッチした AI 提案は「added」候補から除く（added に残るのは未消費分のみ）
    draftedByName.delete(name);
    const rowChanges = computeChanges(field, proposed);
    if (rowChanges.length > 0) {
      changed.push({ current: field, proposed, changes: rowChanges });
    } else {
      unchanged.push(field);
    }
  }

  // 残った draftedByName は current に無い新規提案（drafted の出現順を維持する Map の性質を利用）
  const added: RedraftAddedItem[] = Array.from(draftedByName.values()).map((row) => ({ row }));

  const currentFieldOrder = current.map((field) => field.fieldName.trim());

  return { added, changed, removed, unchanged, protectedFields, currentFieldOrder };
}

/** 差分画面のチェック状態。キーは added=field_name / changed=field_name / removed=field_name */
export interface RedraftSelection {
  added: Record<string, boolean>;
  changed: Record<string, boolean>;
  removed: Record<string, boolean>;
}

/**
 * 既定の選択状態。added / changed は AI 提案を採用（true）、
 * removed は削除しない（false）— 既存項目がユーザーの明示的承認なしに消えないことが
 * issue #197 の受け入れ条件のため
 */
export function defaultRedraftSelection(diff: RedraftDiff): RedraftSelection {
  const added: Record<string, boolean> = {};
  for (const item of diff.added) {
    added[item.row.fieldName.trim()] = true;
  }
  const changed: Record<string, boolean> = {};
  for (const item of diff.changed) {
    changed[item.current.fieldName.trim()] = true;
  }
  const removed: Record<string, boolean> = {};
  for (const item of diff.removed) {
    removed[item.current.fieldName.trim()] = false;
  }
  return { added, changed, removed };
}

function schemaFieldToEditorRow(field: SchemaField): SchemaEditorRow {
  return {
    fieldId: field.fieldId,
    section: field.section,
    fieldName: field.fieldName,
    fieldLabel: field.fieldLabel,
    entityLevel: field.entityLevel,
    dataType: field.dataType,
    unit: field.unit,
    allowedValues: field.allowedValues,
    required: field.required,
    extractionInstruction: field.extractionInstruction,
    example: field.example,
    aiGenerated: field.aiGenerated,
    note: field.note,
  };
}

/**
 * 選択状態に基づき差分を適用し、エディタ行の配列を返す。
 * - 現行版の並び順を維持する（protectedFields / unchanged / changed / removed を
 *   元の current 配列の順序で走査し、added は末尾へ追記）
 * - field_id の継承がこの機能の肝（requirements.md §3.2）: field_name 一致で
 *   必ず既存 fieldId を引き継ぐ
 */
export function applyRedraftDiff(diff: RedraftDiff, selection: RedraftSelection): SchemaEditorRow[] {
  const protectedByName = new Map(diff.protectedFields.map((field) => [field.fieldName.trim(), field]));
  const unchangedByName = new Map(diff.unchanged.map((field) => [field.fieldName.trim(), field]));
  const changedByName = new Map(diff.changed.map((item) => [item.current.fieldName.trim(), item]));
  const removedByName = new Map(diff.removed.map((item) => [item.current.fieldName.trim(), item]));

  const rows: SchemaEditorRow[] = [];
  for (const name of diff.currentFieldOrder) {
    const protectedField = protectedByName.get(name);
    if (protectedField !== undefined) {
      rows.push(schemaFieldToEditorRow(protectedField));
      continue;
    }
    const unchangedField = unchangedByName.get(name);
    if (unchangedField !== undefined) {
      rows.push(schemaFieldToEditorRow(unchangedField));
      continue;
    }
    const changedItem = changedByName.get(name);
    if (changedItem !== undefined) {
      const approved = selection.changed[name] ?? false;
      rows.push(
        approved
          ? {
              ...changedItem.proposed,
              fieldId: changedItem.current.fieldId,
              note: changedItem.current.note,
              aiGenerated: true,
            }
          : schemaFieldToEditorRow(changedItem.current),
      );
      continue;
    }
    // currentFieldOrder の各 name は buildRedraftDiff により
    // protected/unchanged/changed/removed のいずれか 1 つに必ず分類されているため、
    // ここまで来た name は removed に存在することが保証されている
    const removedItem = removedByName.get(name) as RedraftRemovedItem;
    const approvedRemoval = selection.removed[name] ?? false;
    if (!approvedRemoval) {
      rows.push(schemaFieldToEditorRow(removedItem.current));
    }
  }

  for (const item of diff.added) {
    const name = item.row.fieldName.trim();
    if (selection.added[name] ?? false) {
      rows.push({ ...item.row });
    }
  }

  return rows;
}

function sortedEntries(record: Record<string, boolean>): string {
  return Object.keys(record)
    .sort()
    .map((key) => `${key}:${String(record[key])}`)
    .join('|');
}

/**
 * selection が defaultRedraftSelection(diff) と完全一致するかを判定する。
 * Chunk B が created_by_type を ai_draft（pristine）/ user_edit（既定から 1 つでも
 * 変更）に振り分けるために使う
 */
export function isRedraftSelectionPristine(diff: RedraftDiff, selection: RedraftSelection): boolean {
  const defaults = defaultRedraftSelection(diff);
  return (
    sortedEntries(selection.added) === sortedEntries(defaults.added) &&
    sortedEntries(selection.changed) === sortedEntries(defaults.changed) &&
    sortedEntries(selection.removed) === sortedEntries(defaults.removed)
  );
}
