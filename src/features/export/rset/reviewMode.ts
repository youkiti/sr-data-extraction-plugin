// export_manifest.json の review_mode（issue #60 design-r-export.md §4.6・§13）。
// Reviewers タブの「割り当て」ではなく、実際にエクスポートされる StudyData / ResultsData の
// annotator_type から決定的に導出する（「実際にどのレビュー体制のデータが最終データセットに
// 入っているか」を R 側が機械的に読み取れるようにするため。設計判断は design-r-export.md §13 参照）
import type { AnnotatorType } from '../../../domain/annotation';

export type RSetReviewMode =
  | 'no_human_verification'
  | 'single_with_ai'
  | 'dual_independent'
  | 'dual_consensus';

interface AnnotatorTypeTagged {
  annotatorType: AnnotatorType;
}

/**
 * StudyData / ResultsData の annotator_type 集合から review_mode を導出する。
 * 優先順位（強い体制から判定）: consensus 行が 1 件でもあれば `dual_consensus`
 * （二重独立検証を経て裁定済み）→ human_independent 行があれば `dual_independent`
 * （独立入力は完了しているが裁定前、または裁定機能を使わない運用）→
 * human_with_ai 行があれば `single_with_ai`（単一レビュアーが AI 支援で検証）→
 * いずれも無ければ `no_human_verification`（AI 抽出のみ・人間の検証行が 1 件もない）
 */
export function deriveReviewMode(
  studyRows: readonly AnnotatorTypeTagged[],
  resultsRows: readonly AnnotatorTypeTagged[],
): RSetReviewMode {
  const types = new Set<AnnotatorType>();
  for (const row of studyRows) {
    types.add(row.annotatorType);
  }
  for (const row of resultsRows) {
    types.add(row.annotatorType);
  }
  if (types.has('consensus')) {
    return 'dual_consensus';
  }
  if (types.has('human_independent')) {
    return 'dual_independent';
  }
  if (types.has('human_with_ai')) {
    return 'single_with_ai';
  }
  return 'no_human_verification';
}
