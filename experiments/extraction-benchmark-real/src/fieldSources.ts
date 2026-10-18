// issue #176 の主要評価対象。原データ抽出票で、通常は論文中の表から転記する項目を明示する。
// 論文ごとの実際の掲載位置は異なりうるため「table_likely」という運用上の分類とする。
export const TABLE_LIKELY_FIELD_IDS = new Set([
  'arm_name',
  'age_mean', 'age_sd', 'age_n', 'f_n', 'hyp_n', 'primary_insomnia_n', 'n',
  'remission', 'dropout',
  'severity_bl_mean', 'severity_bl_sd', 'severity_bl_n',
  'severity_ch_mean', 'severity_ch_sd', 'severity_ch_n',
  'severity_ep_mean', 'severity_ep_sd', 'severity_ep_n',
  'se_mean', 'se_sd', 'se_n',
  'tst_mean', 'tst_sd', 'tst_n',
  'sol_mean', 'sol_sd', 'sol_n',
  'waso_mean', 'waso_sd', 'waso_n',
  'r_long', 'severity_mean_long', 'severity_sd_long', 'severity_n_long',
  'severity_ch_mean_long', 'severity_ch_sd_long', 'severity_ch_n_long',
]);

export function isTableLikelyField(fieldId: string): boolean {
  return TABLE_LIKELY_FIELD_IDS.has(fieldId);
}
