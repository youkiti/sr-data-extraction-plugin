// アウトカムの一覧の版解決・編集時の検証・判定済みセルの集計。
import type { Decision } from '../../domain/decision';
import type { SchemaOutcome } from '../../domain/schemaOutcome';
import type { SchemaVersion } from '../../domain/schemaVersion';
import { t } from '../../lib/i18n';
import { nextOutcomeId, parseEntityKey } from '../../utils/entityKey';
import { deriveCellStates } from '../verification/cellState';
import { isEntityInstanceDeclaration } from '../verification/instanceDeclarations';
import type { SchemaOutcomeEditorRow } from './types';

/** 指定版の一覧を解決し、行が無いときは直近の前の版を使う。 */
export function outcomesForVersion(all: readonly SchemaOutcome[], versionsDesc: readonly SchemaVersion[], version: number): {
  outcomes: SchemaOutcome[]; sourceVersion: number | null;
} {
  const candidates = [version, ...versionsDesc.map((row) => row.schemaVersion).filter((v) => v < version).sort((a, b) => b - a)];
  for (const candidate of candidates) {
    const outcomes = all.filter((row) => row.schemaVersion === candidate).sort((a, b) => a.outcomeIndex - b.outcomeIndex);
    if (outcomes.length > 0) {
      return { outcomes, sourceVersion: candidate };
    }
  }
  return { outcomes: [], sourceVersion: null };
}

/** 過去のいずれかの版に一覧があるかを判定する。 */
export function isOutcomeListMode(all: readonly SchemaOutcome[]): boolean {
  return all.length > 0;
}

/** 編集中の一覧に無い id の最終版の行を復元候補として返す。 */
export function restorableOutcomes(all: readonly SchemaOutcome[], editorIds: Iterable<string>): SchemaOutcome[] {
  const ids = new Set(editorIds);
  const latest = new Map<string, SchemaOutcome>();
  for (const row of all) {
    if (!ids.has(row.outcomeId) && (!latest.has(row.outcomeId) || latest.get(row.outcomeId)!.schemaVersion < row.schemaVersion)) {
      latest.set(row.outcomeId, row);
    }
  }
  return [...latest.values()];
}

/** 表示名から重複しない id を作り、使えない場合は連番を振る。 */
export function slugifyOutcomeLabel(label: string, existingIds: Iterable<string>): string {
  const ids = new Set(existingIds);
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (/^[a-z]/.test(slug) && !ids.has(slug)) {
    return slug;
  }
  return nextOutcomeId([...ids].map((id) => `outcome:${id}`));
}

/** アウトカムの入力エラーと対象行を表す。 */
export interface OutcomeValidationError {
  index: number;
  message: string;
}

/** id・表示名と一覧作成後の最低件数を検証する。 */
export function validateOutcomeRows(rows: readonly (Pick<SchemaOutcomeEditorRow, 'outcomeId' | 'outcomeLabel'> & Partial<Pick<SchemaOutcomeEditorRow, 'aliases'>>)[], options: { listModeBefore: boolean }): OutcomeValidationError[] {
  const errors: OutcomeValidationError[] = [];
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    for (const value of [row.outcomeId, ...(row.aliases ?? [])]) {
      const id = value.trim();
      if (!/^[a-z][a-z0-9_]*$/.test(id) || id.length > 64) {
        errors.push({ index, message: t('schema.outcomeInvalidId') });
      }
      if (seen.has(id)) {
        errors.push({ index, message: t('schema.outcomeDuplicateId') });
      }
      seen.add(id);
    }
    if (row.outcomeLabel.trim() === '') {
      errors.push({ index, message: t('schema.outcomeEmptyLabel') });
    }
  });
  if (options.listModeBefore && rows.length === 0) {
    errors.push({ index: -1, message: t('schema.outcomeLastRequired') });
  }
  return errors;
}

/** アウトカムに紐づく判定済みセルと論文の件数を集計する。 */
export function countJudgedCellsForOutcome(decisions: readonly Decision[], outcomeId: string): { cells: number; studies: number } {
  const groups = new Map<string, Decision[]>();
  for (const decision of decisions) {
    if (isEntityInstanceDeclaration(decision)) {
      continue;
    }
    const key = JSON.stringify([decision.studyId, decision.annotator]);
    const group = groups.get(key) ?? [];
    group.push(decision);
    groups.set(key, group);
  }
  let cells = 0;
  const studies = new Set<string>();
  for (const group of groups.values()) {
    for (const cell of deriveCellStates(group).values()) {
      if (cell.status === 'unverified') {
        continue;
      }
      const decision = cell.stack[cell.stack.length - 1]!;
      const parsed = parseEntityKey(decision.entityKey);
      if ((parsed?.level === 'outcome_result' || parsed?.level === 'rob_domain') && parsed.outcome === outcomeId) {
        cells += 1;
        studies.add(decision.studyId);
      }
    }
  }
  return { cells, studies: studies.size };
}
