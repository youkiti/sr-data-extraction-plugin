// 二値 / 連続アウトカムのメタ解析入力テンプレート（requirements.md §3.3 の設計判断）。
// スキーマエディタの「プリセット挿入」から outcome_result レベルの項目群を一括追加する。
// field_name はプロトコル固有の名前へ編集される前提の雛形（重複はエディタ側の検証が拾う）
import type { SchemaEditorRow } from '../types';

function presetRow(
  patch: Pick<
    SchemaEditorRow,
    'fieldName' | 'fieldLabel' | 'dataType' | 'extractionInstruction' | 'example'
  > &
    Partial<Pick<SchemaEditorRow, 'required'>>,
): SchemaEditorRow {
  return {
    fieldId: null,
    section: 'outcomes',
    entityLevel: 'outcome_result',
    unit: null,
    allowedValues: null,
    required: true,
    aiGenerated: false,
    note: null,
    ...patch,
  };
}

/** 二値アウトカム（2×2 表）: 群別イベント数 + 群別解析対象数 */
export const OUTCOME_TEMPLATE_BINARY: readonly SchemaEditorRow[] = [
  presetRow({
    fieldName: 'outcome_events',
    fieldLabel: 'イベント数（群別）',
    dataType: 'integer',
    extractionInstruction:
      'Number of participants with the outcome event in this arm, as reported. Report the count per arm and timepoint.',
    example: '12',
  }),
  presetRow({
    fieldName: 'outcome_total',
    fieldLabel: '解析対象数（群別）',
    dataType: 'integer',
    extractionInstruction:
      'Number of participants analysed for this outcome in this arm (denominator of the 2x2 table).',
    example: '48',
  }),
];

/**
 * 連続アウトカム: 群別 mean / SD / 解析対象数 + 散布度の代替報告（SE / CI / median + IQR / range）。
 * SD が未報告で SE や信頼区間しか載っていない論文、median + IQR / range で報告する論文
 * （skewed data で頻出。issue #43）に対応するため、報告された統計量をそのまま構造化して
 * 抽出する（SD への換算は行わない。SE / CI は Cochrane Handbook §6.5.2 の式、
 * median 系は Wan 2014 / Luo 2018 / Shi 2020 法で解析段階に換算できるよう素材を揃える方針）。
 * mean / SD / n 以外の 9 項目は該当報告があるときだけ値が入る想定のため required = false
 */
export const OUTCOME_TEMPLATE_CONTINUOUS: readonly SchemaEditorRow[] = [
  presetRow({
    fieldName: 'outcome_mean',
    fieldLabel: '平均値（群別）',
    dataType: 'float',
    extractionInstruction:
      'Mean of the outcome measure in this arm at the reported timepoint, exactly as reported (no unit conversion). If only a median is reported, mark this not_reported and use outcome_median instead.',
    example: '5.2',
  }),
  presetRow({
    fieldName: 'outcome_sd',
    fieldLabel: '標準偏差（群別）',
    dataType: 'float',
    extractionInstruction:
      'Standard deviation of the outcome measure in this arm, only when the SD itself is reported. If the paper reports SE, a confidence interval, an IQR or a range instead, mark this not_reported and use the dedicated fields (outcome_se, outcome_ci_lower/upper, outcome_q1/q3, outcome_min/max). Never compute SD from SE, CI, IQR or range.',
    example: '1.8',
  }),
  presetRow({
    fieldName: 'outcome_se',
    fieldLabel: '標準誤差（群別）',
    dataType: 'float',
    required: false,
    extractionInstruction:
      'Standard error (SE / SEM) of the mean in this arm, only when explicitly reported. Do not compute it from SD or CI.',
    example: '0.27',
  }),
  presetRow({
    fieldName: 'outcome_ci_lower',
    fieldLabel: '信頼区間下限（群別）',
    dataType: 'float',
    required: false,
    extractionInstruction:
      "Lower bound of the confidence interval around this arm's mean, exactly as reported. Use the CI of this arm's mean, not the CI of a between-group difference. Mark not_reported when no arm-level CI is given.",
    example: '4.7',
  }),
  presetRow({
    fieldName: 'outcome_ci_upper',
    fieldLabel: '信頼区間上限（群別）',
    dataType: 'float',
    required: false,
    extractionInstruction:
      "Upper bound of the confidence interval around this arm's mean, exactly as reported. Use the CI of this arm's mean, not the CI of a between-group difference. Mark not_reported when no arm-level CI is given.",
    example: '5.7',
  }),
  presetRow({
    fieldName: 'outcome_ci_level',
    fieldLabel: '信頼区間の水準（%）',
    dataType: 'float',
    required: false,
    extractionInstruction:
      'Confidence level of the reported interval in percent (e.g. 95 for a 95% CI). Extract only when outcome_ci_lower / outcome_ci_upper are reported.',
    example: '95',
  }),
  presetRow({
    fieldName: 'outcome_median',
    fieldLabel: '中央値（群別）',
    dataType: 'float',
    required: false,
    extractionInstruction:
      'Median of the outcome measure in this arm at the reported timepoint, only when a median is reported (typically together with an IQR or a range), exactly as reported.',
    example: '4.9',
  }),
  presetRow({
    fieldName: 'outcome_q1',
    fieldLabel: '第 1 四分位数（群別）',
    dataType: 'float',
    required: false,
    extractionInstruction:
      'Lower quartile (25th percentile, Q1) of the outcome in this arm, only when an IQR is reported as quartile values. Report the quartile itself, not the IQR width; if only the width is given, mark this not_reported.',
    example: '3.8',
  }),
  presetRow({
    fieldName: 'outcome_q3',
    fieldLabel: '第 3 四分位数（群別）',
    dataType: 'float',
    required: false,
    extractionInstruction:
      'Upper quartile (75th percentile, Q3) of the outcome in this arm, only when an IQR is reported as quartile values. Report the quartile itself, not the IQR width; if only the width is given, mark this not_reported.',
    example: '6.1',
  }),
  presetRow({
    fieldName: 'outcome_min',
    fieldLabel: '最小値（群別）',
    dataType: 'float',
    required: false,
    extractionInstruction:
      'Minimum value of the outcome in this arm, only when a range (min–max) is reported.',
    example: '1.2',
  }),
  presetRow({
    fieldName: 'outcome_max',
    fieldLabel: '最大値（群別）',
    dataType: 'float',
    required: false,
    extractionInstruction:
      'Maximum value of the outcome in this arm, only when a range (min–max) is reported.',
    example: '9.4',
  }),
  presetRow({
    fieldName: 'outcome_n',
    fieldLabel: '解析対象数（群別）',
    dataType: 'integer',
    extractionInstruction:
      'Number of participants analysed for this continuous outcome in this arm.',
    example: '45',
  }),
];

export type OutcomePresetKind = 'binary' | 'continuous';

/** プリセット挿入用の一覧（UI のボタンと 1:1） */
export const OUTCOME_TEMPLATES: Record<OutcomePresetKind, readonly SchemaEditorRow[]> = {
  binary: OUTCOME_TEMPLATE_BINARY,
  continuous: OUTCOME_TEMPLATE_CONTINUOUS,
};
