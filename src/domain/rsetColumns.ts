/** ma.csv / ma_status.csv のキー列。値列より前にこの順で配置する（rob_tool / rob_overall_judgement は
 * overall 判定の複製列 = schema_version の手前に置く。複製値は当該 outcome 行への verified オーバーライド優先・
 * なければ study 単位の base。design-r-export.md §4.2.2）。outcome_result の項目名の予約名にも使う（issue #549） */
export const MA_KEY_HEADER = [
  'study_id',
  'study_label',
  'outcome_id',
  'outcome_label',
  'timepoint',
  'timepoint_value',
  'timepoint_unit',
  'arm_id',
  'arm_label',
  'rob_tool',
  'rob_overall_judgement',
  'schema_version',
] as const;
