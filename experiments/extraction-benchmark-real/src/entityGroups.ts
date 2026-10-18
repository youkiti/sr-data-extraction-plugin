// issue #377 段階 1: 68 項目を内容で 4 区分に分ける（純粋関数）。
// ベンチのスキーマは study / arm の 2 区分だけで、アウトカムの数値は arm の列として入っている。
// 区分の割り当ては 2026-10-18 に集計前の issue コメントで確定した（結果を見てから変えない）。
import type { GoldRow } from './validateGold';
import type { RunItem } from './metrics';

export const ENTITY_GROUPS = ['study', 'arm_descriptor', 'baseline', 'outcome'] as const;
export type EntityGroup = (typeof ENTITY_GROUPS)[number];

export const ENTITY_GROUP_LABELS: Readonly<Record<EntityGroup, string>> = {
  study: '研究の基本情報',
  arm_descriptor: '群の記述',
  baseline: '背景因子',
  outcome: 'アウトカムの数値（outcome_result 相当）',
};

const STUDY = [
  'ind_clu', 'country', 'single_multi', 'insomnia_diagnosis', 'comorbidities',
  'def_remission_response', 'scale_used', 'severity_scale', 'r_long_scale_used',
  'year', 'icc_for_crct', 'sleep_diary_weeks', 'r_weeks_long',
];
const ARM_DESCRIPTOR = [
  'arm_name', 'n',
  'se', 'sd', 'cr', 'cw', 'sr', 'sc', 're', 'pi', 'w', 'dt', 'ns', 'he', 'tg', 'ind', 'gp', 'ff', 'ae',
];
const BASELINE = [
  'age_mean', 'age_sd', 'age_n', 'f_n', 'hyp_n', 'primary_insomnia_n',
  'severity_bl_mean', 'severity_bl_sd', 'severity_bl_n',
];
const OUTCOME = [
  'remission', 'dropout',
  'severity_ch_mean', 'severity_ch_sd', 'severity_ch_n',
  'severity_ep_mean', 'severity_ep_sd', 'severity_ep_n',
  'se_mean', 'se_sd', 'se_n',
  'tst_mean', 'tst_sd', 'tst_n',
  'sol_mean', 'sol_sd', 'sol_n',
  'waso_mean', 'waso_sd', 'waso_n',
  'r_long',
  'severity_mean_long', 'severity_sd_long', 'severity_n_long',
  'severity_ch_mean_long', 'severity_ch_sd_long', 'severity_ch_n_long',
];

export const FIELD_GROUP: ReadonlyMap<string, EntityGroup> = new Map<string, EntityGroup>([
  ...STUDY.map((id) => [id, 'study'] as const),
  ...ARM_DESCRIPTOR.map((id) => [id, 'arm_descriptor'] as const),
  ...BASELINE.map((id) => [id, 'baseline'] as const),
  ...OUTCOME.map((id) => [id, 'outcome'] as const),
]);

// 割り当ての重複と項目数（13 / 19 / 9 / 27 = 68）を読み込み時に確かめる
{
  const all = [...STUDY, ...ARM_DESCRIPTOR, ...BASELINE, ...OUTCOME];
  const sizes = [STUDY.length, ARM_DESCRIPTOR.length, BASELINE.length, OUTCOME.length].join('/');
  if (FIELD_GROUP.size !== all.length) throw new Error('区分の割り当てに重複した field_id があります');
  if (sizes !== '13/19/9/27') throw new Error(`区分の項目数が事前登録と違います: ${sizes}`);
}

/** 未知の field_id は黙って捨てずに throw する（区分の割り当て漏れを集計に混ぜない） */
export function groupOf(fieldId: string): EntityGroup {
  const group = FIELD_GROUP.get(fieldId);
  if (group === undefined) throw new Error(`区分が割り当てられていない field_id: ${fieldId}`);
  return group;
}

/** gold 1 行に対する判定。correct 以外の 5 つが誤りの内訳 */
export type RowOutcome =
  | 'correct'
  | 'missing_row' // AI がその field_id × entity_key の行を出していない
  | 'missed_value' // gold は値あり、AI は未報告
  | 'extra_value' // gold は未報告、AI は値あり（値が空のものを含む）
  | 'wrong_value' // gold も AI も値ありで、値が一致しない
  | 'empty_value'; // gold は値あり、AI は「未報告でない」のに値が空

/** src/metrics.ts の computeSlice と同じ規則（matchesValue = 文字列一致の主指標）で 1 行を判定する */
export function classifyRow(
  row: GoldRow,
  item: RunItem | undefined,
  matches: (value: string | null, row: GoldRow) => boolean,
): RowOutcome {
  if (item === undefined) return 'missing_row';
  if (row.not_reported) return item.notReported ? 'correct' : 'extra_value';
  if (item.notReported) return 'missed_value';
  if (matches(item.value, row)) return 'correct';
  return item.value === null ? 'empty_value' : 'wrong_value';
}
