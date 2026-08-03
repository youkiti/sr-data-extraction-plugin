// デモ論文（UDCA RCT）の本文・抽出内容の単一の正典。
//
// 【重要な注意】本 PR の実装セッションはサンドボックス化されたネットワークポリシーにより
// 出版社・PMC・Europe PMC 等の研究系ドメインへ一切到達できなかった（journals.plos.org /
// pmc.ncbi.nlm.nih.gov / www.ebi.ac.uk 等、10 以上のホストで CONNECT が組織ポリシーにより
// 403 拒否されることを確認済み）。そのため本ファイルの PAGE_TEXTS（later 内 loadFixturePdf
// 経由でローカル専用の代替 PDF 生成にのみ使う）は実論文 PMC10715657
// （Zarkesh N, et al. "Evaluation of therapeutic effect of oral Ursodeoxycholic Acid on
// indirect hyperbilirubinemia in term neonates undergoing phototherapy: A randomized
// controlled clinical trial." PLoS ONE 2023. doi:10.1371/journal.pone.0273516. CC BY 4.0）を
// 主題・試験デザインの一般的な事実（対象疾患・介入・国・概算症例数等、公知情報から把握できる範囲）
// を踏まえて**独自に作文した要約文**であり、実論文からの逐語引用ではない。
//
// video/fixtures/fetch-fixtures.sh が実ネットワーク環境で実 PDF を取得した後は、
// 本ファイルの PAGE_TEXTS / FIELD_INSTANCES の quote は実 PDF のテキストと一致しない可能性が高い
// （抽出時は exact ではなく fuzzy/failed 判定へ後退しうる）。実 PDF 取得後の再検証・
// quote の再調整は本 PR 後続の申し送り事項（PR レポート参照）。
import type { AnchorStatus } from '../domain/anchor';
import type { Confidence } from '../domain/evidence';
import { DEMO_ARM_KEYS, DEMO_OUTCOME_ENTITY_KEYS } from './constants';

/** デモ論文の書誌情報（Documents タブ用。DOI は既存 tests/fixtures/pdf/README.md に記載の値を踏襲） */
export const DEMO_PAPER_META = {
  filename: 'PMC10715657_plosone_udca_rct.pdf',
  title:
    'Evaluation of therapeutic effect of oral Ursodeoxycholic Acid on indirect hyperbilirubinemia in term neonates undergoing phototherapy: A randomized controlled clinical trial',
  doi: '10.1371/journal.pone.0273516',
  // PMID は本セッションでは検証できなかったため、未確認のまま断定しない（null = 未取得）
  pmid: null as string | null,
};

/**
 * ローカル代替 PDF（video/fixtures/*.pdf が実ネットワーク環境で取得されるまでの、
 * このセッション内の動作確認専用フィクスチャ）のページ別本文。
 * 4 ページ構成（Introduction / Methods / Methods 続き / Results 相当）。
 * FIELD_INSTANCES の quote はすべてこのテキストの部分文字列（1 か所を除く。後述）になるよう作文している。
 */
export const PAGE_TEXTS: readonly string[] = [
  // page 1: Introduction 相当
  `Evaluation of therapeutic effect of oral Ursodeoxycholic Acid on indirect hyperbilirubinemia in term neonates undergoing phototherapy: A randomized controlled clinical trial

This randomized controlled trial was conducted in the neonatal ward of a teaching hospital in Ahvaz, Iran. Neonatal indirect hyperbilirubinemia remains a common cause of hospital readmission in term infants, and adjunctive pharmacological therapies to conventional phototherapy continue to be investigated. Term neonates with indirect hyperbilirubinemia were randomly allocated to receive either oral ursodeoxycholic acid plus phototherapy or phototherapy alone in this parallel-group randomized controlled trial. The primary aim was to compare the rate of total serum bilirubin decline between the two groups.`,
  // page 2: Methods
  `Methods

Eligible neonates were enrolled between March 2021 and February 2022. Term neonates admitted for indirect hyperbilirubinemia requiring phototherapy were screened, and those meeting eligibility criteria were randomized using a computer-generated sequence. A total of 106 term neonates completed the study and were included in the final analysis. Total serum bilirubin was monitored daily until discharge, up to a maximum of seven days after enrollment.

Neonates in the intervention group received oral ursodeoxycholic acid (10 mg/kg/day, divided into two doses) in addition to conventional phototherapy. Fifty-three neonates were randomized to the ursodeoxycholic acid plus phototherapy group. Neonates in the control group received conventional phototherapy alone, with no additional pharmacological intervention. The remaining fifty-three neonates were allocated to the control group receiving phototherapy alone.`,
  // page 3: Methods（続き）+ Outcomes
  `Baseline characteristics did not differ significantly between groups. The mean gestational age of enrolled neonates was 38.4 (SD 1.1) weeks. Of the 106 neonates, 50 (47.2%) were female.

The UDCA dose was 10 mg/kg per day, administered orally in two divided doses, for the duration of phototherapy. Standard blue-light phototherapy was administered continuously except during feeding, identically in both groups.

The primary outcome was the reduction in total serum bilirubin (TSB) from enrollment to 24 hours after starting treatment. TSB levels were reassessed 24 hours after the initiation of treatment in both groups.`,
  // page 4: Results
  `Results

In the UDCA plus phototherapy group, TSB decreased by a mean of 6.8 (SD 1.4) mg/dL at 24 hours. In the phototherapy-alone group, the mean TSB reduction at 24 hours was 4.9 (SD 1.6) mg/dL. Mean difference -1.9 mg/dL (95% CI -2.6 to -1.2) favored the UDCA group (P<0.001). No serious adverse events attributable to ursodeoxycholic acid were observed during the study period.`,
];

export interface FieldInstanceContent {
  fieldId: string;
  entityKey: string;
  /** AI が抽出した原本の値。null = not_reported */
  value: string | null;
  /**
   * Evidence.quote として保存する文字列（意図的に実テキストと食い違わせている 2 件を含む。
   * §5 の anchor_status の作り分け: female_percent は数値の丸め違いで fuzzy、
   * outcome_effect_size(arm:1) は別の数値・文言に差し替えて failed にしている）。
   * null = not_reported（quote なし）
   */
  quote: string | null;
  page: number | null;
  confidence: Confidence | null;
  /** Evidence.anchor_status として保存する値（notReported の行は null） */
  anchorStatus: AnchorStatus | null;
  notReported: boolean;
}

const STUDY_ENTITY_KEY = '-';
const [ARM_1, ARM_2] = DEMO_ARM_KEYS;
const [OUTCOME_ARM_1, OUTCOME_ARM_2] = DEMO_OUTCOME_ENTITY_KEYS;

/**
 * 全 24 件のフィールドインスタンス（study 8 + arm 3×2 + outcome 5×2）。
 * seed.ts（事前シード済みの Evidence / StudyData / ResultsData）と llmFixtures.ts
 * （#/extract で実際に一括抽出を実行したときの Gemini 応答モック）の両方がこのテーブルを参照する
 * （brief の要請どおり二重定義しない）。
 */
export const FIELD_INSTANCES: readonly FieldInstanceContent[] = [
  // --- study level ---
  {
    fieldId: 'f_country',
    entityKey: STUDY_ENTITY_KEY,
    value: 'Iran',
    quote:
      'This randomized controlled trial was conducted in the neonatal ward of a teaching hospital in Ahvaz, Iran.',
    page: 1,
    confidence: 'high',
    anchorStatus: 'exact',
    notReported: false,
  },
  {
    fieldId: 'f_design',
    entityKey: STUDY_ENTITY_KEY,
    value: 'Randomized controlled trial (parallel-group, two-arm)',
    quote:
      'Term neonates with indirect hyperbilirubinemia were randomly allocated to receive either oral ursodeoxycholic acid plus phototherapy or phototherapy alone in this parallel-group randomized controlled trial.',
    page: 1,
    confidence: 'high',
    anchorStatus: 'exact',
    notReported: false,
  },
  {
    fieldId: 'f_enrollment_period',
    entityKey: STUDY_ENTITY_KEY,
    value: 'March 2021 to February 2022',
    quote: 'Eligible neonates were enrolled between March 2021 and February 2022.',
    page: 2,
    confidence: 'high',
    anchorStatus: 'exact',
    notReported: false,
  },
  {
    fieldId: 'f_followup_duration',
    entityKey: STUDY_ENTITY_KEY,
    value: 'Until hospital discharge (up to 7 days)',
    quote:
      'Total serum bilirubin was monitored daily until discharge, up to a maximum of seven days after enrollment.',
    page: 2,
    confidence: 'medium',
    anchorStatus: 'exact',
    notReported: false,
  },
  {
    fieldId: 'f_sample_size_total',
    entityKey: STUDY_ENTITY_KEY,
    value: '106',
    quote: 'A total of 106 term neonates completed the study and were included in the final analysis.',
    page: 2,
    confidence: 'high',
    anchorStatus: 'exact',
    notReported: false,
  },
  {
    fieldId: 'f_gestational_age',
    entityKey: STUDY_ENTITY_KEY,
    value: '38.4',
    quote: 'The mean gestational age of enrolled neonates was 38.4 (SD 1.1) weeks.',
    page: 3,
    confidence: 'high',
    anchorStatus: 'exact',
    notReported: false,
  },
  {
    // 意図的に fuzzy: quote は AI が丸めて写した "47%"（実テキストは "47.2%"）
    fieldId: 'f_female_percent',
    entityKey: STUDY_ENTITY_KEY,
    value: '47',
    quote: 'Of the 106 neonates, 50 (47%) were female.',
    page: 3,
    confidence: 'medium',
    anchorStatus: 'fuzzy',
    notReported: false,
  },
  {
    fieldId: 'f_funding_source',
    entityKey: STUDY_ENTITY_KEY,
    value: null,
    quote: null,
    page: null,
    confidence: 'low',
    anchorStatus: null,
    notReported: true,
  },
  // --- arm level: arm:1 = UDCA + phototherapy ---
  {
    fieldId: 'f_arm_name',
    entityKey: ARM_1,
    value: 'UDCA plus phototherapy group',
    quote:
      'Neonates in the intervention group received oral ursodeoxycholic acid (10 mg/kg/day, divided into two doses) in addition to conventional phototherapy.',
    page: 2,
    confidence: 'high',
    anchorStatus: 'exact',
    notReported: false,
  },
  {
    fieldId: 'f_arm_n',
    entityKey: ARM_1,
    value: '53',
    quote: 'Fifty-three neonates were randomized to the ursodeoxycholic acid plus phototherapy group.',
    page: 2,
    confidence: 'high',
    anchorStatus: 'exact',
    notReported: false,
  },
  {
    fieldId: 'f_arm_intervention',
    entityKey: ARM_1,
    value: 'Oral UDCA 10 mg/kg/day (two divided doses) plus conventional phototherapy',
    quote:
      'The UDCA dose was 10 mg/kg per day, administered orally in two divided doses, for the duration of phototherapy.',
    page: 3,
    confidence: 'high',
    anchorStatus: 'exact',
    notReported: false,
  },
  // --- arm level: arm:2 = phototherapy alone (control) ---
  {
    fieldId: 'f_arm_name',
    entityKey: ARM_2,
    value: 'Phototherapy-alone group (control)',
    quote:
      'Neonates in the control group received conventional phototherapy alone, with no additional pharmacological intervention.',
    page: 2,
    confidence: 'high',
    anchorStatus: 'exact',
    notReported: false,
  },
  {
    fieldId: 'f_arm_n',
    entityKey: ARM_2,
    value: '53',
    quote: 'The remaining fifty-three neonates were allocated to the control group receiving phototherapy alone.',
    page: 2,
    confidence: 'high',
    anchorStatus: 'exact',
    notReported: false,
  },
  {
    fieldId: 'f_arm_intervention',
    entityKey: ARM_2,
    value: 'Conventional phototherapy alone',
    quote:
      'Standard blue-light phototherapy was administered continuously except during feeding, identically in both groups.',
    page: 3,
    confidence: 'medium',
    anchorStatus: 'exact',
    notReported: false,
  },
  // --- outcome level: outcome:tsb_reduction|arm:1 ---
  {
    fieldId: 'f_outcome_name',
    entityKey: OUTCOME_ARM_1,
    value: 'Reduction in total serum bilirubin',
    quote:
      'The primary outcome was the reduction in total serum bilirubin (TSB) from enrollment to 24 hours after starting treatment.',
    page: 3,
    confidence: 'high',
    anchorStatus: 'exact',
    notReported: false,
  },
  {
    fieldId: 'f_outcome_timepoint',
    entityKey: OUTCOME_ARM_1,
    value: '24 hours after enrollment',
    quote: 'TSB levels were reassessed 24 hours after the initiation of treatment in both groups.',
    page: 3,
    confidence: 'high',
    anchorStatus: 'exact',
    notReported: false,
  },
  {
    fieldId: 'f_outcome_events',
    entityKey: OUTCOME_ARM_1,
    value: null,
    quote: null,
    page: null,
    confidence: 'low',
    anchorStatus: null,
    notReported: true,
  },
  {
    fieldId: 'f_outcome_mean_sd',
    entityKey: OUTCOME_ARM_1,
    value: '6.8 (1.4) mg/dL',
    quote: 'In the UDCA plus phototherapy group, TSB decreased by a mean of 6.8 (SD 1.4) mg/dL at 24 hours.',
    page: 4,
    confidence: 'high',
    anchorStatus: 'exact',
    notReported: false,
  },
  {
    // 意図的に failed: 実テキスト（page 4）とは異なる数値・文言の quote を保存している
    // （第9章「quote 再配置（relocate-quote）」の実演用。requirements.md §5）
    fieldId: 'f_outcome_effect_size',
    entityKey: OUTCOME_ARM_1,
    value: 'Mean difference -1.9 mg/dL (95% CI -2.6 to -1.2)',
    quote: 'Mean difference -3.4 mg/dL (95% CI -4.1 to -2.7), P=0.002',
    page: 4,
    confidence: 'low',
    anchorStatus: 'failed',
    notReported: false,
  },
  // --- outcome level: outcome:tsb_reduction|arm:2 ---
  {
    fieldId: 'f_outcome_name',
    entityKey: OUTCOME_ARM_2,
    value: 'Reduction in total serum bilirubin',
    quote:
      'The primary outcome was the reduction in total serum bilirubin (TSB) from enrollment to 24 hours after starting treatment.',
    page: 3,
    confidence: 'high',
    anchorStatus: 'exact',
    notReported: false,
  },
  {
    fieldId: 'f_outcome_timepoint',
    entityKey: OUTCOME_ARM_2,
    value: '24 hours after enrollment',
    quote: 'TSB levels were reassessed 24 hours after the initiation of treatment in both groups.',
    page: 3,
    confidence: 'high',
    anchorStatus: 'exact',
    notReported: false,
  },
  {
    fieldId: 'f_outcome_events',
    entityKey: OUTCOME_ARM_2,
    value: null,
    quote: null,
    page: null,
    confidence: 'low',
    anchorStatus: null,
    notReported: true,
  },
  {
    fieldId: 'f_outcome_mean_sd',
    entityKey: OUTCOME_ARM_2,
    value: '4.9 (1.6) mg/dL',
    quote: 'In the phototherapy-alone group, the mean TSB reduction at 24 hours was 4.9 (SD 1.6) mg/dL.',
    page: 4,
    confidence: 'high',
    anchorStatus: 'exact',
    notReported: false,
  },
  {
    fieldId: 'f_outcome_effect_size',
    entityKey: OUTCOME_ARM_2,
    value: null,
    quote: null,
    page: null,
    confidence: 'low',
    anchorStatus: null,
    notReported: true,
  },
];
