// 担当セットの分割・表示対象・継承・進捗集計。I/O を持たない純粋関数。
import type { ConfirmedArmStructure } from '../../domain/armStructure';
import type { Decision } from '../../domain/decision';
import {
  CALIBRATION_SET_ID,
  compareReviewSetIds,
  groupSetId,
  isGroupSetId,
  type ReviewSetRow,
} from '../../domain/reviewSet';
import type { SchemaField } from '../../domain/schemaField';
import type { StudyRecord } from '../../domain/study';
import { computeAnnotatorProgress } from '../adjudication/gate';

/** studies は呼び出し側でアクティブな行に絞る。sets は畳み込み済みの行を渡す */
export function isReviewSetsActive(
  studies: readonly StudyRecord[],
  sets: readonly ReviewSetRow[],
): boolean {
  return studies.some((study) => reviewSetForStudy(study, sets) !== null);
}

/** 所属の正は owner の担当セット記録に置く */
export function reviewSetForStudy(
  study: StudyRecord,
  sets: readonly ReviewSetRow[],
): string | null {
  return sets.find((set) => set.studyIds?.includes(study.studyId))?.setId ?? null;
}

/** 呼び出し側でアクティブな study に絞る */
export function reviewSetMismatchCount(
  studies: readonly StudyRecord[],
  sets: readonly ReviewSetRow[],
): number {
  return studies.filter(
    (study) => (study.reviewSet?.trim() || null) !== reviewSetForStudy(study, sets),
  ).length;
}

/** 最新の分割に含まれるグループと、現在も研究が割り当てられたグループを残す */
export function currentReviewSets(
  studies: readonly StudyRecord[],
  sets: readonly ReviewSetRow[],
): ReviewSetRow[] {
  const seeded = sets.filter((set) => set.seed !== null);
  const latest = seeded.reduce<ReviewSetRow | null>(
    (previous, set) =>
      previous === null ||
      (set.splitUpdatedAt ?? set.updatedAt) > (previous.splitUpdatedAt ?? previous.updatedAt)
        ? set
        : previous,
    null,
  );
  const assigned = new Set(studies.map((study) => reviewSetForStudy(study, sets)));
  return sets.filter(
    (set) =>
      !isGroupSetId(set.setId) ||
      (latest !== null && set.seed === latest.seed) ||
      assigned.has(set.setId),
  );
}

export function generateSeed(random: () => number = Math.random): string {
  return String(Math.floor(random() * 0x100000000) >>> 0);
}

export interface SplitReviewSetsOptions {
  calibrationCount: number;
  groupCount: number;
  /** uint32 の十進文字列 */
  seed: string;
}

/** mulberry32 と Fisher–Yates で再現可能な分割を作る。入力配列は変更しない */
export function splitIntoReviewSets(
  studyIds: readonly string[],
  { calibrationCount, groupCount, seed }: SplitReviewSetsOptions,
): Map<string, string> {
  if (!Number.isSafeInteger(calibrationCount) || calibrationCount < 0) {
    throw new Error('キャリブレーション本数は 0 以上の整数が必要です');
  }
  if (!Number.isSafeInteger(groupCount) || groupCount < 1) {
    throw new Error('グループ数は 1 以上の整数が必要です');
  }
  if (!/^\d+$/.test(seed) || !Number.isSafeInteger(Number(seed)) || Number(seed) > 0xffffffff) {
    throw new Error('乱数種は uint32 の十進文字列が必要です');
  }
  let state = Number(seed);
  const random = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
  };
  const shuffled = [...studyIds];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j] as string, shuffled[i] as string];
  }
  const count = Math.min(calibrationCount, shuffled.length);
  return new Map(
    shuffled.map((id, i) => [
      id,
      i < count ? CALIBRATION_SET_ID : groupSetId(((i - count) % groupCount) + 1),
    ]),
  );
}

/** アクティブな study を渡す。calibration は担当登録のない人にも表示する */
export function visibleStudyIdsForReviewer(
  email: string,
  studies: readonly StudyRecord[],
  sets: readonly ReviewSetRow[],
): string[] {
  const assigned = new Set(
    currentReviewSets(studies, sets)
      .filter((set) => set.setId === CALIBRATION_SET_ID || set.reviewerEmails.includes(email))
      .flatMap((set) => set.studyIds ?? []),
  );
  return studies.filter((study) => assigned.has(study.studyId)).map((study) => study.studyId);
}

export function assignedPairForStudy(
  study: StudyRecord,
  sets: readonly ReviewSetRow[],
): [string, string] | null {
  const set = sets.find((row) => row.studyIds?.includes(study.studyId));
  if (set === undefined || !isGroupSetId(set.setId) || set.reviewerEmails.length !== 2)
    return null;
  return [...set.reviewerEmails].sort((a, b) => a.localeCompare(b)) as [string, string];
}

/** sourceStudies は作成順（シート行順）。同じセットなら保持し、異なる場合だけ選択値を使う */
export function inheritReviewSet(
  sourceStudies: readonly StudyRecord[],
  chosen?: string | null,
  sets: readonly ReviewSetRow[] = [],
): string | null {
  const first = sourceStudies[0] === undefined ? null : reviewSetForStudy(sourceStudies[0], sets);
  if (sourceStudies.every((study) => reviewSetForStudy(study, sets) === first)) return first;
  return chosen === undefined ? first : chosen;
}

/** 読み込み済みの素材。群構成は study → annotator の順で引く */
export interface ReviewerSetProgressInput {
  reviewerEmails: readonly string[];
  studies: readonly StudyRecord[];
  sets: readonly ReviewSetRow[];
  fields: readonly SchemaField[];
  decisions: readonly Decision[];
  armStructures: ReadonlyMap<string, ReadonlyMap<string, ConfirmedArmStructure>>;
}

export interface ReviewerSetProgress {
  email: string;
  setId: string;
  done: number;
  total: number;
}

/** 担当外の組み合わせは返さない。calibration は渡された全 reviewer を対象にする */
export function reviewerSetProgress(input: ReviewerSetProgressInput): ReviewerSetProgress[] {
  const progress: ReviewerSetProgress[] = [];
  const sets = currentReviewSets(input.studies, input.sets).sort((a, b) =>
    compareReviewSetIds(a.setId, b.setId),
  );
  for (const email of new Set(input.reviewerEmails)) {
    for (const set of sets) {
      if (set.setId !== CALIBRATION_SET_ID && !set.reviewerEmails.includes(email)) continue;
      const studies = input.studies.filter((study) => reviewSetForStudy(study, input.sets) === set.setId);
      const done = studies.filter(
        (study) =>
          computeAnnotatorProgress(
            email,
            input.fields,
            input.decisions.filter((decision) => decision.studyId === study.studyId),
            input.armStructures.get(study.studyId)?.get(email) ?? null,
          ).complete,
      ).length;
      progress.push({ email, setId: set.setId, done, total: studies.length });
    }
  }
  return progress;
}
