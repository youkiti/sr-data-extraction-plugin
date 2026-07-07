// RoB 評価テンプレート（requirements.md §3.3 v0.9。P1 → MVP 前倒し）。
// スキーマエディタの「プリセット挿入」から rob_domain レベルの項目群を一括追加する。
// ドメインの列挙は extraction_instruction に entity_key ごと明示する方式 —
// extract-data skill のプロンプト本文（凍結ベンチマークと同版数）へ手を入れずに、
// AI が固定ドメインごとの 1 インスタンスを返せるようにするための設計判断
import type { SchemaEditorRow } from '../types';

/** RoB 2 のドメイン（D1〜D5 + overall）。entity_key は `rob:<domain_id>` になる */
export const ROB2_DOMAINS: readonly { id: string; label: string }[] = [
  { id: 'd1_randomization', label: 'randomization process' },
  { id: 'd2_deviations', label: 'deviations from intended interventions' },
  { id: 'd3_missing_data', label: 'missing outcome data' },
  { id: 'd4_measurement', label: 'measurement of the outcome' },
  { id: 'd5_reporting', label: 'selection of the reported result' },
  { id: 'overall', label: 'overall risk of bias' },
];

/** ROBINS-I のドメイン（D1〜D7 + overall） */
export const ROBINS_I_DOMAINS: readonly { id: string; label: string }[] = [
  { id: 'd1_confounding', label: 'confounding' },
  { id: 'd2_selection', label: 'selection of participants' },
  { id: 'd3_classification', label: 'classification of interventions' },
  { id: 'd4_deviations', label: 'deviations from intended interventions' },
  { id: 'd5_missing_data', label: 'missing data' },
  { id: 'd6_measurement', label: 'measurement of outcomes' },
  { id: 'd7_reporting', label: 'selection of the reported result' },
  { id: 'overall', label: 'overall risk of bias' },
];

/** 抽出指示に埋め込むドメイン列挙（`rob:<id> (label)` をカンマ区切りで並べる） */
function domainListing(domains: readonly { id: string; label: string }[]): string {
  return domains.map((domain) => `"rob:${domain.id}" (${domain.label})`).join(', ');
}

function presetRow(
  patch: Pick<
    SchemaEditorRow,
    'fieldName' | 'fieldLabel' | 'dataType' | 'allowedValues' | 'required' | 'extractionInstruction' | 'example'
  >,
): SchemaEditorRow {
  return {
    fieldId: null,
    section: 'risk_of_bias',
    entityLevel: 'rob_domain',
    unit: null,
    aiGenerated: false,
    note: null,
    ...patch,
  };
}

/** RoB 2（ランダム化比較試験）: ドメイン別の判定 + 根拠 */
export const ROB_TEMPLATE_ROB2: readonly SchemaEditorRow[] = [
  presetRow({
    fieldName: 'rob2_judgement',
    fieldLabel: 'RoB 2 判定（ドメイン別）',
    dataType: 'enum',
    allowedValues: 'low|some_concerns|high',
    required: true,
    extractionInstruction:
      'Cochrane RoB 2 risk-of-bias judgement for this randomized trial. Report one element per domain ' +
      `using exactly these entity_keys: ${domainListing(ROB2_DOMAINS)}. ` +
      'Base each judgement only on what the article reports (randomization method, allocation concealment, ' +
      'blinding, attrition, analysis population, protocol or registry references). ' +
      'If the study is not a randomized trial, mark every domain as not_reported.',
    example: 'some_concerns',
  }),
  presetRow({
    fieldName: 'rob2_support',
    fieldLabel: 'RoB 2 判定根拠（ドメイン別）',
    dataType: 'text',
    allowedValues: null,
    required: false,
    extractionInstruction:
      'Supporting statement for the RoB 2 judgement of this domain, grounded in a verbatim quote from the ' +
      'article (e.g. how the randomization sequence was generated, who was blinded, how missing data were ' +
      'handled). Use the same entity_keys as rob2_judgement. If the article reports nothing relevant to the ' +
      'domain, mark it as not_reported.',
    example: 'Participants were randomly assigned using a computer-generated sequence with concealed allocation.',
  }),
];

/** ROBINS-I（非ランダム化介入研究）: ドメイン別の判定 + 根拠 */
export const ROB_TEMPLATE_ROBINS_I: readonly SchemaEditorRow[] = [
  presetRow({
    fieldName: 'robins_i_judgement',
    fieldLabel: 'ROBINS-I 判定（ドメイン別）',
    dataType: 'enum',
    allowedValues: 'low|moderate|serious|critical|no_information',
    required: true,
    extractionInstruction:
      'ROBINS-I risk-of-bias judgement for this non-randomized study of an intervention. Report one element ' +
      `per domain using exactly these entity_keys: ${domainListing(ROBINS_I_DOMAINS)}. ` +
      'Base each judgement only on what the article reports (confounding control, participant selection, ' +
      'exposure classification, deviations, missing data, outcome measurement, reporting). ' +
      'If the study is a randomized trial, mark every domain as not_reported.',
    example: 'moderate',
  }),
  presetRow({
    fieldName: 'robins_i_support',
    fieldLabel: 'ROBINS-I 判定根拠（ドメイン別）',
    dataType: 'text',
    allowedValues: null,
    required: false,
    extractionInstruction:
      'Supporting statement for the ROBINS-I judgement of this domain, grounded in a verbatim quote from the ' +
      'article (e.g. which confounders were adjusted for, how participants were selected, how exposure was ' +
      'ascertained). Use the same entity_keys as robins_i_judgement. If the article reports nothing relevant ' +
      'to the domain, mark it as not_reported.',
    example: 'Analyses were adjusted for age, sex, baseline severity, and comorbidity index.',
  }),
];

export type RobPresetKind = 'rob2' | 'robins_i';

/** プリセット挿入用の一覧（UI のボタンと 1:1） */
export const ROB_TEMPLATES: Record<RobPresetKind, readonly SchemaEditorRow[]> = {
  rob2: ROB_TEMPLATE_ROB2,
  robins_i: ROB_TEMPLATE_ROBINS_I,
};
