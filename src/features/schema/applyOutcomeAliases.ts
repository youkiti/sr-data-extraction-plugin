import type { QuoteSetRow } from '../../domain/quoteSet';
import { isConsultAction } from '../../domain/decision';
import type { Decision } from '../../domain/decision';
import type { Evidence } from '../../domain/evidence';
import type { ResultsDataRow } from '../../domain/annotation';
import type { OutcomeListContext } from './outcomeListContext';
import { canonicalOutcomeEntityKey, outcomeIdOfEntityKey } from './outcomeListContext';
import { deriveCellStates } from '../verification/cellState';
import { isEntityInstanceDeclaration } from '../verification/instanceDeclarations';

interface AliasInput {
  /** 読み替える AI の根拠。 */
  evidence?: readonly Evidence[];
  /** 読み替える人の判定履歴。 */
  decisions?: readonly Decision[];
  /** 読み替える現在値の行。 */
  resultsRows?: readonly ResultsDataRow[];
  /** 移行後の一覧側の保存を優先して読み替える引用のスナップショット。 */
  quoteSetRows?: readonly QuoteSetRow[];
}

/**
 * 保存済みの行を変更せず、別名のセルを合流させる。
 * 衝突件数は Evidence と人の Decisions にあるセルを合わせ、study × field_id × 読み替え後の entity_key で数える。
 * 移行時刻は別名を初めて持った版の SchemaVersions.created_at とし、その後の一覧側の操作だけを優先する。
 */
export function applyOutcomeAliases<T extends AliasInput>(input: T, context: OutcomeListContext | null): T & { collisionCount: number } {
  if (context === null || context.aliasToId.size === 0) {
    return { ...input, collisionCount: 0 };
  }
  type Row = { studyId: string; fieldId: string; entityKey: string };
  const canonical = (row: Row): string => canonicalOutcomeEntityKey(row.entityKey, context);
  const cell = (row: Row): string => JSON.stringify([row.studyId, row.fieldId, canonical(row)]);
  const humanCell = (row: Row & { annotator: string }): string => JSON.stringify([cell(row), row.annotator]);
  const migrationTimes = new Map<string, string>();
  for (const row of [...(input.decisions ?? []), ...(input.resultsRows ?? []), ...(input.quoteSetRows ?? [])]) {
    const id = outcomeIdOfEntityKey(row.entityKey);
    const time = id === null ? undefined : context.aliasMigratedAt?.get(id);
    if (time !== undefined) {
      migrationTimes.set(humanCell(row), time);
    }
  }
  const afterMigration = (row: Row & { annotator: string; decidedAt: string }): boolean =>
    row.decidedAt > (migrationTimes.get(humanCell(row)) ?? '\uffff');
  const histories = new Map<string, Decision[]>();
  for (const row of input.decisions ?? []) {
    const key = JSON.stringify([humanCell(row), row.entityKey]);
    const history = histories.get(key) ?? [];
    if (!afterMigration(row)) {
      history.push(row);
    }
    histories.set(key, history);
  }
  // 要相談の印は値の判定ではないため、移行後の操作の比較から外す。
  const latestByCell = new Map<string, string>();
  for (const row of input.decisions ?? []) {
    if (isConsultAction(row.action)) {
      continue;
    }
    const historyKey = JSON.stringify([humanCell(row), row.entityKey]);
    if (row.decidedAt > (latestByCell.get(historyKey) ?? '')) {
      latestByCell.set(historyKey, row.decidedAt);
    }
  }
  const canonicalOperatedLater = (row: Row & { annotator: string }): boolean =>
    (latestByCell.get(JSON.stringify([humanCell(row), canonical(row)])) ?? '')
      > (migrationTimes.get(humanCell(row)) ?? '\uffff');
  const judgedByCell = new Map([...histories].map(([key, history]) => [key,
    [...deriveCellStates(history).values()].some((state) => state.status !== 'unverified')]));
  const judged = (row: Row & { annotator: string }): boolean => judgedByCell.get(JSON.stringify([humanCell(row), row.entityKey])) ?? false;
  const collisions = new Map<string, Set<string>>();
  const track = (row: Row): void => {
    const keys = collisions.get(cell(row)) ?? new Set<string>();
    keys.add(row.entityKey);
    collisions.set(cell(row), keys);
  };
  const evidenceWinners = new Map<string, string>();
  const aiResultWinners = new Map<string, string>();
  const humanWinners = new Map<string, Row & { annotator: string }>();
  const migrationWinners = new Map<string, Row & { annotator: string }>();
  const preferCanonical = (row: Row, previous: string): boolean => row.entityKey === canonical(row)
    || (previous !== canonical(row) && row.entityKey.localeCompare(previous) < 0);
  for (const [rows, winners] of [[input.evidence ?? [], evidenceWinners], [(input.resultsRows ?? []).filter((item) => item.annotatorType === 'ai'), aiResultWinners]] as const) {
    for (const row of rows) {
      const previous = winners.get(cell(row));
      if (previous === undefined || preferCanonical(row, previous)) {
        winners.set(cell(row), row.entityKey);
      }
    }
  }
  for (const row of input.evidence ?? []) {
    track(row);
  }
  for (const row of [...(input.decisions ?? []), ...(input.resultsRows ?? []).filter((item) => item.annotatorType !== 'ai'), ...(input.quoteSetRows ?? [])]) {
    const previous = humanWinners.get(humanCell(row));
    if (previous === undefined || (canonicalOperatedLater(row) ? preferCanonical(row, previous.entityKey)
      : judged(row) !== judged(previous) ? judged(row) : preferCanonical(row, previous.entityKey))) {
      humanWinners.set(humanCell(row), row);
    }
    const initial = migrationWinners.get(humanCell(row));
    if (initial === undefined || (judged(row) !== judged(initial) ? judged(row) : preferCanonical(row, initial.entityKey))) {
      migrationWinners.set(humanCell(row), row);
    }
  }
  for (const row of input.decisions ?? []) {
    if (row.annotatorType !== 'ai' && !isEntityInstanceDeclaration(row)) {
      track(row);
    }
  }
  // 人の判定が別名側で勝っても、AI の根拠は一覧の id 側を優先する。
  const rewrite = <R extends Row>(row: R): R => ({ ...row, entityKey: canonical(row) });
  return {
    ...input,
    ...(input.evidence === undefined ? {} : { evidence: input.evidence.filter((row) => evidenceWinners.get(cell(row)) === row.entityKey).map(rewrite) }),
    ...(input.decisions === undefined ? {} : { decisions: input.decisions.filter((row) => canonicalOperatedLater(row)
      ? afterMigration(row) ? row.entityKey === canonical(row) : migrationWinners.get(humanCell(row))?.entityKey === row.entityKey
      : humanWinners.get(humanCell(row))?.entityKey === row.entityKey).map(rewrite) }),
    ...(input.resultsRows === undefined ? {} : { resultsRows: input.resultsRows.filter((row) => row.annotatorType === 'ai'
      ? aiResultWinners.get(cell(row)) === row.entityKey : humanWinners.get(humanCell(row))?.entityKey === row.entityKey).map(rewrite) }),
    ...(input.quoteSetRows === undefined ? {} : { quoteSetRows: input.quoteSetRows.filter((row) => {
      const saved = input.quoteSetRows!.some((quote) => humanCell(quote) === humanCell(row)
        && quote.entityKey === canonical(row) && afterMigration({ ...quote, decidedAt: quote.savedAt }));
      return saved ? row.entityKey === canonical(row) : humanWinners.get(humanCell(row))?.entityKey === row.entityKey;
    }).map(rewrite) }),
    collisionCount: [...collisions.values()].filter((keys) => keys.size > 1).length,
  };
}
