// 検証進捗の集計（ui-states.md §3 `#/verify` の document セレクタ進捗チップ素材）。
// セルモデル（cells.ts）を entity タブ横断で数え、判定済み（unverified 以外）を分子にする
import type { Decision } from '../../domain/decision';
import type { Evidence } from '../../domain/evidence';
import type { ConfirmedArmStructure } from '../../domain/armStructure';
import type { EntityLevel, SchemaField } from '../../domain/schemaField';
import { availableTabs, buildTabModel } from './cells';
import { cellKeyOf } from './cellState';
import { activeConsultFlags } from './consultFlags';

/** entity タブ 1 枚ぶんの判定進捗（Study / 群 / アウトカムを個別に数える） */
export interface TabProgress {
  tab: EntityLevel;
  /** 判定済みセル数（accept / edit / reject / not_reported。undo で戻したものは含まない） */
  decided: number;
  /** そのタブの総セル数 */
  total: number;
}

export interface VerificationProgress {
  /** 判定済みセル数（全 entity タブの合算） */
  decided: number;
  /** 総セル数（全 entity タブの合算） */
  total: number;
  /** タブ別の内訳（表示順。フォームは現在タブぶんを主に見せる） */
  byTab: TabProgress[];
  /**
   * 自分の有効な「要相談」の印が付いたセル数（issue #425。研究の選択欄の「・要相談 k」）。
   * 判定の進捗（decided / total）とは独立。省略時は 0 扱い
   */
  consults?: number;
}

/**
 * 1 document ぶんの検証進捗を数える。
 * decisions には「自分の annotator 行への判定」だけを渡すこと（cells.ts と同じ契約）。
 * 合算値（decided / total）に加えてタブ別内訳（byTab）も返す。フォームの進捗バーは
 * 「今見ているタブに映っていないセルまで残数に数えて混乱する」のを避けるため byTab を使う
 */
export function verificationProgress(
  fields: readonly SchemaField[],
  evidence: readonly Evidence[],
  ownDecisions: readonly Decision[],
  options: { armStructure?: ConfirmedArmStructure | null } = {},
): VerificationProgress {
  const byTab: TabProgress[] = [];
  let decided = 0;
  let total = 0;
  const cellKeys = new Set<string>();
  for (const tab of availableTabs(fields)) {
    const model = buildTabModel(tab, fields, evidence, ownDecisions, options);
    const tabTotal = model.cells.length;
    const tabDecided = model.cells.filter((cell) => cell.state.status !== 'unverified').length;
    for (const cell of model.cells) cellKeys.add(cell.cellKey);
    byTab.push({ tab, decided: tabDecided, total: tabTotal });
    total += tabTotal;
    decided += tabDecided;
  }
  // 数えるのは今のセル一覧にあるセルの印だけ（スキーマ改訂で消えた項目の印は数えない）
  const consults = [...activeConsultFlags(ownDecisions).values()]
    .filter((flag) => cellKeys.has(cellKeyOf(flag.fieldId, flag.entityKey))).length;
  // 印が無ければ省く（省略時は 0 扱い。既存の進捗の比較・保存形を変えない）
  return consults > 0 ? { decided, total, byTab, consults } : { decided, total, byTab };
}
