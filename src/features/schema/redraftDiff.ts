// S5「AI 再ドラフト」の差分ロジック（issue #197 Chunk A + レビュー反映 Chunk B）。
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

/**
 * current 側 1 項目の分類結果（issue #197 レビュー反映）。
 * applyRedraftDiff はこの判別可能ユニオンを走査するだけで出力行を組み立てられるため、
 * field_name をキーにした Map の再構築・型アサーション・重複 field_name での取りこぼしが
 * まとめて解消される（旧 currentFieldOrder + 4 Map 方式の問題点）。
 * buildRedraftDiff / applyRedraftDiff のペアでのみ意味を持つ内部契約であり、
 * 差分画面の描画（Chunk B の schemaView.ts）は added / changed / removed / unchanged /
 * protectedFields を直接使い、このフィールドは参照しない想定
 */
export type RedraftEntry =
  | { kind: 'protected'; field: SchemaField }
  | { kind: 'unchanged'; field: SchemaField }
  | { kind: 'changed'; item: RedraftChangedItem }
  | { kind: 'removed'; item: RedraftRemovedItem };

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
   * current 配列を元の並び順のまま分類したエントリ列（protectedFields も含む全件）。
   * buildRedraftDiff / applyRedraftDiff のペアでのみ意味を持つ内部契約
   */
  readonly currentEntries: readonly RedraftEntry[];
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
      // saveSchemaVersion.ts は保存時に section を trim する。current 側（＝保存済みの現行版）は
      // 既に trim 済みだが、AI 提案（proposed）は trim 前のままここに渡ってくるため、
      // trim せずに比較すると前後の空白の差だけで「変更あり」に化けてしまう。
      // 比較は「保存後の値どうし」を突き合わせる規約として、ここで trim してから行う
      return source.section.trim();
    case 'fieldLabel':
      // section と同じ理由（saveSchemaVersion.ts が fieldLabel も trim して保存する）
      return source.fieldLabel.trim();
    case 'entityLevel':
      return source.entityLevel;
    case 'dataType':
      return source.dataType;
    case 'unit':
      return source.unit;
    case 'allowedValues':
      // saveSchemaVersion.ts は enum 以外の allowedValues を保存時に破棄する
      // （`row.dataType === 'enum' ? row.allowedValues : null`）。比較もこの規約に合わせないと、
      // 「AI 提案が非 enum なのに allowed_values を返した」だけで実際には保存後は消える値の
      // 差分が「変更あり」に化けてしまう
      return source.dataType === 'enum' ? source.allowedValues : null;
    case 'required':
      return source.required ? 'true' : 'false';
    case 'extractionInstruction':
      // section / fieldLabel と同じ理由（saveSchemaVersion.ts が trim して保存する）
      return source.extractionInstruction.trim();
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
 * 強制済みのため）。current に同名 field が複数あっても（SchemaFields タブの直読みなので
 * 理論上ありうる）取りこぼさない — 各 current 項目を 1 件ずつ独立に分類し、drafted 側の
 * 対応行は先着 1 件にしか消費させない（2 件目以降は removed 扱いになる）
 */
export function buildRedraftDiff(
  current: readonly SchemaField[],
  drafted: readonly SchemaEditorRow[],
): RedraftDiff {
  const protectedNames = new Set<string>();
  for (const field of current) {
    if (isProtectedField(field)) {
      protectedNames.add(field.fieldName.trim());
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

  const protectedFields: SchemaField[] = [];
  const changed: RedraftChangedItem[] = [];
  const removed: RedraftRemovedItem[] = [];
  const unchanged: SchemaField[] = [];
  const currentEntries: RedraftEntry[] = [];

  for (const field of current) {
    if (isProtectedField(field)) {
      protectedFields.push(field);
      currentEntries.push({ kind: 'protected', field });
      continue;
    }
    const name = field.fieldName.trim();
    const proposed = draftedByName.get(name);
    if (proposed === undefined) {
      const item: RedraftRemovedItem = { current: field };
      removed.push(item);
      currentEntries.push({ kind: 'removed', item });
      continue;
    }
    // 現行版とマッチした AI 提案は「added」候補から除く（added に残るのは未消費分のみ）。
    // 同名の current が複数ある場合、2 件目以降はこの delete 済みのため必ず removed になる
    draftedByName.delete(name);
    const rowChanges = computeChanges(field, proposed);
    if (rowChanges.length > 0) {
      const item: RedraftChangedItem = { current: field, proposed, changes: rowChanges };
      changed.push(item);
      currentEntries.push({ kind: 'changed', item });
    } else {
      unchanged.push(field);
      currentEntries.push({ kind: 'unchanged', field });
    }
  }

  // 残った draftedByName は current に無い新規提案（drafted の出現順を維持する Map の性質を利用）
  const added: RedraftAddedItem[] = Array.from(draftedByName.values()).map((row) => ({ row }));

  return { added, changed, removed, unchanged, protectedFields, currentEntries };
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
 * - 現行版の並び順を維持する（currentEntries を先頭から走査し、added は末尾へ追記）
 * - field_id の継承がこの機能の肝（requirements.md §3.2）: field_name 一致で
 *   必ず既存 fieldId を引き継ぐ
 */
export function applyRedraftDiff(diff: RedraftDiff, selection: RedraftSelection): SchemaEditorRow[] {
  const rows: SchemaEditorRow[] = [];
  for (const entry of diff.currentEntries) {
    switch (entry.kind) {
      case 'protected':
      case 'unchanged':
        rows.push(schemaFieldToEditorRow(entry.field));
        break;
      case 'changed': {
        const name = entry.item.current.fieldName.trim();
        const approved = selection.changed[name] ?? false;
        rows.push(
          approved
            ? {
                ...entry.item.proposed,
                fieldId: entry.item.current.fieldId,
                note: entry.item.current.note,
                aiGenerated: true,
              }
            : schemaFieldToEditorRow(entry.item.current),
        );
        break;
      }
      case 'removed': {
        const name = entry.item.current.fieldName.trim();
        const approvedRemoval = selection.removed[name] ?? false;
        if (!approvedRemoval) {
          rows.push(schemaFieldToEditorRow(entry.item.current));
        }
        break;
      }
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
