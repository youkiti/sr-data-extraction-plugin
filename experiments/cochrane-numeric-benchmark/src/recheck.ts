import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { benchRoot } from './config';
import { sha256 } from './io';
import type { EvalValue, Label } from './evaluationSet';

export const recheckLabelsPath = () => path.join(benchRoot, 'outputs', 'recheck-labels.jsonl');
export interface RecheckLabel { rowId: string; field: string; label: Label }
export function applyRecheckLabels(values: EvalValue[], labels: RecheckLabel[], allValues = values): EvalValue[] {
  const key = (value: { rowId: string; field: string }) => `${value.rowId}\t${value.field}`;
  const map = new Map<string, Label>();
  // BENCH_TIERS で層を絞ったときは、読み込んでいないレビューの行を読み飛ばす（rowId は `<reviewId>:` で始まる）。
  const loadedReviews = new Set(allValues.map((value) => value.reviewId));
  for (const line of labels) {
    if (!['reported', 'derivable', 'different_value', 'not_in_documents'].includes(line.label)) throw new Error('再チェックラベルが不正です');
    if (!loadedReviews.has(line.rowId.split(':')[0] ?? '')) continue;
    if (!allValues.some((value) => key(value) === key(line) && value.needsRecheck)) throw new Error('再チェック不要の値にラベルがあります');
    if (map.has(key(line))) throw new Error('再チェックラベルが重複しています');
    map.set(key(line), line.label);
  }
  return values.map((value) => map.has(key(value)) ? { ...value, label: map.get(key(value))!, relabelled: true } : value);
}
export function assertRechecked(values: EvalValue[]): void {
  const count = values.filter((value) => value.needsRecheck && !value.relabelled).length;
  if (count) throw new Error(`再チェック未完了の値が ${count} 件あります。${recheckLabelsPath()} を埋めてください`);
}
export async function loadRecheck(values: EvalValue[], allValues = values): Promise<{ values: EvalValue[]; hash: string | null }> {
  let raw = '';
  try { raw = await readFile(recheckLabelsPath(), 'utf8'); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const updated = applyRecheckLabels(values, raw.split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line) as RecheckLabel), allValues);
  assertRechecked(updated);
  return { values: updated, hash: allValues.some((value) => value.needsRecheck) ? sha256(raw) : null };
}
