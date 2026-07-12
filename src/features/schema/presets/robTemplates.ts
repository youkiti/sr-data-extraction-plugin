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
  > & { section?: string },
): SchemaEditorRow {
  const { section, ...rest } = patch;
  return {
    fieldId: null,
    section: section ?? 'risk_of_bias',
    entityLevel: 'rob_domain',
    unit: null,
    aiGenerated: false,
    note: null,
    ...rest,
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

// --- RoB 2 SQ（signaling question）完全版（issue #61 PR1） -------------------
// 上の ROB_TEMPLATE_ROB2（軽量版: 判定 + 根拠のみ）は不変更で残し、新たに
// 「各ドメインの判定 + 根拠 + SQ 22 問」を一括挿入する完全版プリセットを追加する。
//
// 出典: signaling question の文言・条件付き質問の発火規則・ドメイン別アルゴリズムは、いずれも
// Sterne JAC et al. "RoB 2: a revised tool for assessing risk of bias in randomised trials."
// BMJ 2019;366:l4898 の付随ガイダンス（Cochrane, RoB 2 guidance, 2019）に基づく。
// 一次資料（cochrane.de の PDF・BMJ 誌本体・riskofbias.info 等）は本セッションの outbound
// egress ポリシーにより直接アクセスできなかった（github.com / raw.githubusercontent.com 以外の
// 大半のホストが 403 で遮断された）。そのため、上記 BMJ 論文を明示的な典拠として引用している
// サードパーティの OSS 実装（GitHub: rob-luke/risk-of-bias、
// risk_of_bias/frameworks/rob2/domains/_domain_{1..5}_*.py の Question 定義）から
// signaling question の英語原文を取得して転記した。一次資料との逐語照合はできていないため、
// **正式なガイダンス PDF 入手時に再照合すること**（TODO: 原典照合待ち。
// features/verification/robAlgorithm.ts 冒頭のコメントに同種の注記あり）。
//
// 対象は individually randomized parallel-group trials 版・effect of assignment（ITT）:
// D1（1.1〜1.3）/ D2（2.1〜2.7）/ D3（3.1〜3.4）/ D4（4.1〜4.5）/ D5（5.1〜5.3）= 22 問。
// 判定 + 根拠（entity_key はドメイン別に既存 rob2_judgement / rob2_support と同一の field_name
// を再利用する。lightweight 版と field_name が衝突するため、両プリセットは排他利用を前提とする
// — 同時挿入時の重複はエディタ確定前のバリデーション〔field_name 重複〕で検出される）+ SQ 22 問を
// 同一 section 'risk_of_bias_rob2'（lightweight 版の 'risk_of_bias' とは別）にまとめ、
// planRun のセクション単位バッチ分割で「SQ 回答 → その回答に基づく判定」を 1 回の LLM 呼び出しで
// 一貫させる（judgement/support だけ別セクションに切り離すと、AI が SQ を見ずに判定するバッチに
// 分割されてしまうため）。

/** RoB 2 SQ 1 問ぶんの定義データ（field_name・extraction_instruction の生成元） */
interface Rob2SqDef {
  /** signaling question 番号（例 '2.3'）。field_name は `rob2_sq${code.replace('.', '_')}` */
  code: string;
  /** 所属ドメイン（ROB2_DOMAINS の id と一致させる。overall に SQ は無い） */
  domainId: string;
  /** signaling question の英語原文（条件付き設問は原文中に "If ..." の前置きを含む） */
  question: string;
  /**
   * 条件付き設問の発火条件（日本語要約。na 回答を明示させる案内に使う）。
   * null = 無条件（常に評価する）設問
   */
  conditionSummary: string | null;
}

const ROB2_SQ_DEFS: readonly Rob2SqDef[] = [
  // --- Domain 1: bias arising from the randomization process（無条件 3 問） ---
  {
    code: '1.1',
    domainId: 'd1_randomization',
    question: 'Was the allocation sequence random?',
    conditionSummary: null,
  },
  {
    code: '1.2',
    domainId: 'd1_randomization',
    question:
      'Was the allocation sequence concealed until participants were enrolled and assigned to interventions?',
    conditionSummary: null,
  },
  {
    code: '1.3',
    domainId: 'd1_randomization',
    question: 'Did baseline differences between intervention groups suggest a problem with the randomization process?',
    conditionSummary: null,
  },
  // --- Domain 2: deviations from intended interventions（effect of assignment / ITT 版・7 問） ---
  {
    code: '2.1',
    domainId: 'd2_deviations',
    question: 'Were participants aware of their assigned intervention during the trial?',
    conditionSummary: null,
  },
  {
    code: '2.2',
    domainId: 'd2_deviations',
    question:
      "Were carers and people delivering the interventions aware of participants' assigned intervention during the trial?",
    conditionSummary: null,
  },
  {
    code: '2.3',
    domainId: 'd2_deviations',
    question: 'Were there deviations from the intended intervention that arose because of the trial context?',
    conditionSummary: 'SQ 2.1 または 2.2 が y / py / ni のときのみ回答する',
  },
  {
    code: '2.4',
    domainId: 'd2_deviations',
    question: 'Were these deviations likely to have affected the outcome?',
    conditionSummary: 'SQ 2.3 が y / py のときのみ回答する',
  },
  {
    code: '2.5',
    domainId: 'd2_deviations',
    question: 'Were these deviations from intended intervention balanced between groups?',
    conditionSummary: 'SQ 2.4 が y / py / ni のときのみ回答する',
  },
  {
    code: '2.6',
    domainId: 'd2_deviations',
    question: 'Was an appropriate analysis used to estimate the effect of assignment to intervention?',
    conditionSummary: null,
  },
  {
    code: '2.7',
    domainId: 'd2_deviations',
    question:
      'Was there potential for a substantial impact (on the result) of the failure to analyse participants ' +
      'in the group to which they were randomized?',
    conditionSummary: 'SQ 2.6 が n / pn / ni のときのみ回答する',
  },
  // --- Domain 3: missing outcome data（4 問） ---
  {
    code: '3.1',
    domainId: 'd3_missing_data',
    question: 'Were data for this outcome available for all, or nearly all, participants randomized?',
    conditionSummary: null,
  },
  {
    code: '3.2',
    domainId: 'd3_missing_data',
    question: 'Is there evidence that the result was not biased by missing outcome data?',
    conditionSummary: 'SQ 3.1 が n / pn / ni のときのみ回答する',
  },
  {
    code: '3.3',
    domainId: 'd3_missing_data',
    question: 'Could missingness in the outcome depend on its true value?',
    conditionSummary: 'SQ 3.2 が n / pn のときのみ回答する',
  },
  {
    code: '3.4',
    domainId: 'd3_missing_data',
    question: 'Is it likely that missingness in the outcome depended on its true value?',
    conditionSummary: 'SQ 3.3 が y / py / ni のときのみ回答する',
  },
  // --- Domain 4: measurement of the outcome（5 問） ---
  {
    code: '4.1',
    domainId: 'd4_measurement',
    question: 'Was the method of measuring the outcome inappropriate?',
    conditionSummary: null,
  },
  {
    code: '4.2',
    domainId: 'd4_measurement',
    question: 'Could measurement or ascertainment of the outcome have differed between intervention groups?',
    conditionSummary: null,
  },
  {
    code: '4.3',
    domainId: 'd4_measurement',
    question: 'Were outcome assessors aware of the intervention received by study participants?',
    conditionSummary: 'SQ 4.1 と 4.2 が両方とも n / pn / ni のときのみ回答する',
  },
  {
    code: '4.4',
    domainId: 'd4_measurement',
    question: 'Could assessment of the outcome have been influenced by knowledge of intervention received?',
    conditionSummary: 'SQ 4.3 が y / py / ni のときのみ回答する',
  },
  {
    code: '4.5',
    domainId: 'd4_measurement',
    question: 'Is it likely that assessment of the outcome was influenced by knowledge of intervention received?',
    conditionSummary: 'SQ 4.4 が y / py / ni のときのみ回答する',
  },
  // --- Domain 5: selection of the reported result（無条件 3 問） ---
  {
    code: '5.1',
    domainId: 'd5_reporting',
    question:
      'Were the data that produced this result analysed in accordance with a pre-specified analysis plan ' +
      'that was finalized before unblinded outcome data were available for analysis?',
    conditionSummary: null,
  },
  {
    code: '5.2',
    domainId: 'd5_reporting',
    question:
      'Is the numerical result being assessed likely to have been selected, on the basis of the results, ' +
      'from multiple eligible outcome measurements (e.g. scales, definitions, time points) within the outcome domain?',
    conditionSummary: null,
  },
  {
    code: '5.3',
    domainId: 'd5_reporting',
    question:
      'Is the numerical result being assessed likely to have been selected, on the basis of the results, ' +
      'from multiple eligible analyses of the data?',
    conditionSummary: null,
  },
];

/** SQ の field_name（`rob2_sq1_1` 等）。features/verification/robAlgorithm.ts と共有する唯一の情報源 */
function rob2SqFieldName(code: string): string {
  return `rob2_sq${code.replace('.', '_')}`;
}

/**
 * ドメイン id → SQ の field_name 一覧（質問番号順）。ROB2_SQ_DEFS から導出することで
 * プリセットが実際に生成する field_name と常に一致させる（robAlgorithm.ts の
 * collectRobAlgorithmInfo がこの一覧を import して SQ 回答を読む）
 */
export const ROB2_SQ_FIELD_NAMES: Readonly<Record<string, readonly string[]>> = (() => {
  const map: Record<string, string[]> = {};
  for (const def of ROB2_SQ_DEFS) {
    (map[def.domainId] ??= []).push(rob2SqFieldName(def.code));
  }
  return map;
})();

const ROB2_SQ_SECTION = 'risk_of_bias_rob2';

/** SQ 1 問ぶんの抽出指示: 原文 + コーディング（y/py/pn/n/ni/na）+ 報告ベース限定 + 条件付き na 案内 */
function sqExtractionInstruction(def: Rob2SqDef): string {
  const conditionNote =
    def.conditionSummary === null
      ? ''
      : ` この設問は条件付きです（${def.conditionSummary}）。条件を満たさない場合は na（not applicable）と明示的に回答してください。`;
  return (
    `RoB 2 signaling question ${def.code}: "${def.question}" ` +
    'Answer with exactly one of: y (Yes) / py (Probably yes) / pn (Probably no) / n (No) / ' +
    'ni (No information) / na (Not applicable). ' +
    '記事が明示的に報告している内容のみで回答してください。推測やドメイン知識での補完は禁止します。' +
    '該当する報告が無ければ ni（no information）と回答してください。' +
    conditionNote +
    ` Use entity_key "rob:${def.domainId}" for this element.`
  );
}

function sqRow(def: Rob2SqDef): SchemaEditorRow {
  return presetRow({
    section: ROB2_SQ_SECTION,
    fieldName: rob2SqFieldName(def.code),
    fieldLabel: `RoB 2 SQ ${def.code}`,
    dataType: 'enum',
    allowedValues: 'y|py|pn|n|ni|na',
    required: false,
    extractionInstruction: sqExtractionInstruction(def),
    example: null,
  });
}

/** SQ 完全版の判定行（軽量版と field_name は同一だが、SQ 回答に基づく判定を明示的に指示する） */
const ROB2_SQ_JUDGEMENT_ROW: SchemaEditorRow = presetRow({
  section: ROB2_SQ_SECTION,
  fieldName: 'rob2_judgement',
  fieldLabel: 'RoB 2 判定（ドメイン別・SQ 完全版）',
  dataType: 'enum',
  allowedValues: 'low|some_concerns|high',
  required: true,
  extractionInstruction:
    'Cochrane RoB 2 risk-of-bias judgement for this randomized trial. First answer all of this domain\'s ' +
    'signaling questions (the rob2_sq* items in the same section), then give the domain-level judgement so ' +
    'that it is consistent with those signaling-question answers, following the official RoB 2 algorithm ' +
    '(Sterne et al. 2019, BMJ;366:l4898). ' +
    `Report one element per domain using exactly these entity_keys: ${domainListing(ROB2_DOMAINS)}. ` +
    'Base each judgement only on what the article reports. ' +
    'If the study is not a randomized trial, mark every domain (including its signaling questions) as not_reported.',
  example: 'some_concerns',
});

/** SQ 完全版の根拠行（軽量版と同一内容。field_name も同一のため排他利用が前提） */
const ROB2_SQ_SUPPORT_ROW: SchemaEditorRow = presetRow({
  section: ROB2_SQ_SECTION,
  fieldName: 'rob2_support',
  fieldLabel: 'RoB 2 判定根拠（ドメイン別・SQ 完全版）',
  dataType: 'text',
  allowedValues: null,
  required: false,
  extractionInstruction:
    'Supporting statement for the RoB 2 judgement of this domain, grounded in a verbatim quote from the ' +
    'article (e.g. how the randomization sequence was generated, who was blinded, how missing data were ' +
    'handled). Use the same entity_keys as rob2_judgement. If the article reports nothing relevant to the ' +
    'domain, mark it as not_reported.',
  example: 'Participants were randomly assigned using a computer-generated sequence with concealed allocation.',
});

/** RoB 2（SQ 完全版）: ドメイン別の判定 + 根拠 + SQ 22 問（計 24 項目） */
export const ROB_TEMPLATE_ROB2_SQ: readonly SchemaEditorRow[] = [
  ROB2_SQ_JUDGEMENT_ROW,
  ROB2_SQ_SUPPORT_ROW,
  ...ROB2_SQ_DEFS.map(sqRow),
];

export type RobPresetKind = 'rob2' | 'robins_i' | 'rob2_sq';

/** プリセット挿入用の一覧（UI のボタンと 1:1） */
export const ROB_TEMPLATES: Record<RobPresetKind, readonly SchemaEditorRow[]> = {
  rob2: ROB_TEMPLATE_ROB2,
  robins_i: ROB_TEMPLATE_ROBINS_I,
  rob2_sq: ROB_TEMPLATE_ROB2_SQ,
};
