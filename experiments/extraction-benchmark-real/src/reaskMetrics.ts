// 再探索の採用・gold との照合・対象外セルの一致を、副作用なしで判定する。
// 正確度は行数から計算し、丸め済みの既存指標を逆算しない。
import { normalizeText } from '../../../src/features/anchoring/normalizeText';
import { matchesValue, type RunItem } from './metrics';
import { cellKey, type ReaskRun, type TargetCell } from './reask';
import type { GoldRow } from './validateGold';

export const REASONS = ['no_reask_run', 'reask_failed', 'absent', 'still_not_reported', 'no_quote', 'anchor_failed'] as const;
export type Reason = typeof REASONS[number];
export const STATES = ['outside_gold', 'rescued_correct', 'rescued_mismatch', 'still_missed', 'fabricated', 'kept_not_reported'] as const;
export type State = typeof STATES[number];
export const AGREEMENTS = ['same', 'different', 'now_not_reported', 'absent'] as const;
export type Agreement = typeof AGREEMENTS[number];
export type Replacement = { item: RunItem; reason: null } | { item: null; reason: Reason };

/** キーごとに最後の要素を返す。既存の採点と同じ重複解決規則を使う。 */
export function itemsByKey(items: readonly RunItem[]): Map<string, RunItem> {
  return new Map(items.map((item) => [cellKey(item), item]));
}

/** 採用可能な要素、または最優先の不採用理由を返す。失敗 run の断片は採用しない。 */
export function replacement(cell: TargetCell, run: ReaskRun | undefined): Replacement {
  const reject = (reason: Reason): Replacement => ({ item: null, reason });
  if (run === undefined) return reject('no_reask_run');
  if (run.error !== null || run.formatError !== null) return reject('reask_failed');
  const item = itemsByKey(run.items).get(cellKey(cell));
  if (item === undefined) return reject('absent');
  if (item.notReported === true || item.value === null) return reject('still_not_reported');
  if (item.quote === null) return reject('no_quote');
  if (item.anchor === null || item.anchor.status === 'failed') return reject('anchor_failed');
  return { item, reason: null };
}

/** 対象セルの状態を一つ返す。gold 外は主指標から分離する。 */
export function targetState(gold: GoldRow | undefined, adopted: Replacement): State {
  if (gold === undefined) return 'outside_gold';
  if (gold.not_reported) return adopted.item === null ? 'kept_not_reported' : 'fabricated';
  if (adopted.item === null) return 'still_missed';
  return matchesValue(adopted.item.value, gold) ? 'rescued_correct' : 'rescued_mismatch';
}

/** 対象外セルの一致件数を返す。欠落・失敗 run は比較せず、除外論文数を返す。 */
export function outsideAgreement(initial: ReaskRun, run: ReaskRun | undefined, fieldIds: readonly string[]) {
  const counts: Record<Agreement, number> = { same: 0, different: 0, now_not_reported: 0, absent: 0 };
  if (run === undefined || run.error !== null || run.formatError !== null) return { counts, excludedPapers: 1 };
  const fields = new Set(fieldIds);
  const after = itemsByKey(run.items);
  for (const item of itemsByKey(initial.items).values()) {
    if (!fields.has(item.fieldId) || item.notReported !== false || item.value === null) continue;
    const next = after.get(cellKey(item));
    if (next === undefined) counts.absent++;
    else if (next.notReported === true || next.value === null) counts.now_not_reported++;
    else if (normalizeText(item.value) === normalizeText(next.value)) counts.same++;
    else counts.different++;
  }
  return { counts, excludedPapers: 0 };
}

/** gold の行ごとに正解を整数で返す。未報告・報告済みの条件は既存採点と揃える。 */
export function countCorrect(rows: readonly GoldRow[], items: readonly RunItem[]): number {
  const indexed = itemsByKey(items);
  return rows.filter((row) => {
    const item = indexed.get(cellKey({ fieldId: row.field_id, entityKey: row.entity_key }));
    return row.not_reported ? item?.notReported === true : item?.notReported === false && matchesValue(item.value, row);
  }).length;
}

/** 論文ごとの状態・理由・置換後正解数を返す。集計と行単位の計算が食い違えば止める。 */
export function summarizeReask(initial: ReaskRun, run: ReaskRun | undefined, cells: readonly TargetCell[], rows: readonly GoldRow[]) {
  const states = Object.fromEntries(STATES.map((state) => [state, 0])) as Record<State, number>;
  const reasons = Object.fromEntries(REASONS.map((reason) => [reason, 0])) as Record<Reason, number>;
  const gold = new Map(rows.map((row) => [cellKey({ fieldId: row.field_id, entityKey: row.entity_key }), row]));
  const merged = itemsByKey(initial.items);
  const details = cells.map((cell) => {
    const adopted = replacement(cell, run);
    const row = gold.get(cellKey(cell));
    const state = targetState(row, adopted);
    states[state]++;
    if (adopted.reason !== null) reasons[adopted.reason]++;
    else merged.set(cellKey(cell), adopted.item);
    return { ...cell, state, reason: adopted.reason, goldValue: row?.value_gold ?? null,
      reaskValue: adopted.item?.value ?? null, quote: adopted.item?.quote?.slice(0, 80) ?? null };
  });
  const initialCorrect = countCorrect(rows, initial.items);
  const mergedCorrect = countCorrect(rows, [...merged.values()]);
  if (mergedCorrect !== initialCorrect + states.rescued_correct - states.fabricated) {
    throw new Error('置換後の正解数が差分式と一致しません');
  }
  if (Object.values(states).reduce((a, b) => a + b, 0) !== cells.length ||
      Object.values(reasons).reduce((a, b) => a + b, 0) !== details.filter((detail) => detail.reason !== null).length) {
    throw new Error('対象セル・状態・不採用理由の件数が一致しません');
  }
  return { targetCount: cells.length, states, reasons, goldRows: rows.length, initialCorrect, mergedCorrect, details };
}
