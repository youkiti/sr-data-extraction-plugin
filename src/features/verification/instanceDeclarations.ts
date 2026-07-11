// AI が生成しなかった entity インスタンスを人間が宣言する監査イベント。
// 通常のセル判定と同じ Decisions タブに追記するが、予約 field_id で区別し、
// StudyData / ResultsData の annotator 行は更新しない。
import type { AnnotatorType } from '../../domain/annotation';
import type { Decision } from '../../domain/decision';
import { makeOutcomeEntityKey, parseEntityKey } from '../../utils/entityKey';

export const ENTITY_INSTANCE_DECLARATION_FIELD_ID = '__entity_instance__';
export const OUTCOME_INSTANCE_DECLARATION_NOTE = 'outcome_instance_declared';

export interface ArmKeyRef {
  armKey: string;
}

export interface OutcomeDeclarationInput {
  studyId: string;
  outcomeId: string;
  time: string | null;
  arms: readonly ArmKeyRef[];
  annotator: string;
  /** 判定を書き込む annotator_type（呼び出し側が bundle から渡す。design §5.2） */
  annotatorType: AnnotatorType;
  schemaVersion: number;
  decidedAt: string;
}

export function isEntityInstanceDeclaration(decision: Decision): boolean {
  return decision.fieldId === ENTITY_INSTANCE_DECLARATION_FIELD_ID;
}

export function outcomeEntityKeysForArms(input: {
  outcomeId: string;
  time: string | null;
  arms: readonly ArmKeyRef[];
}): string[] {
  if (input.arms.length === 0) {
    throw new Error('確定済みの群がありません');
  }
  const keys: string[] = [];
  for (const arm of input.arms) {
    const parsed = parseEntityKey(arm.armKey);
    if (parsed?.level !== 'arm') {
      throw new Error(`arm_key ${arm.armKey} が不正です`);
    }
    keys.push(
      makeOutcomeEntityKey({
        outcome: input.outcomeId,
        arm: parsed.arm,
        time: input.time === null ? undefined : input.time,
      }),
    );
  }
  const unique = new Set(keys);
  if (unique.size !== keys.length) {
    throw new Error('生成される outcome_result キーが重複しています');
  }
  return keys;
}

export function buildOutcomeDeclarationDecisions(input: OutcomeDeclarationInput): Decision[] {
  return outcomeEntityKeysForArms(input).map((entityKey) => ({
    decidedAt: input.decidedAt,
    decidedBy: input.annotator,
    studyId: input.studyId,
    fieldId: ENTITY_INSTANCE_DECLARATION_FIELD_ID,
    entityKey,
    annotator: input.annotator,
    annotatorType: input.annotatorType,
    schemaVersion: input.schemaVersion,
    action: 'edit',
    value: entityKey,
    note: OUTCOME_INSTANCE_DECLARATION_NOTE,
  }));
}
