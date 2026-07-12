// 二値 / 連続アウトカムのプリセット項目名から not_applicable を判定するロジック（issue #60 要望 3）。
// フィールド名の集合はハードコードせず、実際のプリセット定義（schema/presets/outcomeTemplates.ts）
// から導出する。プリセットが変わってもここが自動的に追従する
import { OUTCOME_TEMPLATE_BINARY, OUTCOME_TEMPLATE_CONTINUOUS } from '../../schema/presets/outcomeTemplates';
import type { RSetStatus } from './rsetStatus';

/** 連続アウトカムテンプレート専用の項目名（mean / SD / SE / CI / median / IQR / range / n） */
export const CONTINUOUS_ONLY_FIELD_NAMES: ReadonlySet<string> = new Set(
  OUTCOME_TEMPLATE_CONTINUOUS.map((field) => field.fieldName),
);

/** 二値アウトカムテンプレート専用の項目名（events / total） */
export const BINARY_ONLY_FIELD_NAMES: ReadonlySet<string> = new Set(
  OUTCOME_TEMPLATE_BINARY.map((field) => field.fieldName),
);

/**
 * ある outcome_result インスタンス内で、対象フィールドの基底ステータスが `no_data` のとき、
 * 「対岸」のプリセット項目群（二値 ⇔ 連続）に実データがあれば `not_applicable` へ格上げする。
 * - 対象が連続専用項目 かつ 同インスタンスの二値専用項目のいずれかが no_data 以外 → not_applicable
 * - 対象が二値専用項目 かつ 同インスタンスの連続専用項目のいずれかが no_data 以外 → not_applicable
 * - 対岸側も全滅（no_data のみ）、または対象がどちらのプリセットにも属さない項目 → 元のステータスのまま
 *   （＝「認識できない場合は no_data」。二値・連続どちらの実データも無い場合は判断材料が無いため）
 */
export function applyNotApplicable(
  fieldName: string,
  baseStatus: RSetStatus,
  siblingStatuses: ReadonlyMap<string, RSetStatus>,
): RSetStatus {
  if (baseStatus !== 'no_data') {
    return baseStatus;
  }
  if (CONTINUOUS_ONLY_FIELD_NAMES.has(fieldName)) {
    return hasAnyData(BINARY_ONLY_FIELD_NAMES, siblingStatuses) ? 'not_applicable' : 'no_data';
  }
  if (BINARY_ONLY_FIELD_NAMES.has(fieldName)) {
    return hasAnyData(CONTINUOUS_ONLY_FIELD_NAMES, siblingStatuses) ? 'not_applicable' : 'no_data';
  }
  return baseStatus;
}

function hasAnyData(names: ReadonlySet<string>, statuses: ReadonlyMap<string, RSetStatus>): boolean {
  for (const name of names) {
    const status = statuses.get(name);
    if (status !== undefined && status !== 'no_data') {
      return true;
    }
  }
  return false;
}
