// アウトカムの一覧の版と、キーの所属・一覧外の候補の判定をまとめる。
import type { SchemaOutcome } from '../../domain/schemaOutcome';
import type { SchemaVersion } from '../../domain/schemaVersion';
import { parseEntityKey } from '../../utils/entityKey';
import { isOutcomeListMode, outcomesForVersion } from './schemaOutcomes';

export interface OutcomeListContext {
  schemaVersion: number;
  outcomes: readonly SchemaOutcome[];
  currentIds: ReadonlySet<string>;
  everIds: ReadonlySet<string>;
}

/** 指定版の一覧と全版の id を解決し、論文単位モードなら null を返す。 */
export function buildOutcomeListContext(all: readonly SchemaOutcome[], versionsDesc: readonly SchemaVersion[], version: number): OutcomeListContext | null {
  if (!isOutcomeListMode(all)) {
    return null;
  }
  const resolved = outcomesForVersion(all, versionsDesc, version);
  if (resolved.sourceVersion === null) {
    throw new Error(`版 ${version} 以前にアウトカムの一覧がありません`);
  }
  return {
    schemaVersion: resolved.sourceVersion,
    outcomes: resolved.outcomes,
    currentIds: new Set(resolved.outcomes.map((row) => row.outcomeId)),
    everIds: new Set(all.map((row) => row.outcomeId)),
  };
}

/** アウトカムのキー、または estimate 別の RoB キーから参照先の id を返す。 */
export function outcomeIdOfEntityKey(entityKey: string): string | null {
  const parsed = parseEntityKey(entityKey);
  if (parsed?.level === 'outcome_result' || parsed?.level === 'rob_domain') {
    return parsed.outcome ?? null;
  }
  return null;
}

/** 一覧モードではアウトカムを参照するキーだけ現行の一覧との所属を判定する。 */
export function isEntityKeyInOutcomeList(entityKey: string, context: OutcomeListContext | null): boolean {
  if (context === null) {
    return true;
  }
  const outcomeId = outcomeIdOfEntityKey(entityKey);
  return outcomeId === null || context.currentIds.has(outcomeId);
}

/** 過去のどの版の一覧にも無い id だけを一覧外の候補とする。 */
export function isOutcomeListCandidateId(outcomeId: string, context: OutcomeListContext): boolean {
  return !context.everIds.has(outcomeId);
}
