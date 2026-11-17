import type { Decision } from '../../domain/decision';
import type { Evidence } from '../../domain/evidence';
import type { SchemaField } from '../../domain/schemaField';
import type { SchemaOutcomeEditorRow } from './types';
import type { OutcomeListContext } from './outcomeListContext';
import { parseEntityKey } from '../../utils/entityKey';
import { countJudgedCellsForOutcome, isValidOutcomeId, suggestOutcomeId } from './schemaOutcomes';

export interface OutcomeMigrationRow {
  /** 既存のアウトカムの id。 */
  id: string;
  /** 元の id が一覧の id の規則に合わないときの新しい id。合うときは null。 */
  newId: string | null;
  /** 一覧に含めるか。 */
  selected: boolean;
  /** 一覧に表示する名称。 */
  label: string;
  /** 別名としてまとめる先。 */
  target: string | null;
  /** この id がある研究数。 */
  studies: number;
  /** 判定済みセル数。 */
  judgedCells: number;
}

/** インスタンス宣言を含む既存のアウトカムを集め、最多の AI 名を初期値にする。 */
export function buildOutcomeMigrationRows(evidence: readonly Evidence[], decisions: readonly Decision[], fields: readonly SchemaField[]): OutcomeMigrationRow[] {
  const studies = new Map<string, Set<string>>();
  const names = new Map<string, Map<string, number>>();
  const nameFields = new Set(fields.filter((field) => field.fieldName === 'outcome_name').map((field) => field.fieldId));
  for (const row of [...evidence, ...decisions]) {
    const parsed = parseEntityKey(row.entityKey);
    if (parsed?.level !== 'outcome_result') {
      continue;
    }
    const group = studies.get(parsed.outcome) ?? new Set<string>();
    group.add(row.studyId);
    studies.set(parsed.outcome, group);
  }
  for (const row of evidence) {
    const parsed = parseEntityKey(row.entityKey);
    if (parsed?.level !== 'outcome_result' || !nameFields.has(row.fieldId) || !row.value) {
      continue;
    }
    const group = names.get(parsed.outcome) ?? new Map<string, number>();
    group.set(row.value, (group.get(row.value) ?? 0) + 1);
    names.set(parsed.outcome, group);
  }
  const taken = new Set(studies.keys());
  return [...studies].map(([id, group]) => {
    const newId = isValidOutcomeId(id) ? null : suggestOutcomeId(id, taken);
    if (newId !== null) {
      taken.add(newId);
    }
    return {
      id, newId, selected: true, target: null, studies: group.size,
      label: [...(names.get(id) ?? [])].sort((a, b) => b[1] - a[1])[0]?.[0] ?? id,
      judgedCells: countJudgedCellsForOutcome(decisions, id).cells,
    };
  });
}

/** 選んだ id と一段だけの別名を最初の一覧の行へ変換する。 */
export function migrationOutcomes(rows: readonly OutcomeMigrationRow[]): SchemaOutcomeEditorRow[] {
  return rows.filter((row) => row.selected && row.target === null).map((row) => ({
    outcomeId: row.newId ?? row.id, outcomeLabel: row.label,
    aliases: [...(row.newId !== null ? [row.id] : []), ...rows.filter((alias) => alias.target === row.id).map((alias) => alias.id)],
    description: null, typicalTimepoints: null, addedVia: 'migration', note: null, idLocked: true, idEdited: false,
  }));
}

/** 保存前の別名の衝突集計に使う文脈を作る。 */
export function migrationContext(rows: readonly OutcomeMigrationRow[]): OutcomeListContext {
  const outcomes = migrationOutcomes(rows).map((row, index) => ({ ...row, schemaVersion: 0, outcomeIndex: index + 1 }));
  const ids = new Set(outcomes.flatMap((row) => [row.outcomeId, ...row.aliases]));
  return { schemaVersion: 0, outcomes, currentIds: ids, everIds: ids,
    aliasToId: new Map(outcomes.flatMap((row) => row.aliases.map((alias) => [alias, row.outcomeId] as const))) };
}
