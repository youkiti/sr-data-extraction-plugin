import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { benchRoot } from './config';
import { sha256 } from './io';
import type { EvalValue, Label } from './evaluationSet';

export const recheckLabelsPath = () => path.join(benchRoot, 'outputs', 'recheck-labels.jsonl');
export interface RecheckLabel { rowId: string; field: string; label: Label }
export function applyRecheckLabels(values: EvalValue[], labels: RecheckLabel[]): EvalValue[] {
  const key = (value: { rowId: string; field: string }) => `${value.rowId}\t${value.field}`;
  const map = new Map<string, Label>();
  for (const line of labels) {
    if (!['reported', 'derivable', 'different_value', 'not_in_documents'].includes(line.label)) throw new Error('再チェックラベルが不正です');
    if (!values.some((value) => key(value) === key(line) && value.needsRecheck)) throw new Error('再チェック不要の値にラベルがあります');
    if (map.has(key(line))) throw new Error('再チェックラベルが重複しています');
    map.set(key(line), line.label);
  }
  return values.map((value) => map.has(key(value)) ? { ...value, label: map.get(key(value))!, relabelled: true } : value);
}
export function assertRechecked(values: EvalValue[]): void {
  const count = values.filter((value) => value.needsRecheck && !value.relabelled).length;
  if (count) throw new Error(`再チェック未完了の値が ${count} 件あります。${recheckLabelsPath()} を埋めてください`);
}
export async function loadRecheck(values: EvalValue[]): Promise<{ values: EvalValue[]; hash: string | null }> {
  let raw = '';
  try { raw = await readFile(recheckLabelsPath(), 'utf8'); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const updated = applyRecheckLabels(values, raw.split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line) as RecheckLabel));
  assertRechecked(updated);
  return { values: updated, hash: values.some((value) => value.needsRecheck) ? sha256(raw) : null };
}
