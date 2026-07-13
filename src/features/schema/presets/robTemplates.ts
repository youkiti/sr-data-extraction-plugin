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
//
// 原典照合の記録（issue #103）: 実装当時（issue #61 PR1）は outbound egress 制限により一次資料へ
// 直接アクセスできず、上記 BMJ 論文を明示的な典拠として引用しているサードパーティの OSS 実装
// （GitHub: rob-luke/risk-of-bias、risk_of_bias/frameworks/rob2/domains/_domain_{1..5}_*.py の
// Question 定義）から signaling question の英語原文を転記していた（転記元の経緯として記録を残す）。
// その後 2026-07-13 に公式 RoB 2 Word template（completion template, 22 Aug 2019。
// riskofbias.info の公式配布リンク経由で取得）と全 22 問を逐語照合し、**22/22 一致・修正不要**を
// 確認済み（照合待ち TODO は解消）。原典 PDF/DOCX はローカルに保全している:
// `c:\tmp\rob-prespec\`（originals/ に SHA-256 記録付きの SOURCES.md、extracted/ に機械抽出
// テキスト、詳細な照合結果は同 REPORT.md）。なお、この照合は SQ 質問本文についてのものであり、
// 判定アルゴリズム（決定木）の照合状況は features/verification/robAlgorithm.ts 冒頭コメント参照。
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

// --- ROBINS-I SQ（signaling question）完全版（issue #61 PR2 = issue #87） ---------
// 上の ROB_TEMPLATE_ROBINS_I（軽量版: 判定 + 根拠のみ）は不変更で残し、新たに
// 「各ドメインの判定 + 根拠 + SQ 34 問」を一括挿入する完全版プリセットを追加する。
//
// --- 出典 -------------------------------------------------------------------
// signaling question の文言・条件付き質問の発火規則・ドメイン別の判定基準（Table 5〜11）・
// overall の統合規則（Table 2）は、いずれも原典 2 点から直接転記した:
//   - Sterne JAC, Hernán MA, Reeves BC, Savović J, Berkman ND, Viswanathan M, Henry D,
//     Altman DG, et al. ROBINS-I: a tool for assessing risk of bias in non-randomised
//     studies of interventions. BMJ 2016; 355: i4919.
//   - Sterne JAC, Higgins JPT, Elbers RG, Reeves BC and the development group for
//     ROBINS-I. Risk Of Bias In Non-randomized Studies of Interventions (ROBINS-I):
//     detailed guidance, updated 12 October 2016. https://www.riskofbias.info
//     （本セッションでは University of Bristol のミラー
//     https://www.bristol.ac.uk/media-library/.../ROBINS-I_detailed_guidance.pdf を
//     2026-07-13 に取得し、pdfjs-dist でページ本文を機械抽出して逐語照合した。GitHub 以外の
//     ホストへのアクセスが遮断されていた PR1（RoB 2, #86）時点の egress 制限は本セッションでは
//     解除されており、一次資料への直接アクセスと逐語転記ができている）。
//
// **採用版について**: 2024 年 11 月に ROBINS-I V2 が公表され、signaling question の回答から
// ドメイン判定を導く「公式アルゴリズム」が新規に追加されている（Y/N を strong/weak に細分化する
// 変更込み）。しかし V2 は 2026-07 時点でも "still in draft, subject to revision" と明記された
// ドラフト版が最新（riskofbias.info 掲載の 2025-11 版）であり、ドメイン構成・entity_key も
// 2016 版と異なる。本実装は既存コード（`ROBINS_I_DOMAINS` = D1〜D7 + overall。軽量版プリセットが
// 2016 版の構成のまま既に本番運用中）との整合を優先し、**2016 版（Sterne et al. BMJ 2016;355:i4919）
// を採用**する。将来 V2 が正式公開され安定した場合、ドメイン再編を伴う移行は別 issue とする。
//
// **判定アルゴリズムの性質が RoB 2 と異なる点（重要）**: RoB 2 は SQ 回答から判定への写像が
// 完全な決定木として公式ガイダンスに定義されている（`robAlgorithm.ts` 冒頭コメント参照）のに対し、
// ROBINS-I（2016 版）のドメイン判定基準（Table 5〜11）は "very strongly" 対 "not very strongly"、
// "substantial" 対 "important" のような**程度の判断を要する記述**を含み、SQ の y/py/pn/n/ni/na
// という離散コードだけでは一意に決まらない分岐が存在する（特に Critical 判定は「negative control が
// 交絡を強く示唆する」「交絡が原理的に制御不能」等、SQ に無い追加情報を要求する）。
// このため `judgeRobinsIDomain*` の各関数は、**原典の基準が SQ 回答から一意に導ける分岐でのみ
// 判定値を返し、程度の判断や SQ に無い情報を要する分岐では null（提案なし）を返す**。
// これは既存の「回答不足なら提案なし」という契約（buildInfo・collectRobAlgorithmInfo）の自然な
// 拡張であり、人間が必ず最終判定を確定する設計（issue #61 D-2 合意）とも整合する。

/** ROBINS-I SQ 1 問ぶんの定義データ */
interface RobinsISqDef {
  /** signaling question 番号（例 '2.3'）。field_name は `robins_i_sq${code.replace('.', '_')}` */
  code: string;
  /** 所属ドメイン（ROBINS_I_DOMAINS の id と一致させる。overall に SQ は無い） */
  domainId: string;
  /** signaling question の英語原文 */
  question: string;
  /** 条件付き設問の発火条件（日本語要約）。null = 無条件設問 */
  conditionSummary: string | null;
}

const ROBINS_I_SQ_DEFS: readonly RobinsISqDef[] = [
  // --- Domain 1: bias due to confounding（Box 4。8 問） ---
  {
    code: '1.1',
    domainId: 'd1_confounding',
    question: 'Is there potential for confounding of the effect of intervention in this study?',
    conditionSummary: null,
  },
  {
    code: '1.2',
    domainId: 'd1_confounding',
    question: "Was the analysis based on splitting participants' follow up time according to intervention received?",
    conditionSummary: '1.1 が y / py のときのみ回答する（時間依存交絡を評価する必要があるか判定するため）',
  },
  {
    code: '1.3',
    domainId: 'd1_confounding',
    question:
      'Were intervention discontinuations or switches likely to be related to factors that are prognostic ' +
      'for the outcome?',
    conditionSummary: '1.2 が y / py のときのみ回答する',
  },
  {
    code: '1.4',
    domainId: 'd1_confounding',
    question:
      'Did the authors use an appropriate analysis method that controlled for all the important confounding ' +
      'domains?',
    conditionSummary: '1.2 が n / pn、または 1.3 が n / pn のときのみ回答する（ベースライン交絡のみを評価する経路）',
  },
  {
    code: '1.5',
    domainId: 'd1_confounding',
    question:
      'Were confounding domains that were controlled for measured validly and reliably by the variables ' +
      'available in this study?',
    conditionSummary: '1.4 が y / py のときのみ回答する',
  },
  {
    code: '1.6',
    domainId: 'd1_confounding',
    question:
      'Did the authors control for any post-intervention variables that could have been affected by the ' +
      'intervention?',
    conditionSummary: '1.2 が n / pn、または 1.3 が n / pn のときのみ回答する（ベースライン交絡のみを評価する経路）',
  },
  {
    code: '1.7',
    domainId: 'd1_confounding',
    question:
      'Did the authors use an appropriate analysis method that controlled for all the important confounding ' +
      'domains and for time-varying confounding?',
    conditionSummary: '1.3 が y / py のときのみ回答する（時間依存交絡も評価する経路）',
  },
  {
    code: '1.8',
    domainId: 'd1_confounding',
    question:
      'Were confounding domains that were controlled for measured validly and reliably by the variables ' +
      'available in this study?',
    conditionSummary: '1.7 が y / py のときのみ回答する',
  },
  // --- Domain 2: bias in selection of participants into the study（Box 5。5 問） ---
  {
    code: '2.1',
    domainId: 'd2_selection',
    question:
      'Was selection of participants into the study (or into the analysis) based on participant ' +
      'characteristics observed after the start of intervention?',
    conditionSummary: null,
  },
  {
    code: '2.2',
    domainId: 'd2_selection',
    question: 'Were the post-intervention variables that influenced selection likely to be associated with intervention?',
    conditionSummary: '2.1 が y / py のときのみ回答する',
  },
  {
    code: '2.3',
    domainId: 'd2_selection',
    question:
      'Were the post-intervention variables that influenced selection likely to be influenced by the outcome ' +
      'or a cause of the outcome?',
    conditionSummary: '2.2 が y / py のときのみ回答する',
  },
  {
    code: '2.4',
    domainId: 'd2_selection',
    question: 'Do start of follow-up and start of intervention coincide for most participants?',
    conditionSummary: null,
  },
  {
    code: '2.5',
    domainId: 'd2_selection',
    question: 'Were adjustment techniques used that are likely to correct for the presence of selection biases?',
    conditionSummary: '2.2 と 2.3 が両方とも y / py、または 2.4 が n / pn のときのみ回答する',
  },
  // --- Domain 3: bias in classification of interventions（Box 6。3 問） ---
  {
    code: '3.1',
    domainId: 'd3_classification',
    question: 'Were intervention groups clearly defined?',
    conditionSummary: null,
  },
  {
    code: '3.2',
    domainId: 'd3_classification',
    question: 'Was the information used to define intervention groups recorded at the start of the intervention?',
    conditionSummary: null,
  },
  {
    code: '3.3',
    domainId: 'd3_classification',
    question: 'Could classification of intervention status have been affected by knowledge of the outcome or risk of the outcome?',
    conditionSummary: null,
  },
  // --- Domain 4: bias due to deviations from intended interventions（Box 7。6 問。
  //     effect of assignment 版 4.1〜4.2 と effect of starting-and-adhering 版 4.3〜4.6 の
  //     いずれかを回答し、他方は na とする — D-5 合意どおり全問 na 込みで回答させる） ---
  {
    code: '4.1',
    domainId: 'd4_deviations',
    question: 'Were there deviations from the intended intervention beyond what would be expected in usual practice?',
    conditionSummary:
      'この study で評価する効果が assignment（割り付け）への効果の場合のみ回答する。' +
      'starting and adhering（開始・遵守）への効果を評価する場合は na',
  },
  {
    code: '4.2',
    domainId: 'd4_deviations',
    question:
      'Were these deviations from intended intervention unbalanced between groups and likely to have ' +
      'affected the outcome?',
    conditionSummary: '4.1 が y / py のときのみ回答する',
  },
  {
    code: '4.3',
    domainId: 'd4_deviations',
    question: 'Were important co-interventions balanced across intervention groups?',
    conditionSummary:
      'この study で評価する効果が starting and adhering（開始・遵守）への効果の場合のみ回答する。' +
      'assignment（割り付け）への効果を評価する場合は na',
  },
  {
    code: '4.4',
    domainId: 'd4_deviations',
    question: 'Was the intervention implemented successfully for most participants?',
    conditionSummary:
      'この study で評価する効果が starting and adhering（開始・遵守）への効果の場合のみ回答する。' +
      'assignment（割り付け）への効果を評価する場合は na',
  },
  {
    code: '4.5',
    domainId: 'd4_deviations',
    question: 'Did study participants adhere to the assigned intervention regimen?',
    conditionSummary:
      'この study で評価する効果が starting and adhering（開始・遵守）への効果の場合のみ回答する。' +
      'assignment（割り付け）への効果を評価する場合は na',
  },
  {
    code: '4.6',
    domainId: 'd4_deviations',
    question: 'Was an appropriate analysis used to estimate the effect of starting and adhering to the intervention?',
    conditionSummary: '4.3、4.4、4.5 のいずれかが n / pn のときのみ回答する',
  },
  // --- Domain 5: bias due to missing data（Box 8。5 問） ---
  {
    code: '5.1',
    domainId: 'd5_missing_data',
    question: 'Were outcome data available for all, or nearly all, participants?',
    conditionSummary: null,
  },
  {
    code: '5.2',
    domainId: 'd5_missing_data',
    question: 'Were participants excluded due to missing data on intervention status?',
    conditionSummary: null,
  },
  {
    code: '5.3',
    domainId: 'd5_missing_data',
    question: 'Were participants excluded due to missing data on other variables needed for the analysis?',
    conditionSummary: null,
  },
  {
    code: '5.4',
    domainId: 'd5_missing_data',
    question: 'Are the proportion of participants and reasons for missing data similar across interventions?',
    conditionSummary: '5.1 が pn / n、または 5.2 か 5.3 が y / py のときのみ回答する',
  },
  {
    code: '5.5',
    domainId: 'd5_missing_data',
    question: 'Is there evidence that results were robust to the presence of missing data?',
    conditionSummary: '5.1 が pn / n、または 5.2 か 5.3 が y / py のときのみ回答する',
  },
  // --- Domain 6: bias in measurement of outcomes（Box 9。4 問） ---
  {
    code: '6.1',
    domainId: 'd6_measurement',
    question: 'Could the outcome measure have been influenced by knowledge of the intervention received?',
    conditionSummary: null,
  },
  {
    code: '6.2',
    domainId: 'd6_measurement',
    question: 'Were outcome assessors aware of the intervention received by study participants?',
    conditionSummary: null,
  },
  {
    code: '6.3',
    domainId: 'd6_measurement',
    question: 'Were the methods of outcome assessment comparable across intervention groups?',
    conditionSummary: null,
  },
  {
    code: '6.4',
    domainId: 'd6_measurement',
    question: 'Were any systematic errors in measurement of the outcome related to intervention received?',
    conditionSummary: null,
  },
  // --- Domain 7: bias in selection of the reported result（Box 10。3 問） ---
  {
    code: '7.1',
    domainId: 'd7_reporting',
    question:
      'Is the reported effect estimate likely to be selected, on the basis of the results, from multiple ' +
      'outcome measurements within the outcome domain?',
    conditionSummary: null,
  },
  {
    code: '7.2',
    domainId: 'd7_reporting',
    question:
      'Is the reported effect estimate likely to be selected, on the basis of the results, from multiple ' +
      'analyses of the intervention-outcome relationship?',
    conditionSummary: null,
  },
  {
    code: '7.3',
    domainId: 'd7_reporting',
    question:
      'Is the reported effect estimate likely to be selected, on the basis of the results, from different ' +
      'subgroups?',
    conditionSummary: null,
  },
];

/** SQ の field_name（`robins_i_sq1_1` 等）。features/verification/robAlgorithm.ts と共有する唯一の情報源 */
function robinsISqFieldName(code: string): string {
  return `robins_i_sq${code.replace('.', '_')}`;
}

/**
 * ドメイン id → SQ の field_name 一覧（質問番号順）。ROBINS_I_SQ_DEFS から導出することで
 * プリセットが実際に生成する field_name と常に一致させる（robAlgorithm.ts の
 * collectRobAlgorithmInfo がこの一覧を import して SQ 回答を読む。ROB2_SQ_FIELD_NAMES と同じ契約）
 */
export const ROBINS_I_SQ_FIELD_NAMES: Readonly<Record<string, readonly string[]>> = (() => {
  const map: Record<string, string[]> = {};
  for (const def of ROBINS_I_SQ_DEFS) {
    (map[def.domainId] ??= []).push(robinsISqFieldName(def.code));
  }
  return map;
})();

const ROBINS_I_SQ_SECTION = 'risk_of_bias_robins_i_sq';

/** SQ 1 問ぶんの抽出指示: 原文 + コーディング（y/py/pn/n/ni/na）+ 報告ベース限定 + 条件付き na 案内 */
function robinsISqExtractionInstruction(def: RobinsISqDef): string {
  const conditionNote =
    def.conditionSummary === null
      ? ''
      : ` この設問は条件付きです（SQ ${def.conditionSummary}）。条件を満たさない場合は na（not applicable）と明示的に回答してください。`;
  return (
    `ROBINS-I signaling question ${def.code}: "${def.question}" ` +
    'Answer with exactly one of: y (Yes) / py (Probably yes) / pn (Probably no) / n (No) / ' +
    'ni (No information) / na (Not applicable). ' +
    '記事が明示的に報告している内容のみで回答してください。推測やドメイン知識での補完は禁止します。' +
    '該当する報告が無ければ ni（no information）と回答してください。' +
    conditionNote +
    ` Use entity_key "rob:${def.domainId}" for this element.`
  );
}

function robinsISqRow(def: RobinsISqDef): SchemaEditorRow {
  return presetRow({
    section: ROBINS_I_SQ_SECTION,
    fieldName: robinsISqFieldName(def.code),
    fieldLabel: `ROBINS-I SQ ${def.code}`,
    dataType: 'enum',
    allowedValues: 'y|py|pn|n|ni|na',
    required: false,
    extractionInstruction: robinsISqExtractionInstruction(def),
    example: null,
  });
}

/** SQ 完全版の判定行（軽量版と field_name は同一。SQ 回答に基づく判定を明示的に指示する） */
const ROBINS_I_SQ_JUDGEMENT_ROW: SchemaEditorRow = presetRow({
  section: ROBINS_I_SQ_SECTION,
  fieldName: 'robins_i_judgement',
  fieldLabel: 'ROBINS-I 判定（ドメイン別・SQ 完全版）',
  dataType: 'enum',
  allowedValues: 'low|moderate|serious|critical|no_information',
  required: true,
  extractionInstruction:
    'ROBINS-I risk-of-bias judgement for this non-randomized study of an intervention. First answer all of ' +
    "this domain's signaling questions (the robins_i_sq* items in the same section), then give the " +
    'domain-level judgement so that it is consistent with those signaling-question answers, following the ' +
    'official ROBINS-I guidance (Sterne et al. 2016, BMJ;355:i4919). ' +
    `Report one element per domain using exactly these entity_keys: ${domainListing(ROBINS_I_DOMAINS)}. ` +
    'Base each judgement only on what the article reports. ' +
    'If the study is a randomized trial, mark every domain (including its signaling questions) as not_reported.',
  example: 'moderate',
});

/** SQ 完全版の根拠行（軽量版と同一内容。field_name も同一のため排他利用が前提） */
const ROBINS_I_SQ_SUPPORT_ROW: SchemaEditorRow = presetRow({
  section: ROBINS_I_SQ_SECTION,
  fieldName: 'robins_i_support',
  fieldLabel: 'ROBINS-I 判定根拠（ドメイン別・SQ 完全版）',
  dataType: 'text',
  allowedValues: null,
  required: false,
  extractionInstruction:
    'Supporting statement for the ROBINS-I judgement of this domain, grounded in a verbatim quote from the ' +
    'article (e.g. which confounders were adjusted for, how participants were selected, how exposure was ' +
    'ascertained). Use the same entity_keys as robins_i_judgement. If the article reports nothing relevant ' +
    'to the domain, mark it as not_reported.',
  example: 'Analyses were adjusted for age, sex, baseline severity, and comorbidity index.',
});

/** ROBINS-I（SQ 完全版）: ドメイン別の判定 + 根拠 + SQ 34 問（計 36 項目） */
export const ROB_TEMPLATE_ROBINS_I_SQ: readonly SchemaEditorRow[] = [
  ROBINS_I_SQ_JUDGEMENT_ROW,
  ROBINS_I_SQ_SUPPORT_ROW,
  ...ROBINS_I_SQ_DEFS.map(robinsISqRow),
];

// --- QUADAS-3（診断精度研究）（issue #61 PR3 = issue #88） --------------------
//
// --- 出典 -------------------------------------------------------------------
// ドメイン構成・signaling question（SQ）文言・判定スケール・適用可能性（applicability）判定・
// overall 統合規則は、いずれも QUADAS-3 開発グループが公開しているツール本体（Word 文書）から
// 直接転記した:
//   QUADAS-3 (v1.2). University of Bristol, Population Health Sciences.
//   https://www.bristol.ac.uk/media-library/sites/social-community-medicine/quadas/QUADAS-3%201.2.docx
//   （2026-07-13 取得。mammoth.js で本文を機械抽出のうえ Phase 5・6 の記載を逐語転記した）
// あわせて、原著論文 Whiting PF et al. "QUADAS-3: A Revised Tool for the Quality Assessment of
// Diagnostic Test Accuracy Studies." Ann Intern Med 2026;179:548-555（DOI 10.7326/ANNALS-25-02104。
// Bristol 公式ページの記載では 2026-02-17 公表。DOI 中の "25" は原稿番号であり出版年ではない。
// 2025 年は piloting 論文〔J Clin Epidemiol 2025;188:111983〕）が本ツールの
// 出典である（issue #61 D-3 合意: QUADAS-3 は公開済みのため QUADAS-2 での先行実装はしない）。
//
// QUADAS-3 は 4 ドメイン（Participants / Index Test / Target Condition / Analysis）を SQ で評価し、
// ドメイン別の risk-of-bias 判定（low / high / insufficient_information）を導く。このうち
// Participants・Index Test・Target Condition の 3 ドメイン（Analysis を除く）は、レビューの
// synthesis question に対する適用可能性（applicability）の懸念も別途判定する。
// overall（risk of bias・applicability 双方）は「いずれかのドメインが high → 全体 high、
// 全ドメイン low → 全体 low、high は無いが insufficient_information を含む → 全体
// insufficient_information」という原文記載の規則があるが、issue #61 合意（#4「どちらも判定導出
// アルゴリズムは実装しない」）は QUADAS-3 / QUIPS の判定に公式の決定木が無いことを理由にしている。
// QUADAS-3 の overall 規則自体は文章としては単純だが、ドメイン判定そのものが「SQ に n/pn が
// あっても low と判定してよい（レビュー担当者の裁量）」という完全に主観的な総合判断を前提として
// おり、SQ 回答から自動導出できるのは overall のみで肝心のドメイン判定は自動化できない。
// ドメイン判定を自動導出できない以上、overall だけを機械的に導出しても実用上の価値が薄いため、
// robAlgorithm.ts への判定関数追加は行わない（#61 合意どおり AI 判定 + 人間検証のまま）。

/** QUADAS-3 の 4 ドメイン + overall。entity_key は `rob:<domain_id>` になる */
export const QUADAS3_DOMAINS: readonly { id: string; label: string }[] = [
  { id: 'quadas3_d1_participants', label: 'participants' },
  { id: 'quadas3_d2_index_test', label: 'index test' },
  { id: 'quadas3_d3_target_condition', label: 'target condition' },
  { id: 'quadas3_d4_analysis', label: 'analysis' },
  { id: 'quadas3_overall', label: 'overall risk of bias / applicability' },
];

/** QUADAS-3 のうち適用可能性（applicability）も判定する 3 ドメイン + overall（Analysis を除く） */
export const QUADAS3_APPLICABILITY_DOMAINS: readonly { id: string; label: string }[] = [
  { id: 'quadas3_d1_participants', label: 'participants' },
  { id: 'quadas3_d2_index_test', label: 'index test' },
  { id: 'quadas3_d3_target_condition', label: 'target condition' },
  { id: 'quadas3_overall', label: 'overall applicability' },
];

/** QUADAS-3 SQ 1 問ぶんの定義データ */
interface Quadas3SqDef {
  /** signaling question 番号（例 '2.4'）。field_name は `quadas3_sq${code.replace('.', '_')}` */
  code: string;
  /** 所属ドメイン（QUADAS3_DOMAINS の id と一致させる。overall に SQ は無い） */
  domainId: string;
  /** signaling question の英語原文 */
  question: string;
  /** 条件付き設問の発火条件（日本語要約）。null = 無条件設問 */
  conditionSummary: string | null;
}

const QUADAS3_SQ_DEFS: readonly Quadas3SqDef[] = [
  // --- Domain 1: Participants（4 問） ---
  {
    code: '1.1',
    domainId: 'quadas3_d1_participants',
    question: 'Was a single-gate design used?',
    conditionSummary: null,
  },
  {
    code: '1.2',
    domainId: 'quadas3_d1_participants',
    question: 'Were participants prospectively enrolled?',
    conditionSummary: null,
  },
  {
    code: '1.3',
    domainId: 'quadas3_d1_participants',
    question: 'Was a consecutive or random sample of participants included?',
    conditionSummary: null,
  },
  {
    code: '1.4',
    domainId: 'quadas3_d1_participants',
    question: 'Is the study group a representative sample of the intended-use population?',
    conditionSummary: null,
  },
  // --- Domain 2: Index Test（4 問） ---
  {
    code: '2.1',
    domainId: 'quadas3_d2_index_test',
    question: 'Was the index test conducted and interpreted according to the recommended instructions?',
    conditionSummary: null,
  },
  {
    code: '2.2',
    domainId: 'quadas3_d2_index_test',
    question: 'Were the index test results interpreted without knowledge of the reference standard results?',
    conditionSummary: null,
  },
  {
    code: '2.3',
    domainId: 'quadas3_d2_index_test',
    question:
      'Were the index test results interpreted with the same information as would be available when the ' +
      'test is used in practice?',
    conditionSummary: null,
  },
  {
    code: '2.4',
    domainId: 'quadas3_d2_index_test',
    question: 'If an index test threshold was used, was it standard or pre-specified?',
    conditionSummary: 'index test にしきい値を用いた場合のみ回答する。用いていない場合は na',
  },
  // --- Domain 3: Target Condition（8 問） ---
  {
    code: '3.1',
    domainId: 'quadas3_d3_target_condition',
    question: 'Does the reference standard adequately identify those with and without the target condition?',
    conditionSummary: null,
  },
  {
    code: '3.2',
    domainId: 'quadas3_d3_target_condition',
    question: 'Was the target condition assessed in all participants?',
    conditionSummary: null,
  },
  {
    code: '3.3',
    domainId: 'quadas3_d3_target_condition',
    question: 'Was the target condition assessed in the same way in all participants?',
    conditionSummary: null,
  },
  {
    code: '3.4',
    domainId: 'quadas3_d3_target_condition',
    question: 'Did the reference standard avoid incorporating the index test?',
    conditionSummary: null,
  },
  {
    code: '3.5',
    domainId: 'quadas3_d3_target_condition',
    question: 'Was the reference standard conducted and interpreted according to the recommended instructions?',
    conditionSummary: null,
  },
  {
    code: '3.6',
    domainId: 'quadas3_d3_target_condition',
    question: 'Were the reference standard results interpreted without knowledge of the index test results?',
    conditionSummary: null,
  },
  {
    code: '3.7',
    domainId: 'quadas3_d3_target_condition',
    question: 'If a reference standard threshold was used, was it standard or pre-specified?',
    conditionSummary: 'reference standard にしきい値を用いた場合のみ回答する。用いていない場合は na',
  },
  {
    code: '3.8',
    domainId: 'quadas3_d3_target_condition',
    question: 'Was there an appropriate time interval between index test and reference standard?',
    conditionSummary: null,
  },
  // --- Domain 4: Analysis（4 問。原文の番号 4.1〜4.4 をそのまま code に用いる） ---
  {
    code: '4.1',
    domainId: 'quadas3_d4_analysis',
    question: 'Were all participants included in the analysis?',
    conditionSummary: null,
  },
  {
    code: '4.2',
    domainId: 'quadas3_d4_analysis',
    question: 'Were missing data handled appropriately?',
    conditionSummary: null,
  },
  {
    code: '4.3',
    domainId: 'quadas3_d4_analysis',
    question: 'Does the unit of analysis match the ideal test accuracy trial?',
    conditionSummary: null,
  },
  {
    code: '4.4',
    domainId: 'quadas3_d4_analysis',
    question: 'Were the estimates of sensitivity and specificity calculated appropriately?',
    conditionSummary: null,
  },
];

/** SQ の field_name（`quadas3_sq1_1` 等）。features/verification 側と共有する唯一の情報源 */
function quadas3SqFieldName(code: string): string {
  return `quadas3_sq${code.replace('.', '_')}`;
}

/** ドメイン id → SQ の field_name 一覧（質問番号順）。QUADAS3_SQ_DEFS から導出する */
export const QUADAS3_SQ_FIELD_NAMES: Readonly<Record<string, readonly string[]>> = (() => {
  const map: Record<string, string[]> = {};
  for (const def of QUADAS3_SQ_DEFS) {
    (map[def.domainId] ??= []).push(quadas3SqFieldName(def.code));
  }
  return map;
})();

const QUADAS3_SECTION = 'risk_of_bias_quadas3';

function quadas3SqExtractionInstruction(def: Quadas3SqDef): string {
  const conditionNote =
    def.conditionSummary === null
      ? ''
      : ` この設問は条件付きです（${def.conditionSummary}）。条件を満たさない場合は na（not applicable）と明示的に回答してください。`;
  return (
    `QUADAS-3 signaling question ${def.code}: "${def.question}" ` +
    'Answer with exactly one of: y (Yes) / py (Probably yes) / pn (Probably no) / n (No) / ' +
    'ni (No information) / na (Not applicable). ' +
    '記事が明示的に報告している内容のみで回答してください。推測やドメイン知識での補完は禁止します。' +
    '該当する報告が無ければ ni（no information）と回答してください。' +
    conditionNote +
    ` Use entity_key "rob:${def.domainId}" for this element.`
  );
}

function quadas3SqRow(def: Quadas3SqDef): SchemaEditorRow {
  return presetRow({
    section: QUADAS3_SECTION,
    fieldName: quadas3SqFieldName(def.code),
    fieldLabel: `QUADAS-3 SQ ${def.code}`,
    dataType: 'enum',
    allowedValues: 'y|py|pn|n|ni|na',
    required: false,
    extractionInstruction: quadas3SqExtractionInstruction(def),
    example: null,
  });
}

const QUADAS3_ROB_JUDGEMENT_ROW: SchemaEditorRow = presetRow({
  section: QUADAS3_SECTION,
  fieldName: 'quadas3_rob_judgement',
  fieldLabel: 'QUADAS-3 risk-of-bias 判定（ドメイン別）',
  dataType: 'enum',
  allowedValues: 'low|high|insufficient_information',
  required: true,
  extractionInstruction:
    'QUADAS-3 risk-of-bias judgement for this diagnostic test accuracy study. First answer all of this ' +
    "domain's signaling questions (the quadas3_sq* items in the same section), then give the domain-level " +
    'judgement. If all signaling questions for a domain are answered yes or probably yes, risk of bias can ' +
    'be judged low. If any signaling question is answered no or probably no this flags the potential for ' +
    'bias, but the domain can still be judged low if the issue is unlikely to have influenced the accuracy ' +
    'estimates. Use insufficient_information only when insufficient data are reported to permit a judgement. ' +
    `Report one element per domain using exactly these entity_keys: ${domainListing(QUADAS3_DOMAINS)}. ` +
    'The "quadas3_overall" entity_key is the overall risk-of-bias judgement across the four domains ' +
    '(high if any domain is high; low if all domains are low; otherwise insufficient_information). ' +
    'Base each judgement only on what the article reports. ' +
    'If the study is not a diagnostic test accuracy study, mark every domain (including its signaling ' +
    'questions) as not_reported.',
  example: 'low',
});

const QUADAS3_ROB_SUPPORT_ROW: SchemaEditorRow = presetRow({
  section: QUADAS3_SECTION,
  fieldName: 'quadas3_rob_support',
  fieldLabel: 'QUADAS-3 risk-of-bias 判定根拠（ドメイン別）',
  dataType: 'text',
  allowedValues: null,
  required: false,
  extractionInstruction:
    'Supporting statement (rationale) for the QUADAS-3 risk-of-bias judgement of this domain, grounded in a ' +
    'verbatim quote from the article. Use the same entity_keys as quadas3_rob_judgement. If the article ' +
    'reports nothing relevant to the domain, mark it as not_reported.',
  example: 'Consecutive patients were prospectively enrolled from a single referral centre.',
});

const QUADAS3_APPLICABILITY_JUDGEMENT_ROW: SchemaEditorRow = presetRow({
  section: QUADAS3_SECTION,
  fieldName: 'quadas3_applicability_judgement',
  fieldLabel: 'QUADAS-3 適用可能性の懸念（ドメイン別）',
  dataType: 'enum',
  allowedValues: 'low|high|insufficient_information',
  required: false,
  extractionInstruction:
    'QUADAS-3 concern regarding applicability to the systematic review synthesis question, for this domain ' +
    "of this diagnostic test accuracy study (only the participants, index test, and target condition " +
    'domains are assessed for applicability; the analysis domain has no applicability judgement). ' +
    `Report one element per domain using exactly these entity_keys: ${domainListing(QUADAS3_APPLICABILITY_DOMAINS)}. ` +
    'The "quadas3_overall" entity_key is the overall applicability judgement across these three domains ' +
    '(high if any domain is high; low if all domains are low; otherwise insufficient_information). ' +
    'Base each judgement only on what the article reports. ' +
    'If the study is not a diagnostic test accuracy study, mark every domain as not_reported.',
  example: 'low',
});

const QUADAS3_APPLICABILITY_SUPPORT_ROW: SchemaEditorRow = presetRow({
  section: QUADAS3_SECTION,
  fieldName: 'quadas3_applicability_support',
  fieldLabel: 'QUADAS-3 適用可能性の懸念の根拠（ドメイン別）',
  dataType: 'text',
  allowedValues: null,
  required: false,
  extractionInstruction:
    'Supporting statement (rationale) for the QUADAS-3 applicability judgement of this domain, grounded in ' +
    'a verbatim quote from the article. Use the same entity_keys as quadas3_applicability_judgement. If the ' +
    'article reports nothing relevant to the domain, mark it as not_reported.',
  example: 'The study population was restricted to hospitalised patients, unlike the review question population.',
});

/** QUADAS-3: ドメイン別の risk-of-bias 判定 + 根拠 + 適用可能性判定 + 根拠 + SQ 20 問（計 24 項目） */
export const ROB_TEMPLATE_QUADAS3: readonly SchemaEditorRow[] = [
  QUADAS3_ROB_JUDGEMENT_ROW,
  QUADAS3_ROB_SUPPORT_ROW,
  QUADAS3_APPLICABILITY_JUDGEMENT_ROW,
  QUADAS3_APPLICABILITY_SUPPORT_ROW,
  ...QUADAS3_SQ_DEFS.map(quadas3SqRow),
];

// --- QUIPS（予後研究）（issue #61 PR3 = issue #88） ----------------------------
//
// --- 出典 -------------------------------------------------------------------
// ドメイン構成・prompting item・判定スケールは、Cochrane Prognosis Methods Group が公開する
// ツール本体（Excel/PDF）から直接転記した:
//   Hayden JA, van der Windt DA, Cartwright JL, Côté P, Bombardier C.
//   "Assessing Bias in Studies of Prognostic Factors." Ann Intern Med. 2013;158(4):280-286.
//   QUIPS tool（Cochrane Prognosis Methods Group 版）:
//   https://methods.cochrane.org/sites/methods.cochrane.org.prognosis/files/uploads/QUIPS%20tool.pdf
//   （2026-07-13 取得。pdfjs-dist で本文を機械抽出のうえ全 6 ドメインの prompting item を逐語転記した）
//
// QUIPS は RoB 2 / ROBINS-I / QUADAS-3 のような signaling question（Y/PY/PN/N/NI の分岐付き
// 事実確認）ではなく、各ドメイン 3〜7 個の "prompting item"（reporting の adequacy を
// yes/partial/no/unsure で評価する記述文）を反映材料として、レビュー担当者が最終的に
// ドメイン判定（high/moderate/low）を主観的に下す設計（issue #61 §4「浅めの構成」の合意）。
// 全 prompting item を項目化すると本体スキーマが肥大化するため、本実装ではドメインごとに
// 判断の核となる 2 項目のみを抽出項目として採用する（残りの item は原典どおりコード内コメントに
// 一覧を残し、必要になれば追加できる構造にしている）。overall（ドメイン横断の統合判定）は
// 原典に規定が無いため実装しない（ドメイン別の 6 判定のみ）。
// judgement 導出アルゴリズムは実装しない（issue #61 合意「公式の決定木が無い」ため）。

/** QUIPS の 6 ドメイン（overall は無い）。entity_key は `rob:<domain_id>` になる */
export const QUIPS_DOMAINS: readonly { id: string; label: string }[] = [
  { id: 'quips_d1_participation', label: 'study participation' },
  { id: 'quips_d2_attrition', label: 'study attrition' },
  { id: 'quips_d3_pf_measurement', label: 'prognostic factor measurement' },
  { id: 'quips_d4_outcome_measurement', label: 'outcome measurement' },
  { id: 'quips_d5_confounding', label: 'study confounding' },
  { id: 'quips_d6_analysis_reporting', label: 'statistical analysis and reporting' },
];

/** QUIPS prompting item 1 問ぶんの定義データ（ドメインごとに核となる 2 項目のみを採用） */
interface QuipsItemDef {
  /** item 番号（例 '3.2'）。field_name は `quips_pi${code.replace('.', '_')}` */
  code: string;
  /** 所属ドメイン（QUIPS_DOMAINS の id と一致させる） */
  domainId: string;
  /** prompting item の英語原文（原典の見出し + 記述文） */
  statement: string;
}

const QUIPS_ITEM_DEFS: readonly QuipsItemDef[] = [
  // --- Domain 1: Study Participation（原典は 7 項目。核となる 2 項目を採用） ---
  {
    code: '1.1',
    domainId: 'quips_d1_participation',
    statement: 'There is adequate participation in the study by eligible individuals.',
  },
  {
    code: '1.2',
    domainId: 'quips_d1_participation',
    statement:
      'The source population or population of interest is adequately described for key characteristics.',
  },
  // --- Domain 2: Study Attrition（原典は 5 項目。核となる 2 項目を採用） ---
  {
    code: '2.1',
    domainId: 'quips_d2_attrition',
    statement:
      'Response rate (i.e., proportion of study sample completing the study and providing outcome data) is adequate.',
  },
  {
    code: '2.2',
    domainId: 'quips_d2_attrition',
    statement: 'Reasons for loss to follow-up are provided.',
  },
  // --- Domain 3: Prognostic Factor Measurement（原典は 6 項目。核となる 2 項目を採用） ---
  {
    code: '3.1',
    domainId: 'quips_d3_pf_measurement',
    statement: "A clear definition or description of the prognostic factor is provided.",
  },
  {
    code: '3.2',
    domainId: 'quips_d3_pf_measurement',
    statement:
      'Method of prognostic factor measurement is adequately valid and reliable to limit misclassification bias.',
  },
  // --- Domain 4: Outcome Measurement（原典は 3 項目。核となる 2 項目を採用） ---
  {
    code: '4.1',
    domainId: 'quips_d4_outcome_measurement',
    statement:
      'A clear definition of outcome is provided, including duration of follow-up and level and extent of ' +
      'the outcome construct.',
  },
  {
    code: '4.2',
    domainId: 'quips_d4_outcome_measurement',
    statement:
      'The method of outcome measurement used is adequately valid and reliable to limit misclassification bias.',
  },
  // --- Domain 5: Study Confounding（原典は 7 項目。核となる 2 項目を採用） ---
  {
    code: '5.1',
    domainId: 'quips_d5_confounding',
    statement: 'All important confounders, including treatments, are measured.',
  },
  {
    code: '5.2',
    domainId: 'quips_d5_confounding',
    statement:
      'Important potential confounders are accounted for in the analysis (i.e., appropriate adjustment).',
  },
  // --- Domain 6: Statistical Analysis and Reporting（原典は 4 項目。核となる 2 項目を採用） ---
  {
    code: '6.1',
    domainId: 'quips_d6_analysis_reporting',
    statement: 'There is sufficient presentation of data to assess the adequacy of the analysis.',
  },
  {
    code: '6.2',
    domainId: 'quips_d6_analysis_reporting',
    statement: 'There is no selective reporting of results.',
  },
];

function quipsItemFieldName(code: string): string {
  return `quips_pi${code.replace('.', '_')}`;
}

/** ドメイン id → prompting item の field_name 一覧。QUIPS_ITEM_DEFS から導出する */
export const QUIPS_ITEM_FIELD_NAMES: Readonly<Record<string, readonly string[]>> = (() => {
  const map: Record<string, string[]> = {};
  for (const def of QUIPS_ITEM_DEFS) {
    (map[def.domainId] ??= []).push(quipsItemFieldName(def.code));
  }
  return map;
})();

const QUIPS_SECTION = 'risk_of_bias_quips';

function quipsItemExtractionInstruction(def: QuipsItemDef): string {
  return (
    `QUIPS prompting item ${def.code}: rate whether the article supports this statement — "${def.statement}" ` +
    'Answer with exactly one of: yes / partial / no / unsure, based only on what the article explicitly ' +
    'reports (do not guess or fill in from domain knowledge). If the article does not report enough to judge ' +
    'this item, answer unsure. ' +
    `Use entity_key "rob:${def.domainId}" for this element.`
  );
}

function quipsItemRow(def: QuipsItemDef): SchemaEditorRow {
  return presetRow({
    section: QUIPS_SECTION,
    fieldName: quipsItemFieldName(def.code),
    fieldLabel: `QUIPS item ${def.code}`,
    dataType: 'enum',
    allowedValues: 'yes|partial|no|unsure',
    required: false,
    extractionInstruction: quipsItemExtractionInstruction(def),
    example: null,
  });
}

const QUIPS_JUDGEMENT_ROW: SchemaEditorRow = presetRow({
  section: QUIPS_SECTION,
  fieldName: 'quips_judgement',
  fieldLabel: 'QUIPS 判定（ドメイン別）',
  dataType: 'enum',
  allowedValues: 'high|moderate|low',
  required: true,
  extractionInstruction:
    'QUIPS risk-of-bias judgement for this domain of this prognostic factor study. First answer all of ' +
    "this domain's prompting items (the quips_pi* items in the same section), then give the domain-level " +
    'judgement (high, moderate, or low risk of bias) based on the prompting items taken together. ' +
    `Report one element per domain using exactly these entity_keys: ${domainListing(QUIPS_DOMAINS)}. ` +
    'Base each judgement only on what the article reports. ' +
    'If the study is not a prognostic factor study, mark every domain (including its prompting items) as ' +
    'not_reported.',
  example: 'moderate',
});

const QUIPS_SUPPORT_ROW: SchemaEditorRow = presetRow({
  section: QUIPS_SECTION,
  fieldName: 'quips_support',
  fieldLabel: 'QUIPS 判定根拠（ドメイン別）',
  dataType: 'text',
  allowedValues: null,
  required: false,
  extractionInstruction:
    'Supporting statement (rationale) for the QUIPS judgement of this domain, grounded in a verbatim quote ' +
    'from the article. Use the same entity_keys as quips_judgement. If the article reports nothing relevant ' +
    'to the domain, mark it as not_reported.',
  example: 'Response rate was 92% with reasons for loss to follow-up reported for all non-completers.',
});

/** QUIPS: ドメイン別の判定 + 根拠 + prompting item 12 問（計 14 項目） */
export const ROB_TEMPLATE_QUIPS: readonly SchemaEditorRow[] = [
  QUIPS_JUDGEMENT_ROW,
  QUIPS_SUPPORT_ROW,
  ...QUIPS_ITEM_DEFS.map(quipsItemRow),
];

export type RobPresetKind = 'rob2' | 'robins_i' | 'rob2_sq' | 'robins_i_sq' | 'quadas3' | 'quips';

/** プリセット挿入用の一覧（UI のボタンと 1:1） */
export const ROB_TEMPLATES: Record<RobPresetKind, readonly SchemaEditorRow[]> = {
  rob2: ROB_TEMPLATE_ROB2,
  robins_i: ROB_TEMPLATE_ROBINS_I,
  rob2_sq: ROB_TEMPLATE_ROB2_SQ,
  robins_i_sq: ROB_TEMPLATE_ROBINS_I_SQ,
  quadas3: ROB_TEMPLATE_QUADAS3,
  quips: ROB_TEMPLATE_QUIPS,
};
