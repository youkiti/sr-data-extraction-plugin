// 再パイロットの対象選択と改訂使用論文の判定（issue #266）。
// 未使用のテキスト付き study を優先し、改訂前の使用履歴を時刻順で判定する。
// DOM・store・通信に依存しない純粋関数。
import type { ExtractionRun } from '../../domain/extractionRun';
import type { SchemaVersion } from '../../domain/schemaVersion';
import type { StudySelectionItem } from '../documents/studySelection';

export function usedPilotStudyIds(history: readonly ExtractionRun[]): Set<string> {
  return new Set(history.filter((run) => run.runType === 'pilot').flatMap((run) => run.studyIds));
}

/** 未使用のテキスト付き study を優先し、皆無のときだけ使用済みに戻す。 */
export function defaultPilotStudyIds(
  candidates: readonly StudySelectionItem[],
  used: ReadonlySet<string>,
  limit = 3,
): string[] {
  const textCandidates = candidates.filter((item) => item.hasTextLayer);
  const unused = textCandidates.filter((item) => !used.has(item.study.studyId));
  return (unused.length > 0 ? unused : textCandidates)
    .slice(0, Math.max(0, limit))
    .map((item) => item.study.studyId);
}

/** 改訂版の作成より前のパイロットで使われた、今回の study を返す。 */
export function revisionUsedStudyIds(
  run: ExtractionRun,
  history: readonly ExtractionRun[],
  versions: readonly SchemaVersion[],
): Set<string> {
  const startedAt = run.startedAt;
  if (startedAt === null) return new Set();
  const revisionTimes = versions.filter(
    (version) => version.createdByType === 'pilot_revision' && version.createdAt < startedAt,
  );
  const used = new Set(
    history
      .filter(
        (previous) =>
          previous.runId !== run.runId &&
          previous.runType === 'pilot' &&
          previous.startedAt !== null &&
          revisionTimes.some((version) => previous.startedAt! < version.createdAt),
      )
      .flatMap((previous) => previous.studyIds),
  );
  return new Set(run.studyIds.filter((studyId) => used.has(studyId)));
}
