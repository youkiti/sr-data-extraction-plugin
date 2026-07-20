// 検証フォームのセルモデル構築（requirements.md §4.2 / ui-flow.md §3）。
// entity タブ（study → arm → outcome_result →〔P1: rob_domain〕）ごとに、
// - study: section ごとのグループ
// - arm / outcome_result / rob_domain: entity インスタンスごとのグループ
// を組み立てる。1 セル = 1 field × 1 entity_key（+ 対応する Evidence と判定状態）
import type { Decision } from '../../domain/decision';
import type { Evidence } from '../../domain/evidence';
import type { ConfirmedArmStructure } from '../../domain/armStructure';
import type { EntityLevel, SchemaField } from '../../domain/schemaField';
import {
  makeOutcomeEntityKey,
  parseEntityKey,
  robEstimateScopeOf,
  STUDY_ENTITY_KEY,
} from '../../utils/entityKey';
import { cellKeyOf, deriveCellStates, emptyCellState, type CellState } from './cellState';
import { robOverrideFieldNames } from './robEstimateFields';

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

export interface TabModelOptions {
  /** 人間が確定した arm 集合。AI Evidence がない arm / outcome の空セル生成に使う */
  armStructure?: ConfirmedArmStructure | null;
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
    case 'outcome_result':
      return outcomeInstanceLabel(parsed.outcome, parsed.arm, parsed.time);
    case 'rob_domain':
      return parsed.outcome === undefined
        ? `RoB: ${parsed.domain}`
        : `RoB: ${parsed.domain} — ${outcomeInstanceLabel(parsed.outcome, parsed.arm ?? null, parsed.time ?? null)}`;
  }
}

/** outcome_result インスタンスの表示部分（outcome ／ 群 ／ 時点を ` / ` で連結） */
function outcomeInstanceLabel(outcome: string, arm: string | null, time: string | null): string {
  let label = outcome;
  if (arm !== null) {
    label += ` / 群 ${arm}`;
  }
  if (time !== null) {
    label += ` / ${time}`;
  }
  return label;
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
 * rob_domain タブのインスタンス表示順（issue #109・ui-states.md #/verify）:
 * base（`rob:<domain_id>`）グループ群をキー昇順で先頭に、estimate 別オーバーライドグループ群を
 * 参照先 outcome キー昇順（同一 estimate 内はキー昇順）で後ろに並べる
 */
export function compareRobInstanceKeys(a: string, b: string): number {
  const scopeA = robEstimateScopeOf(a);
  const scopeB = robEstimateScopeOf(b);
  if (scopeA === null && scopeB === null) {
    return a.localeCompare(b);
  }
  if (scopeA === null) {
    return -1;
  }
  if (scopeB === null) {
    return 1;
  }
  const byScope = scopeA.localeCompare(scopeB);
  return byScope !== 0 ? byScope : a.localeCompare(b);
}

/**
 * 指定タブの entity インスタンス一覧（entity_key 昇順。rob_domain のみ base 群 → estimate 別群）。
 * AI 抽出（Evidence）と判定履歴（Decisions）の双方から集める
 */
export function entityInstances(
  level: EntityLevel,
  evidence: readonly Evidence[],
  decisions: readonly Decision[],
  options: TabModelOptions = {},
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
  if (level === 'arm') {
    for (const arm of options.armStructure?.arms ?? []) {
      if (parseEntityKey(arm.armKey)?.level === 'arm') {
        keys.add(arm.armKey);
      }
    }
  } else if (level === 'outcome_result' && options.armStructure !== null) {
    for (const entityKey of expandOutcomeInstances([...keys], options.armStructure ?? null)) {
      keys.add(entityKey);
    }
  }
  return level === 'rob_domain'
    ? [...keys].sort(compareRobInstanceKeys)
    : [...keys].sort((a, b) => a.localeCompare(b));
}

/**
 * 既存 outcome が一部 arm だけに出ている場合も、確定 arm 全体へ展開する。
 * `outcome:x|arm:1|time:30d` があり arm:1 / arm:2 が確定済みなら、
 * arm:2 の空セルも作る。arm を持たない outcome キーは意味を変えないため展開しない。
 */
function expandOutcomeInstances(
  explicitKeys: readonly string[],
  armStructure: ConfirmedArmStructure | null,
): string[] {
  if (armStructure === null) {
    return [];
  }
  const armValues = armStructure.arms
    .map((arm) => parseEntityKey(arm.armKey))
    .filter((parsed): parsed is { level: 'arm'; arm: string } => parsed?.level === 'arm')
    .map((parsed) => parsed.arm);
  if (armValues.length === 0) {
    return [];
  }
  const expanded: string[] = [];
  for (const key of explicitKeys) {
    const parsed = parseEntityKey(key);
    if (parsed?.level !== 'outcome_result' || parsed.arm === null) {
      continue;
    }
    for (const arm of armValues) {
      expanded.push(
        makeOutcomeEntityKey({
          outcome: parsed.outcome,
          arm,
          time: parsed.time ?? undefined,
        }),
      );
    }
  }
  return expanded;
}

/** 判定済みブロックへ送るセル（所属グループの見出しを文脈表示用に併記） */
export interface DecidedEntry {
  cell: VerificationCell;
  heading: string;
}

export interface DecidedSplit {
  /** 未判定（+ 直近判定 1 件）だけを残したグループ。空になったグループは除外 */
  activeGroups: CellGroup[];
  /** 下部「判定済み」ブロックへ送るセル（スキーマ順） */
  decided: DecidedEntry[];
}

/**
 * 判定済みセルを下部ブロックへ分離する（ui-states.md §3 `#/verify`）。
 * 一番上が常に「今判断すべき変数」になるよう、未判定セルを上に残す。
 * recentDecidedKey（直近判定の 1 件）は判定直後の見直し・戻す (z) のために
 * 元の位置へ残し、次の判定で判定済みブロックへ送る
 */
export function splitDecidedCells(
  groups: readonly CellGroup[],
  recentDecidedKey: string | null,
): DecidedSplit {
  const activeGroups: CellGroup[] = [];
  const decided: DecidedEntry[] = [];
  for (const group of groups) {
    const active: VerificationCell[] = [];
    for (const cell of group.cells) {
      if (cell.state.status === 'unverified' || cell.cellKey === recentDecidedKey) {
        active.push(cell);
      } else {
        decided.push({ cell, heading: group.heading });
      }
    }
    if (active.length > 0) {
      activeGroups.push({ heading: group.heading, cells: active });
    }
  }
  return { activeGroups, decided };
}

/**
 * インスタンスへ展開する field 列。rob_domain タブの estimate 別オーバーライド
 * （issue #109）だけは「宣言ドメインの判定 + 根拠 + そのドメインの SQ」へ絞る
 * （base は現行どおり全 field の直積 = 幽霊セル）。テンプレート外のドメイン id
 * （防御）は base と同じ全 field 展開へフォールバックする
 */
function instanceFields(
  tab: EntityLevel,
  tabFields: readonly SchemaField[],
  allFields: readonly SchemaField[],
  entityKey: string,
): readonly SchemaField[] {
  if (tab !== 'rob_domain' || robEstimateScopeOf(entityKey) === null) {
    return tabFields;
  }
  // scope が非 null なら parseEntityKey は必ず rob_domain バリアント（robEstimateScopeOf の定義）
  const { domain } = parseEntityKey(entityKey) as { domain: string };
  const allowed = robOverrideFieldNames(domain, allFields);
  if (allowed === null) {
    return tabFields;
  }
  return tabFields.filter((field) => allowed.has(field.fieldName));
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
  options: TabModelOptions = {},
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
    const instanceKeys = entityInstances(tab, evidence, decisions, options);
    // estimate 別オーバーライドが 1 つでもあるとき、base 見出しへ「共通（全 estimate）」を
    // 付記して読み分けられるようにする（issue #109・ui-states.md #/verify）
    const hasEstimateInstances =
      tab === 'rob_domain' && instanceKeys.some((key) => robEstimateScopeOf(key) !== null);
    for (const entityKey of instanceKeys) {
      const label = entityKeyLabel(entityKey);
      groups.push({
        heading:
          hasEstimateInstances && robEstimateScopeOf(entityKey) === null
            ? `${label} — 共通（全 estimate）`
            : label,
        cells: instanceFields(tab, tabFields, fields, entityKey).map((field) =>
          makeCell(field, entityKey, evidenceIndex, states),
        ),
      });
    }
  }
  return { groups, cells: groups.flatMap((group) => group.cells) };
}
