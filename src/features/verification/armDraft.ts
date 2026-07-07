// 群構成確定カードの AI ドラフト導出（requirements.md §4.2 / ui-states.md §3 `#/verify`）。
// Evidence の entity_key と arm 名フィールドの値から「確定前の初期値」を組み立てる純粋ロジック
import type { Evidence } from '../../domain/evidence';
import type { EntityLevel, SchemaField } from '../../domain/schemaField';
import { parseEntityKey } from '../../utils/entityKey';
import { cellKeyOf } from './cellState';
import { entityKeyLabel } from './cells';

export interface DraftArm {
  armKey: string;
  armName: string;
}

/**
 * 群構成の確定に依存する entity レベルか。ディム対象のタブはこのレベルに限る —
 * study は 1 document 固定、rob_domain はテンプレートの固定ドメインで完結するため、
 * どちらも arm 未確定のまま検証できる（requirements.md §3.3 v0.9）
 */
export function isArmDependentLevel(level: EntityLevel): boolean {
  return level === 'arm' || level === 'outcome_result';
}

/**
 * 群構成の確定が必要なスキーマか（arm / outcome_result レベル項目が 1 つでもあるか）。
 * false のときは確定カードを出さない（ディム対象のタブも存在しない）
 */
export function needsArmConfirmation(fields: readonly SchemaField[]): boolean {
  return fields.some((field) => isArmDependentLevel(field.entityLevel));
}

/**
 * arm 名の初期値に使うフィールド。arm レベル項目のうち field_name に name / label を
 * 含むもの（fieldIndex 順の先頭）。該当なしは null（初期値は表示ラベル `群 n` になる。
 * 名前でない値〔群別 N 等〕を初期値に流し込まないための保守的なヒューリスティック）
 */
export function armNameField(fields: readonly SchemaField[]): SchemaField | null {
  return (
    fields
      .filter((field) => field.entityLevel === 'arm')
      .sort((a, b) => a.fieldIndex - b.fieldIndex)
      .find((field) => /(^|_)(name|label)(_|$)/.test(field.fieldName)) ?? null
  );
}

/**
 * AI ドラフトの arm 一覧を導出する。
 * - arm キーは Evidence の arm レベル entity_key と、outcome_result キー内の arm 参照から集める
 * - 名称は arm 名フィールドの Evidence 値。なければ表示ラベル（`群 n`）で埋める
 */
export function draftArms(
  fields: readonly SchemaField[],
  evidence: readonly Evidence[],
): DraftArm[] {
  const keys = new Set<string>();
  for (const item of evidence) {
    const parsed = parseEntityKey(item.entityKey);
    if (parsed === null) {
      continue;
    }
    if (parsed.level === 'arm') {
      keys.add(item.entityKey);
    } else if (parsed.level === 'outcome_result' && parsed.arm !== null) {
      keys.add(`arm:${parsed.arm}`);
    }
  }
  const nameField = armNameField(fields);
  const nameByCell = new Map<string, string>();
  if (nameField !== null) {
    for (const item of evidence) {
      if (item.fieldId === nameField.fieldId && item.value !== null) {
        nameByCell.set(cellKeyOf(item.fieldId, item.entityKey), item.value);
      }
    }
  }
  return [...keys].sort((a, b) => a.localeCompare(b)).map((armKey) => ({
    armKey,
    armName:
      (nameField !== null ? nameByCell.get(cellKeyOf(nameField.fieldId, armKey)) : undefined) ??
      entityKeyLabel(armKey),
  }));
}
