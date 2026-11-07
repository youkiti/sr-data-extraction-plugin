import type { StudyDataRow, ResultsDataRow } from '../../domain/annotation';

/** 研究内の両者のデータ行が、いずれも AI を見ながらの検証だけかを判定する。 */
export function isBothWithAi(
  studyRows: readonly StudyDataRow[],
  resultRows: readonly ResultsDataRow[],
  annotatorA: string,
  annotatorB: string,
): boolean {
  const rows = [...studyRows, ...resultRows];
  return [annotatorA, annotatorB].every((annotator) => {
    const own = rows.filter((row) => row.annotator === annotator);
    return own.length > 0 && own.every((row) => row.annotatorType === 'human_with_ai');
  });
}
