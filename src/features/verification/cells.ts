// 検証フォームのセルモデル構築（requirements.md §4.2 / ui-flow.md §3）。
// entity タブ（study → arm → outcome_result →〔P1: rob_domain〕）ごとに、
// - study: section ごとのグループ
// - arm / outcome_result / rob_domain: entity インスタンスごとのグループ
// を組み立てる。1 セル = 1 field × 1 entity_key（+ 対応する Evidence と判定状態）
import type { Decision } from '../../domain/decision';
import type { Evidence } from '../../domain/evidence';
import type { EntityLevel, SchemaField } from '../../domain/schemaField';
import { parseEntityKey, STUDY_ENTITY_KEY } from '../../utils/entityKey';
import { cellKeyOf, deriveCellStates, emptyCellState, type CellState } from './cellState';

export interface VerificationCell {
  cellKey: string;
  field: SchemaField;
  entityKey: string;
  /** 対応する AI 根拠。AI 未抽出セルは null（手入力のみ可能） */
  evidence: Evidence | null;
  state: CellState;
}

export interface CellGroup {
  /** section 名（study タブ）または entity インスタンスの表示ラベル（他タブ） */
  heading: string;
  cells: VerificationCell[];
}

export interface TabModel {
  groups: CellGroup[];
  /** 全グループの連結（j / k のフォーカス移動順） */
  cells: VerificationCell[];
}

/** entity タブの表示順（ui-flow.md §3。rob_domain は P1 だがデータ構造は対応済み） */
const TAB_ORDER: readonly EntityLevel[] = ['study', 'arm', 'outcome_result', 'rob_domain'];

/** スキーマに存在する entity_level のタブを表示順で返す */
export function availableTabs(fields: readonly SchemaField[]): EntityLevel[] {
  return TAB_ORDER.filter((level) => fields.some((field) => field.entityLevel === level));
}

/** entity_key の表示ラベル。形式不正はキーをそのまま出す（防御） */
export function entityKeyLabel(entityKey: string): string {
  const parsed = parseEntityKey(entityKey);
  if (parsed === null) {
    return entityKey;
  }
  switch (parsed.level) {
    case 'study':
      return 'Study';
    case 'arm':
      return `群 ${parsed.arm}`;
    case 'outcome_result': {
      let label = parsed.outcome;
      if (parsed.arm !== null) {
        label += ` / 群 ${parsed.arm}`;
      }
      if (parsed.time !== null) {
        label += ` / ${parsed.time}`;
      }
      return label;
    }
    case 'rob_domain':
      return `RoB: ${parsed.domain}`;
  }
}

/** fieldId × entityKey → Evidence。同一セルに複数あれば後勝ち（後の行が新しい） */
function indexEvidence(evidence: readonly Evidence[]): Map<string, Evidence> {
  const index = new Map<string, Evidence>();
  for (const item of evidence) {
    index.set(cellKeyOf(item.fieldId, item.entityKey), item);
  }
  return index;
}

function makeCell(
  field: SchemaField,
  entityKey: string,
  evidenceIndex: Map<string, Evidence>,
  states: Map<string, CellState>,
): VerificationCell {
  const cellKey = cellKeyOf(field.fieldId, entityKey);
  return {
    cellKey,
    field,
    entityKey,
    evidence: evidenceIndex.get(cellKey) ?? null,
    state: states.get(cellKey) ?? emptyCellState(),
  };
}

/**
 * 指定タブの entity インスタンス一覧（entity_key 昇順）。
 * AI 抽出（Evidence）と判定履歴（Decisions）の双方から集める
 */
export function entityInstances(
  level: EntityLevel,
  evidence: readonly Evidence[],
  decisions: readonly Decision[],
): string[] {
  const keys = new Set<string>();
  for (const item of evidence) {
    if (parseEntityKey(item.entityKey)?.level === level) {
      keys.add(item.entityKey);
    }
  }
  for (const decision of decisions) {
    if (parseEntityKey(decision.entityKey)?.level === level) {
      keys.add(decision.entityKey);
    }
  }
  return [...keys].sort((a, b) => a.localeCompare(b));
}

/**
 * タブのセルモデルを構築する。decisions は「自分の annotator 行への判定」だけを
 * 渡すこと（他 annotator の判定を混ぜると状態導出が濁る）
 */
export function buildTabModel(
  tab: EntityLevel,
  fields: readonly SchemaField[],
  evidence: readonly Evidence[],
  decisions: readonly Decision[],
): TabModel {
  const tabFields = fields
    .filter((field) => field.entityLevel === tab)
    .sort((a, b) => a.fieldIndex - b.fieldIndex);
  const evidenceIndex = indexEvidence(evidence);
  const states = deriveCellStates(decisions);

  const groups: CellGroup[] = [];
  if (tab === 'study') {
    // section ごとのグループ（fieldIndex 順の初出順で section を並べる）
    for (const field of tabFields) {
      const last = groups[groups.length - 1];
      const cell = makeCell(field, STUDY_ENTITY_KEY, evidenceIndex, states);
      if (last !== undefined && last.heading === field.section) {
        last.cells.push(cell);
      } else {
        groups.push({ heading: field.section, cells: [cell] });
      }
    }
  } else {
    for (const entityKey of entityInstances(tab, evidence, decisions)) {
      groups.push({
        heading: entityKeyLabel(entityKey),
        cells: tabFields.map((field) => makeCell(field, entityKey, evidenceIndex, states)),
      });
    }
  }
  return { groups, cells: groups.flatMap((group) => group.cells) };
}
