// 合格基準の検証・版管理・判定・CSV を共通化する（issue #382）。
// 正典は docs/requirements.md §8「合格基準の事前登録」。
import type { EntityLevel } from '../../domain/schemaField';
import { SHEET_HEADERS } from '../../domain/sheetsSchema';
import { buildCsv } from '../export/csvEncode';
import { summarizeComparison, type ComparisonCell, type ComparisonGroup } from './aiHumanComparison';

export const CRITERIA_LEVELS: readonly EntityLevel[] = ['study', 'arm', 'outcome_result', 'rob_domain'];
export const CRITERIA_GROUPS: readonly ComparisonGroup[] = ['independent', 'consensus', 'human_independent', 'human_with_ai'];
export const RATE_KEYS = ['min_accuracy', 'max_fabrication_rate', 'max_omission_rate', 'max_wrong_value_rate'] as const;
export type CriteriaRate = typeof RATE_KEYS[number];
export interface CriteriaDraft {
  comparator: ComparisonGroup;
  entity_levels: EntityLevel[];
  min_accuracy: string;
  max_fabrication_rate: string;
  max_omission_rate: string;
  max_wrong_value_rate: string;
  min_compared_cells: string;
  note: string;
}
export interface AcceptanceCriteria extends Record<CriteriaRate, number | null> {
  version: number;
  confirmed_at: string;
  confirmed_by: string;
  comparator: ComparisonGroup;
  entity_levels: EntityLevel[];
  min_compared_cells: number | null;
  pilot_runs_before: number;
  note: string;
}
export type PilotRun = { studyIds: readonly string[]; runType: string };
export interface CriteriaEvaluation {
  checks: Record<CriteriaRate | 'min_compared_cells', boolean | null>;
  result: 'met' | 'not_met' | 'not_evaluable';
  not_evaluable_reason: 'no_pilot' | 'no_compared_cells' | 'below_minimum' | '';
  compared: number;
  accuracy: number | null;
  fabrication_rate: number | null;
  omission_rate: number | null;
  wrong_value_rate: number | null;
  pilot_studies: number;
}

export function emptyCriteriaDraft(): CriteriaDraft {
  return { comparator: 'independent', entity_levels: [...CRITERIA_LEVELS], min_accuracy: '',
    max_fabrication_rate: '', max_omission_rate: '', max_wrong_value_rate: '', min_compared_cells: '', note: '' };
}

/** 空欄とゼロを区別し、不正な数値を確定前に拒否する。 */
export function validateCriteriaDraft(draft: CriteriaDraft): string[] {
  const errors: string[] = [];
  if (!CRITERIA_GROUPS.includes(draft.comparator)) {
    errors.push('comparator');
  }
  if (draft.entity_levels.length === 0 || draft.entity_levels.some((level) => !CRITERIA_LEVELS.includes(level))) {
    errors.push('entity_levels');
  }
  if (RATE_KEYS.every((key) => draft[key].trim() === '')) {
    errors.push('rates_required');
  }
  for (const key of RATE_KEYS) {
    const value = draft[key].trim();
    if (value !== '' && (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 100)) {
      errors.push(key);
    }
  }
  const count = draft.min_compared_cells.trim();
  if (count !== '' && (!Number.isSafeInteger(Number(count)) || Number(count) <= 0)) {
    errors.push('min_compared_cells');
  }
  return errors;
}

export function currentCriteria(rows: readonly AcceptanceCriteria[]): AcceptanceCriteria | null {
  return rows.reduce<AcceptanceCriteria | null>((latest, row) => latest === null || row.version > latest.version ? row : latest, null);
}

function validTimestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
}

function validEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+$/.test(value);
}

export function confirmCriteria(
  draft: CriteriaDraft, rows: readonly AcceptanceCriteria[], email: string, now: string, pilotCount: number,
): AcceptanceCriteria {
  const errors = validateCriteriaDraft(draft);
  if (errors.length > 0 || !validEmail(email) || !validTimestamp(now)) {
    throw new Error(`Invalid acceptance criteria: ${errors.join(', ')}`);
  }
  const numberOrNull = (value: string): number | null => value.trim() === '' ? null : Number(value);
  return { version: (currentCriteria(rows)?.version ?? 0) + 1, confirmed_at: now, confirmed_by: email,
    comparator: draft.comparator, entity_levels: [...new Set(draft.entity_levels)],
    min_accuracy: numberOrNull(draft.min_accuracy), max_fabrication_rate: numberOrNull(draft.max_fabrication_rate),
    max_omission_rate: numberOrNull(draft.max_omission_rate), max_wrong_value_rate: numberOrNull(draft.max_wrong_value_rate),
    min_compared_cells: numberOrNull(draft.min_compared_cells),
    pilot_runs_before: pilotCount, note: draft.note };
}

export function criteriaToRow(criteria: AcceptanceCriteria): string[] {
  return SHEET_HEADERS.AcceptanceCriteria.map((key) => {
    const value = criteria[key as keyof AcceptanceCriteria];
    return Array.isArray(value) ? value.join(',') : String(value ?? '');
  });
}

/** 読めない行は採用せず、呼び出し側へ警告件数を返す。 */
export function parseCriteriaRows(rows: readonly (readonly string[])[]): { versions: AcceptanceCriteria[]; ignoredCount: number } {
  const versions: AcceptanceCriteria[] = [];
  let ignoredCount = 0;
  for (const row of rows) {
    const draft: CriteriaDraft = { comparator: row[3] as ComparisonGroup, entity_levels: (row[4] ?? '').split(',') as EntityLevel[],
      min_accuracy: row[5] ?? '', max_fabrication_rate: row[6] ?? '', max_omission_rate: row[7] ?? '',
      max_wrong_value_rate: row[8] ?? '', min_compared_cells: row[9] ?? '', note: row[11] ?? '' };
    const version = Number(row[0]);
    const pilotCount = Number(row[10]);
    if (validateCriteriaDraft(draft).length > 0 || !Number.isSafeInteger(version) || version < 1 ||
        !Number.isSafeInteger(pilotCount) || pilotCount < 0 || row[10]!.trim() === '' ||
        !validTimestamp(row[1] ?? '') || !validEmail(row[2] ?? '')) {
      ignoredCount++;
      continue;
    }
    const parsed = confirmCriteria(draft, [], row[2]!, row[1]!, 0);
    versions.push({ ...parsed, version, pilot_runs_before: pilotCount });
  }
  return { versions: versions.sort((a, b) => b.version - a.version), ignoredCount };
}

export function pilotStudyIds(runs: readonly PilotRun[], activeStudyIds: ReadonlySet<string>): Set<string> {
  return new Set(runs.filter((run) => run.runType === 'pilot').flatMap((run) => run.studyIds).filter((id) => activeStudyIds.has(id)));
}

/** 比較集計の率を百分率へ変換し、等号を含む境界で判定する。 */
export function evaluateCriteria(
  criteria: AcceptanceCriteria, cells: readonly ComparisonCell[], runs: readonly PilotRun[], activeStudyIds: ReadonlySet<string>,
): CriteriaEvaluation {
  const studyIds = pilotStudyIds(runs, activeStudyIds);
  const summary = summarizeComparison(cells, { studyIds, entityLevels: new Set(criteria.entity_levels) })
    .find((row) => row.group === criteria.comparator && row.entityLevel === null && row.fieldId === null);
  const percent = (value: number | null | undefined): number | null => value == null ? null : value * 100;
  const values = { compared: summary?.compared ?? 0, accuracy: percent(summary?.accuracy),
    fabrication_rate: percent(summary?.fabricationRate), omission_rate: percent(summary?.omissionRate),
    wrong_value_rate: percent(summary?.wrongValueRate), pilot_studies: studyIds.size };
  const reason = !runs.some((run) => run.runType === 'pilot') ? 'no_pilot' : values.compared === 0 ? 'no_compared_cells'
    : values.compared < (criteria.min_compared_cells ?? 1) ? 'below_minimum' : '';
  // 割り算の丸めで等号を落とさないよう、百分率と件数を交差乗算する。
  const check = (threshold: number | null, passed: boolean): boolean | null =>
    threshold === null || values.compared === 0 ? null : passed;
  const checks: CriteriaEvaluation['checks'] = {
    min_accuracy: check(criteria.min_accuracy, (summary?.match ?? 0) * 100 >= (criteria.min_accuracy ?? 0) * values.compared),
    max_fabrication_rate: check(criteria.max_fabrication_rate,
      (summary?.fabrication ?? 0) * 100 <= (criteria.max_fabrication_rate ?? 0) * values.compared),
    max_omission_rate: check(criteria.max_omission_rate, (summary?.omission ?? 0) * 100 <= (criteria.max_omission_rate ?? 0) * values.compared),
    max_wrong_value_rate: check(criteria.max_wrong_value_rate,
      (summary?.wrong_value ?? 0) * 100 <= (criteria.max_wrong_value_rate ?? 0) * values.compared),
    min_compared_cells: check(criteria.min_compared_cells, values.compared >= (criteria.min_compared_cells ?? 0)),
  };
  const met = Object.values(checks).every((value) => value !== false);
  return { ...values, checks, result: reason !== '' ? 'not_evaluable' : met ? 'met' : 'not_met', not_evaluable_reason: reason };
}

export const CRITERIA_RESULT_COLUMNS = ['result', 'not_evaluable_reason', 'compared', 'accuracy', 'fabrication_rate',
  'omission_rate', 'wrong_value_rate', 'pilot_studies'] as const;

export function buildAcceptanceCriteriaCsv(
  versions: readonly AcceptanceCriteria[], cells: readonly ComparisonCell[], runs: readonly PilotRun[], activeStudyIds: ReadonlySet<string>,
): string {
  return buildCsv([...SHEET_HEADERS.AcceptanceCriteria, ...CRITERIA_RESULT_COLUMNS], versions.map((criteria) => {
    const result = evaluateCriteria(criteria, cells, runs, activeStudyIds);
    return [...criteriaToRow(criteria), ...CRITERIA_RESULT_COLUMNS.map((key) => String(result[key] ?? ''))];
  }));
}
