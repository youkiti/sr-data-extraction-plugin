// study 単位の裁定ゲート（docs/design-independent-dual-review.md §6.1）。
// 両 annotator の検証進捗が 100%（判定済みセル数 = 総セル数。かつ総セル数 > 0）の study だけ
// 裁定開始可とする。進捗は既存の検証画面と同じセルモデル基準（features/verification/progress.ts）
import type { ConfirmedArmStructure } from '../../domain/armStructure';
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

/**
 * 1 annotator ぶんの検証進捗を数える。decisions は院内の全 study 分でよい（study_id は
 * 呼び出し側で絞り込み済みの前提。verificationProgress 自体は entity_key の集合を
 * decisions/armStructure から導出するため、他 study の decision が混ざると誤集計になる）
 */
export function computeAnnotatorProgress(
  annotator: string,
  fields: readonly SchemaField[],
  studyDecisions: readonly Decision[],
  armStructure: ConfirmedArmStructure | null,
): AnnotatorProgressSummary {
  const own = studyDecisions.filter((decision) => decision.annotator === annotator);
  const progress = verificationProgress(fields, [], own, { armStructure });
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

export function computeStudyGate(
  annotatorA: string,
  annotatorB: string,
  fields: readonly SchemaField[],
  studyDecisions: readonly Decision[],
  armStructureA: ConfirmedArmStructure | null,
  armStructureB: ConfirmedArmStructure | null,
): StudyGate {
  const progressA = computeAnnotatorProgress(annotatorA, fields, studyDecisions, armStructureA);
  const progressB = computeAnnotatorProgress(annotatorB, fields, studyDecisions, armStructureB);
  return { progressA, progressB, ready: progressA.complete && progressB.complete };
}
