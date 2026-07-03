// 二値 / 連続アウトカムのメタ解析入力テンプレート（requirements.md §3.3 の設計判断）。
// スキーマエディタの「プリセット挿入」から outcome_result レベルの項目群を一括追加する。
// field_name はプロトコル固有の名前へ編集される前提の雛形（重複はエディタ側の検証が拾う）
import type { SchemaEditorRow } from '../types';

function presetRow(
  patch: Pick<
    SchemaEditorRow,
    'fieldName' | 'fieldLabel' | 'dataType' | 'extractionInstruction' | 'example'
  >,
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

/** 連続アウトカム: 群別 mean / SD / 解析対象数 */
export const OUTCOME_TEMPLATE_CONTINUOUS: readonly SchemaEditorRow[] = [
  presetRow({
    fieldName: 'outcome_mean',
    fieldLabel: '平均値（群別）',
    dataType: 'float',
    extractionInstruction:
      'Mean of the outcome measure in this arm at the reported timepoint, exactly as reported (no unit conversion).',
    example: '5.2',
  }),
  presetRow({
    fieldName: 'outcome_sd',
    fieldLabel: '標準偏差（群別）',
    dataType: 'float',
    extractionInstruction:
      'Standard deviation of the outcome measure in this arm. If only SE or CI is reported, report that value and state which measure it is in the value.',
    example: '1.8',
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
