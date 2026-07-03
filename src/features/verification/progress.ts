// 検証進捗の集計（ui-states.md §3 `#/verify` の document セレクタ進捗チップ素材）。
// セルモデル（cells.ts）を entity タブ横断で数え、判定済み（unverified 以外）を分子にする
import type { Decision } from '../../domain/decision';
import type { Evidence } from '../../domain/evidence';
import type { SchemaField } from '../../domain/schemaField';
import { availableTabs, buildTabModel } from './cells';

export interface VerificationProgress {
  /** 判定済みセル数（accept / edit / reject / not_reported。undo で戻したものは含まない） */
  decided: number;
  /** 総セル数（全 entity タブの連結） */
  total: number;
}

/**
 * 1 document ぶんの検証進捗を数える。
 * decisions には「自分の annotator 行への判定」だけを渡すこと（cells.ts と同じ契約）
 */
export function verificationProgress(
  fields: readonly SchemaField[],
  evidence: readonly Evidence[],
  ownDecisions: readonly Decision[],
): VerificationProgress {
  let decided = 0;
  let total = 0;
  for (const tab of availableTabs(fields)) {
    const model = buildTabModel(tab, fields, evidence, ownDecisions);
    total += model.cells.length;
    decided += model.cells.filter((cell) => cell.state.status !== 'unverified').length;
  }
  return { decided, total };
}
