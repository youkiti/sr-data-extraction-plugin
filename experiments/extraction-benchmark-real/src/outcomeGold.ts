import { makeOutcomeEntityKey } from '../../../src/utils/entityKey';
import type { GoldRow } from './validateGold';

const mapping: ReadonlyArray<readonly [string, string, readonly string[]]> = [
  ['severity', 'baseline', ['severity_bl_mean', 'severity_bl_sd', 'severity_bl_n']],
  ['severity', 'post', ['severity_ep_mean', 'severity_ep_sd', 'severity_ep_n']],
  ['severity', 'long', ['severity_mean_long', 'severity_sd_long', 'severity_n_long']],
  ['sleep_efficiency', 'post', ['se_mean', 'se_sd', 'se_n']],
  ['tst', 'post', ['tst_mean', 'tst_sd', 'tst_n']],
  ['sol', 'post', ['sol_mean', 'sol_sd', 'sol_n']],
  ['waso', 'post', ['waso_mean', 'waso_sd', 'waso_n']],
  ['remission', 'post', ['remission']],
  ['remission', 'long', ['r_long']],
];

export function buildOutcomeGold(rows: readonly GoldRow[]): GoldRow[] {
  const arms = [...new Set(rows.map((r) => r.entity_key).filter((key) => /^arm:\d+$/.test(key)))];
  arms.sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)));
  const byKey = new Map(rows.map((r) => [`${r.entity_key} ${r.field_id}`, r]));
  const result: GoldRow[] = [];
  for (const arm of arms) {
    for (const [outcome, time, sourceIds] of mapping) {
      const sources = sourceIds.map((id) => byKey.get(`${arm} ${id}`));
      if (!sources.some((row) => row?.not_reported === false)) continue;
      sources.forEach((row, index) => {
        const reported = row?.not_reported === false;
        result.push({
          field_id: sourceIds.length === 1 ? 'or_events' : ['or_mean', 'or_sd', 'or_n'][index]!,
          entity_key: makeOutcomeEntityKey({ outcome, arm: arm.slice(4), time }),
          not_reported: !reported,
          value_gold: reported ? row.value_gold : null,
          acceptable_values: reported ? [...row.acceptable_values] : [],
          source_page: null, source_quote: null, note: null,
        });
      });
    }
  }
  return result;
}
