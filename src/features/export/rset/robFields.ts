// rob.csv 用の RoB ツール判別（field_name 接頭辞から rob2 / robins_i を判別する規約）。
// RoB ドメインは outcome_result と異なり AI ドラフトの対象外でテンプレート挿入が唯一の入口
// （requirements.md §3.3）のため、ドメイン一覧はデータ駆動ではなくテンプレート定義から
// 直接列挙する（＝スキーマにテンプレートが挿入されていれば、AI が抽出できていないドメインも
// no_data 行として必ず出現する。幽霊セルの分母と同じ思想）
import {
  QUADAS3_APPLICABILITY_DOMAINS,
  QUADAS3_DOMAINS,
  QUIPS_DOMAINS,
  ROB2_DOMAINS,
  ROBINS_I_DOMAINS,
} from '../../schema/presets/robTemplates';
import type { SchemaField } from '../../../domain/schemaField';

export interface RobDomainDefinition {
  id: string;
  label: string;
}

export interface RobToolFieldSet {
  /** rob.csv の tool 列に出す値（`rob2` / `robins_i`） */
  tool: string;
  judgementFieldName: string;
  supportFieldName: string;
  domains: readonly RobDomainDefinition[];
}

/**
 * 判別可能な RoB ツール（robTemplates.ts の各プリセット。SQ 完全版は軽量版と judgement/support の
 * field_name を共有するため、ここでの列挙は軽量版・SQ 完全版どちらの挿入でも同じ 1 エントリで拾える）。
 * 将来カスタム名の RoB 項目を追加する場合はここへ追記する（field_name の命名規約を拡張する形）。
 *
 * QUADAS-3（issue #61 PR3 = issue #88）は risk-of-bias と applicability（適用可能性）という
 * 2 系統の判定を持つが、RobToolFieldSet 自体は「1 judgement + 1 support + 1 ドメイン一覧」の
 * 単純な形のまま拡張せず、`tool` 名を分けた 2 エントリ（`quadas3` / `quadas3_applicability`）
 * として登録することで対応する（buildRobCsv.ts・RobToolFieldSet の型は無変更）
 */
const ROB_TOOL_FIELD_SETS: readonly RobToolFieldSet[] = [
  {
    tool: 'rob2',
    judgementFieldName: 'rob2_judgement',
    supportFieldName: 'rob2_support',
    domains: ROB2_DOMAINS,
  },
  {
    tool: 'robins_i',
    judgementFieldName: 'robins_i_judgement',
    supportFieldName: 'robins_i_support',
    domains: ROBINS_I_DOMAINS,
  },
  {
    tool: 'quadas3',
    judgementFieldName: 'quadas3_rob_judgement',
    supportFieldName: 'quadas3_rob_support',
    domains: QUADAS3_DOMAINS,
  },
  {
    tool: 'quadas3_applicability',
    judgementFieldName: 'quadas3_applicability_judgement',
    supportFieldName: 'quadas3_applicability_support',
    domains: QUADAS3_APPLICABILITY_DOMAINS,
  },
  {
    tool: 'quips',
    judgementFieldName: 'quips_judgement',
    supportFieldName: 'quips_support',
    domains: QUIPS_DOMAINS,
  },
];

/**
 * 現行スキーマに実際に挿入されている RoB ツールのフィールドセットを返す（judgement 項目の存在で判定）。
 * 理論上 2 テンプレート同時挿入もあり得るが、通常は 1 study に 1 デザイン = 1 ツールを想定した
 * v1 の割り切りとして、rob_overall_judgement の複製列（ma.csv）は配列先頭（rob2 優先）のみを使う
 */
export function activeRobToolFieldSets(fields: readonly SchemaField[]): RobToolFieldSet[] {
  return ROB_TOOL_FIELD_SETS.filter((set) =>
    fields.some((field) => field.entityLevel === 'rob_domain' && field.fieldName === set.judgementFieldName),
  );
}
