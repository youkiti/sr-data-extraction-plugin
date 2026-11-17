// アウトカムの一覧の版と、キーの所属・一覧外の候補の判定をまとめる。
import type { SchemaOutcome } from '../../domain/schemaOutcome';
import type { SchemaVersion } from '../../domain/schemaVersion';
import type { Evidence } from '../../domain/evidence';
import type { SchemaField } from '../../domain/schemaField';
import { parseEntityKey } from '../../utils/entityKey';
import { isOutcomeListMode, outcomesForVersion } from './schemaOutcomes';

export interface OutcomeListContext {
  schemaVersion: number;
  outcomes: readonly SchemaOutcome[];
  currentIds: ReadonlySet<string>;
  everIds: ReadonlySet<string>;
  /** 現行版の別名から一覧の id への対応。 */
  aliasToId: ReadonlyMap<string, string>;
  /** 別名を初めて持った版の確定時刻。保存前の文脈では省略する。 */
  aliasMigratedAt?: ReadonlyMap<string, string>;
}

/** 指定版の一覧と全版の id を解決し、その版以前に一覧が無ければ null を返す。 */
export function buildOutcomeListContext(all: readonly SchemaOutcome[], versionsDesc: readonly SchemaVersion[], version: number): OutcomeListContext | null {
  if (!isOutcomeListMode(all)) {
    return null;
  }
  const resolved = outcomesForVersion(all, versionsDesc, version);
  if (resolved.sourceVersion === null) {
    return null;
  }
  return {
    schemaVersion: resolved.sourceVersion,
    outcomes: resolved.outcomes,
    currentIds: new Set(resolved.outcomes.flatMap((row) => [row.outcomeId, ...row.aliases])),
    everIds: new Set(all.flatMap((row) => [row.outcomeId, ...row.aliases])),
    aliasToId: new Map(resolved.outcomes.flatMap((row) => row.aliases.map((alias) => [alias, row.outcomeId] as const))),
    aliasMigratedAt: new Map(resolved.outcomes.flatMap((row) => row.aliases.flatMap((alias) => {
      const first = all.filter((item) => item.outcomeId === row.outcomeId && item.aliases.includes(alias))
        .sort((a, b) => a.schemaVersion - b.schemaVersion)[0]!;
      const createdAt = versionsDesc.find((item) => item.schemaVersion === first.schemaVersion)?.createdAt;
      return createdAt === undefined ? [] : [[alias, createdAt] as const];
    }))),
  };
}

/** アウトカムと estimate 別 RoB の参照先を一覧の id に読み替える。 */
export function canonicalOutcomeEntityKey(entityKey: string, context: OutcomeListContext | null): string {
  const id = outcomeIdOfEntityKey(entityKey);
  const canonical = id === null ? undefined : context?.aliasToId.get(id);
  if (canonical === undefined) {
    return entityKey;
  }
  return entityKey.split('|').map((segment) => segment === `outcome:${id}` ? `outcome:${canonical}` : segment).join('|');
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

export interface OutcomeListCandidate {
  id: string;
  name: string | null;
  evidence: Evidence[];
}

/** study の AI 根拠から、過去の一覧にも無いアウトカムを初出順に集める。 */
export function outcomeListCandidates(
  studyId: string,
  evidence: readonly Evidence[],
  fields: readonly SchemaField[],
  context: OutcomeListContext,
): OutcomeListCandidate[] {
  const names = new Set(fields.filter((field) => field.fieldName === 'outcome_name').map((field) => field.fieldId));
  const candidates = new Map<string, OutcomeListCandidate>();
  for (const item of evidence) {
    const parsed = parseEntityKey(item.entityKey);
    if (item.studyId !== studyId || parsed?.level !== 'outcome_result' || !isOutcomeListCandidateId(parsed.outcome, context)) {
      continue;
    }
    let candidate = candidates.get(parsed.outcome);
    if (candidate === undefined) {
      candidate = { id: parsed.outcome, name: null, evidence: [] };
      candidates.set(parsed.outcome, candidate);
    }
    candidate.evidence.push(item);
    if (candidate.name === null && names.has(item.fieldId) && item.value !== null) {
      candidate.name = item.value;
    }
  }
  return [...candidates.values()];
}
