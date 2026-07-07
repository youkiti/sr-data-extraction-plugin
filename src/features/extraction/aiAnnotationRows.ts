// Evidence → `ai` annotator 行（StudyData / ResultsData）への転記素材を組み立てる純粋関数
// （requirements.md §4.3「出力は Evidence に追記し、ai annotator 行へ値を転記する」）。
// シートへの書き込み（upsert）は annotationRepository の責務
import {
  AI_ANNOTATOR,
  NOT_REPORTED_TOKEN,
  type ResultsDataRow,
  type StudyDataRow,
} from '../../domain/annotation';
import type { Evidence } from '../../domain/evidence';
import type { SchemaField } from '../../domain/schemaField';

/** result_id は annotationRepository が追記時に採番するため、転記素材には持たせない */
export type NewResultsDataRow = Omit<ResultsDataRow, 'resultId'>;

export interface AiAnnotationRows {
  /** entity_level = study の項目 → StudyData の ai 行（1 study 1 行、wide） */
  studyRows: StudyDataRow[];
  /** entity_level = arm / outcome_result / rob_domain の項目 → ResultsData の ai 行（long） */
  resultsRows: NewResultsDataRow[];
}

export interface BuildAiAnnotationRowsParams {
  /** 転記元の実行。全行の run_id に入る */
  runId: string;
  schemaVersion: number;
  /** 全行の updated_at に入れる時刻（iso8601） */
  updatedAt: string;
}

/** StudyData の値セル表現: 未報告は NR トークン、AI が値を返さなかったセルは空（null） */
function toCellValue(evidence: Evidence): string | null {
  return evidence.notReported ? NOT_REPORTED_TOKEN : evidence.value;
}

/**
 * 1 run ぶんの Evidence から `ai` annotator 行を組み立てる。
 *
 * - Evidence の field_id は validateAiOutput で SchemaFields との突合を通過済みの前提。
 *   fields に無い field_id が混ざっている呼び出しはバグなので throw する
 * - 同一セル（study × field × entity_key）に複数の Evidence がある場合は後勝ち
 *   （応答内の後の要素を採用。Evidence タブには全件が原本として残る）
 */
export function buildAiAnnotationRows(
  evidence: readonly Evidence[],
  fields: readonly SchemaField[],
  params: BuildAiAnnotationRowsParams,
): AiAnnotationRows {
  const fieldById = new Map(fields.map((field) => [field.fieldId, field]));

  // StudyData: study_id → values（field_name → セル値）
  const studyValues = new Map<string, Record<string, string | null>>();
  // ResultsData: 更新キー（study × entity_key × field）→ 行。後勝ちで上書き。
  // entity_key のセグメント値には空白等も使えるため、区切り文字ではなく JSON 配列でキー化する
  const resultsByKey = new Map<string, NewResultsDataRow>();

  for (const item of evidence) {
    const field = fieldById.get(item.fieldId);
    if (field === undefined) {
      throw new Error(`Evidence の field_id "${item.fieldId}" が fields に見つかりません`);
    }
    if (field.entityLevel === 'study') {
      let values = studyValues.get(item.studyId);
      if (values === undefined) {
        values = {};
        studyValues.set(item.studyId, values);
      }
      values[field.fieldName] = toCellValue(item);
    } else {
      resultsByKey.set(JSON.stringify([item.studyId, item.entityKey, item.fieldId]), {
        studyId: item.studyId,
        fieldId: item.fieldId,
        annotator: AI_ANNOTATOR,
        annotatorType: 'ai',
        schemaVersion: params.schemaVersion,
        entityKey: item.entityKey,
        runId: params.runId,
        value: item.value,
        notReported: item.notReported,
        updatedAt: params.updatedAt,
      });
    }
  }

  const studyRows: StudyDataRow[] = [...studyValues.entries()].map(([studyId, values]) => ({
    studyId,
    annotator: AI_ANNOTATOR,
    annotatorType: 'ai',
    schemaVersion: params.schemaVersion,
    runId: params.runId,
    updatedAt: params.updatedAt,
    values,
  }));

  return { studyRows, resultsRows: [...resultsByKey.values()] };
}
