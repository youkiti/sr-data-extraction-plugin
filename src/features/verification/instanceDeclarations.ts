// AI が生成しなかった entity インスタンスを人間が宣言する監査イベント。
// 通常のセル判定と同じ Decisions タブに追記するが、予約 field_id で区別し、
// StudyData / ResultsData の annotator 行は更新しない。
import type { AnnotatorType } from '../../domain/annotation';
import type { Decision } from '../../domain/decision';
import {
  makeOutcomeEntityKey,
  makeRobEstimateEntityKey,
  parseEntityKey,
} from '../../utils/entityKey';

export const ENTITY_INSTANCE_DECLARATION_FIELD_ID = '__entity_instance__';
export const OUTCOME_INSTANCE_DECLARATION_NOTE = 'outcome_instance_declared';
export const ROB_ESTIMATE_INSTANCE_DECLARATION_NOTE = 'rob_estimate_instance_declared';

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

export interface RobEstimateDeclarationInput {
  studyId: string;
  /** テンプレート由来のドメイン id（robEstimateFields.robDomainOptions の選択値） */
  domainId: string;
  /** 参照先 outcome_result インスタンスキー（正準形） */
  outcomeKey: string;
  annotator: string;
  annotatorType: AnnotatorType;
  schemaVersion: number;
  decidedAt: string;
}

/**
 * estimate 別 RoB オーバーライド（issue #109）の宣言キーを組み立てる。
 * 参照先が outcome_result インスタンスキーとして読めない場合はエラー
 */
export function robEstimateEntityKeyOf(domainId: string, outcomeKey: string): string {
  const parsed = parseEntityKey(outcomeKey);
  if (parsed?.level !== 'outcome_result') {
    throw new Error(`outcome_result キー ${outcomeKey} が不正です`);
  }
  return makeRobEstimateEntityKey(domainId, {
    outcome: parsed.outcome,
    arm: parsed.arm ?? undefined,
    time: parsed.time ?? undefined,
  });
}

/**
 * estimate 別 RoB オーバーライドのインスタンス宣言イベント（issue #109）。
 * outcome_result の「アウトカムを追加」と同型（予約 field_id の Decisions 追記のみ）
 */
export function buildRobEstimateDeclarationDecisions(
  input: RobEstimateDeclarationInput,
): Decision[] {
  const entityKey = robEstimateEntityKeyOf(input.domainId, input.outcomeKey);
  return [
    {
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
      note: ROB_ESTIMATE_INSTANCE_DECLARATION_NOTE,
    },
  ];
}
