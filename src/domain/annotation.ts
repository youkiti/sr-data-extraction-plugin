// StudyData（wide）/ ResultsData（long）の annotator 行に対応する型（requirements.md §3.2）
// 二重独立抽出（Q4）は「同一 study に対する annotator 行の複数化」で表現する

/** AI 抽出行の annotator 値（人間は email）。モデル・実行条件は run_id から ExtractionRuns を辿る */
export const AI_ANNOTATOR = 'ai';

/**
 * human_independent（AI 出力を見ずに独立抽出）/ consensus（不一致解消後の確定行）は
 * データ構造としては MVP から対応するが、運用 UI は P1（requirements.md §3.2 ※Q4）
 */
export type AnnotatorType = 'ai' | 'human_with_ai' | 'human_independent' | 'consensus';

/** StudyData の値列で「未報告」を表すトークン。未検証（human 行）は空セル = null で区別する */
export const NOT_REPORTED_TOKEN = 'NR';

/**
 * StudyData（wide・study レベル）の 1 行 = 1 study × 1 annotator。
 * 更新キーは study_id × annotator（同一キーの重複行はバリデーション違反）
 */
export interface StudyDataRow {
  studyId: string;
  /** email または AI_ANNOTATOR */
  annotator: string;
  annotatorType: AnnotatorType;
  schemaVersion: number;
  /** ai 行のみ。生成元の実行 */
  runId: string | null;
  updatedAt: string;
  /**
   * field_name → 値の動的列。報告どおりの文字列で保持し、
   * 未報告は NOT_REPORTED_TOKEN、未検証（human 行）は null（空セル）
   */
  values: Record<string, string | null>;
}

/**
 * ResultsData（long・arm / outcome_result / RoB レベル）の
 * 1 行 = 1 study × 1 annotator × 1 entity_key × 1 field。
 * 更新キーは study_id × annotator × entity_key × field_id（result_id は行識別子であり更新キーではない）
 */
export interface ResultsDataRow {
  resultId: string;
  studyId: string;
  fieldId: string;
  annotator: string;
  annotatorType: AnnotatorType;
  schemaVersion: number;
  /** arm:1 / outcome:mortality|arm:1|time:30d / rob:domain_1（utils/entityKey.ts で生成・パース） */
  entityKey: string;
  runId: string | null;
  /** 報告どおりの文字列で保持（型検証はクライアント側） */
  value: string | null;
  notReported: boolean;
  updatedAt: string;
}
