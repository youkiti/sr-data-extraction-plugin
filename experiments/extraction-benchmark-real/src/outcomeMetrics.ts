import { parseEntityKey } from '../../../src/utils/entityKey';
import { matchesValue, type RunItem } from './metrics';
import type { GoldRow } from './validateGold';

export type OutcomeRun = { error: string | null; formatError: string | null; items: RunItem[] };
export const STATES = ['no_run', 'run_failed', 'omitted', 'said_not_reported', 'correct', 'wrong_value', 'nr_omitted', 'nr_correct', 'nr_gave_value'] as const;
export type OutcomeState = typeof STATES[number];

export function outcomeState(row: GoldRow, run: OutcomeRun | undefined): OutcomeState {
  if (!run) return 'no_run';
  if (run.error !== null || run.formatError !== null) return 'run_failed';
  const items = new Map(run.items.map((item) => [JSON.stringify([item.fieldId, item.entityKey]), item]));
  const item = items.get(JSON.stringify([row.field_id, row.entity_key]));
  if (!item) return row.not_reported ? 'nr_omitted' : 'omitted';
  if (item.notReported || item.value === null) return row.not_reported ? 'nr_correct' : 'said_not_reported';
  if (row.not_reported) return 'nr_gave_value';
  return matchesValue(item.value, row) ? 'correct' : 'wrong_value';
}

export function discoverValue(row: GoldRow, run: OutcomeRun | undefined): { foundSameArm: boolean; foundAnyArm: boolean } {
  let foundSameArm = false, foundAnyArm = false;
  const goldKey = parseEntityKey(row.entity_key);
  if (!row.not_reported && run && run.error === null && run.formatError === null && goldKey?.level === 'outcome_result') {
    for (const item of run.items) {
      const key = parseEntityKey(item.entityKey);
      if (key?.level !== 'outcome_result' || item.fieldId !== row.field_id || item.notReported || !matchesValue(item.value, row)) continue;
      foundAnyArm = true;
      if (key.arm === goldKey.arm) foundSameArm = true;
    }
  }
  return { foundSameArm, foundAnyArm };
}

export function outcomeVocabulary(items: readonly RunItem[]) {
  const slugs = new Set<string>(), times = new Set<string>(), arms = new Set<string>(), groups = new Set<string>();
  let elementCount = 0;
  for (const item of items) {
    const key = parseEntityKey(item.entityKey);
    if (key?.level !== 'outcome_result') continue;
    slugs.add(key.outcome); times.add(key.time ?? '(none)'); arms.add(key.arm ?? '(none)');
    groups.add(JSON.stringify([key.outcome, key.arm, key.time]));
    elementCount++;
  }
  return { slugs: [...slugs].sort(), times: [...times].sort(), arms: [...arms].sort(), groupCount: groups.size, elementCount };
}
