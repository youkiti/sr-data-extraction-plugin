// 検証進捗の集計（ui-states.md §3 `#/verify` の document セレクタ進捗チップ素材）。
// セルモデル（cells.ts）を entity タブ横断で数え、判定済み（unverified 以外）を分子にする
import type { Decision } from '../../domain/decision';
import type { Evidence } from '../../domain/evidence';
import type { EntityLevel, SchemaField } from '../../domain/schemaField';
import { availableTabs, buildTabModel } from './cells';

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
): VerificationProgress {
  const byTab: TabProgress[] = [];
  let decided = 0;
  let total = 0;
  for (const tab of availableTabs(fields)) {
    const model = buildTabModel(tab, fields, evidence, ownDecisions);
    const tabTotal = model.cells.length;
    const tabDecided = model.cells.filter((cell) => cell.state.status !== 'unverified').length;
    byTab.push({ tab, decided: tabDecided, total: tabTotal });
    total += tabTotal;
    decided += tabDecided;
  }
  return { decided, total, byTab };
}
