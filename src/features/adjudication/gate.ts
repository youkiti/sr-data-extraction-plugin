// study 単位の裁定ゲート（docs/design-independent-dual-review.md §6.1）。
// 両 annotator の検証進捗が 100%（判定済みセル数 = 総セル数。かつ総セル数 > 0）の study だけ
// 裁定開始可とする。検証画面と同じセル集合を使い、AI を見て検証する人は表示中の
// run の Evidence を含め、独立入力の人は含めない。
import type { ConfirmedArmStructure } from '../../domain/armStructure';
import type { Evidence } from '../../domain/evidence';
import type { Decision } from '../../domain/decision';
import type { SchemaField } from '../../domain/schemaField';
import { verificationProgress } from '../verification/progress';

export interface AnnotatorProgressSummary {
  annotator: string;
  decided: number;
  total: number;
  /** 総セル数 > 0 かつ全セル判定済み */
  complete: boolean;
}

/** 本人の判定が独立入力のみなら、AI 抽出由来のセルを進捗に含めない */
export function isIndependentAnnotator(own: readonly Decision[]): boolean {
  return own.some((decision) => decision.annotatorType === 'human_independent') &&
    !own.some((decision) => decision.annotatorType === 'human_with_ai');
}

/**
 * 1 annotator の進捗を検証画面と同じセル集合で数える。
 * studyDecisions と aiEvidence は呼び出し側で同じ study に絞り込み、
 * aiEvidence は表示中の run を合成したものを渡す。独立入力だけの人は Evidence を使わない。
 */
export function computeAnnotatorProgress(
  annotator: string,
  fields: readonly SchemaField[],
  studyDecisions: readonly Decision[],
  armStructure: ConfirmedArmStructure | null,
  aiEvidence: readonly Evidence[],
): AnnotatorProgressSummary {
  const own = studyDecisions.filter((decision) => decision.annotator === annotator);
  const progress = verificationProgress(fields, isIndependentAnnotator(own) ? [] : aiEvidence, own, { armStructure });
  return {
    annotator,
    decided: progress.decided,
    total: progress.total,
    complete: progress.total > 0 && progress.decided === progress.total,
  };
}

export interface StudyGate {
  progressA: AnnotatorProgressSummary;
  progressB: AnnotatorProgressSummary;
  /** 両者とも complete なら裁定開始可 */
  ready: boolean;
}

/** 自分以外で検証を終えた人の人数（email は判定行と同じ完全一致で比較） */
export function countOtherCompletedAnnotators(
  progress: readonly AnnotatorProgressSummary[],
  myEmail: string,
): number {
  return progress.filter((entry) => entry.complete && entry.annotator !== myEmail).length;
}

/** 自分も含めて検証を終えた人の人数 */
export function countCompletedAnnotators(progress: readonly AnnotatorProgressSummary[]): number {
  return progress.filter((entry) => entry.complete).length;
}

export function computeStudyGate(
  annotatorA: string,
  annotatorB: string,
  fields: readonly SchemaField[],
  studyDecisions: readonly Decision[],
  armStructureA: ConfirmedArmStructure | null,
  armStructureB: ConfirmedArmStructure | null,
  aiEvidence: readonly Evidence[],
): StudyGate {
  const progressA = computeAnnotatorProgress(annotatorA, fields, studyDecisions, armStructureA, aiEvidence);
  const progressB = computeAnnotatorProgress(annotatorB, fields, studyDecisions, armStructureB, aiEvidence);
  return { progressA, progressB, ready: progressA.complete && progressB.complete };
}
