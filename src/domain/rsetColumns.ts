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

/** tab1.csv / tab1_status.csv のキー列。study レベルの項目名の予約名にも使う（issue #553） */
export const TAB1_KEY_HEADER = ['study_id', 'study_label', 'registration_id', 'n_documents', 'schema_version'] as const;

// 既存スキーマの衝突は見出しだけで回避し、項目名による値・状態の判定は維持する。
// 後続の項目名も先に確保し、改名先が既存の値列を奪わないようにする。
export function rsetValueHeaders(keyHeader: readonly string[], fieldNames: readonly string[]): string[] {
  const keyNames = new Set<string>(keyHeader);
  const usedNames = new Set<string>([...keyHeader, ...fieldNames]);
  return fieldNames.map((name) => {
    if (!keyNames.has(name)) {
      return name;
    }
    let candidate = `${name}_field`;
    let suffix = 2;
    while (usedNames.has(candidate)) {
      candidate = `${name}_field_${suffix}`;
      suffix += 1;
    }
    usedNames.add(candidate);
    return candidate;
  });
}
