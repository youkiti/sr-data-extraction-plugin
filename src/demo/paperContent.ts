// デモ論文 3 本（paperData.mjs）から、Evidence / StudyData / ResultsData の元になる
// FieldInstanceContent（値・quote・page・confidence・anchor_status）を組み立てる。
//
// 【単一の正典】本文の文章は paperData.mjs に定義した 1 か所だけに書かれている。
// ここでは基本的にその文章をそのまま quote として使う（= exact 一致になる）。
// 唯一の例外が anchor_status を意図的に fuzzy / failed にする 2 件（下記コメント参照）で、
// そこだけ paperData.mjs の正しい文章とは異なる文字列を quote として保存する
// （video/fixtures/demo-paper-0N.html / .pdf の本文は常に paperData.mjs の正しい文章のまま
// 生成されるため、この 2 件は「PDF の実テキストとは一致しない quote」を意図的に作れる）。
// この 2 件はどちらもデモ論文 1（paper1）限定（アンカリング §5 の段階的マッチングの実演用）。
// デモ論文 2・3 は常に exact になる
import type { AnchorStatus } from '../domain/anchor';
import type { Confidence } from '../domain/evidence';
import {
  PAPER1,
  PAPER2,
  PAPER3,
  DISCUSSION_TEXT,
  CONCLUSION_TEXT,
  referenceEntry,
  type PaperDefinition,
} from './paperData.mjs';

/** デモ論文の書誌情報（Documents タブ用） */
export interface DemoPaperMeta {
  filename: string;
  title: string;
  doi: string;
  pmid: string | null;
}

export interface FieldInstanceContent {
  fieldId: string;
  entityKey: string;
  /** AI が抽出した原本の値。null = not_reported */
  value: string | null;
  /** Evidence.quote として保存する文字列。null = not_reported（quote なし） */
  quote: string | null;
  page: number | null;
  confidence: Confidence | null;
  /** Evidence.anchor_status として保存する値（notReported の行は null） */
  anchorStatus: AnchorStatus | null;
  notReported: boolean;
}

const STUDY_ENTITY_KEY = '-';

/** value === null のときだけ not_reported の行にする（quote 等も合わせて null にする） */
function reportedInstance(
  fieldId: string,
  entityKey: string,
  value: string | null,
  quote: string | null,
  page: number | null,
  confidence: Confidence,
  anchorStatus: AnchorStatus,
): FieldInstanceContent {
  if (value === null) {
    return {
      fieldId,
      entityKey,
      value: null,
      quote: null,
      page: null,
      confidence: 'low',
      anchorStatus: null,
      notReported: true,
    };
  }
  return { fieldId, entityKey, value, quote, page, confidence, anchorStatus, notReported: false };
}

/**
 * 1 論文ぶんの PAGE_TEXTS（ページ別本文）+ FIELD_INSTANCES（study 8 + arm 3×N +
 * outcome_result 5×N 件。N = 群数。2 群論文〔paper1・paper3〕は 24 件、3 群論文
 * 〔paper2〕は 32 件）を組み立てる。ページ番号（下記 P1〜P6）は
 * video/fixtures/build-fixtures.mjs が生成する HTML の明示的な改ページ位置と 1 対 1 で
 * 対応させている（build-fixtures.mjs 側のページ分割コメント参照。ここを変える場合は
 * 両方合わせて直すこと）
 */
function buildPaperInstances(paper: PaperDefinition): {
  meta: DemoPaperMeta;
  pageTexts: readonly string[];
  fieldInstances: readonly FieldInstanceContent[];
} {
  const P1 = 1; // Title / Abstract / Introduction
  const P2 = 2; // Methods: enrollment / follow-up / N / arm 名称・N（先頭 2 群ぶん）
  const P3 = 3; // Methods 続き: 3 群目の名称・N（あれば）+ 全群の介入内容
  const P4 = 4; // Methods 続き: 年齢・性別 + Table 1 + Outcomes 定義
  const P5 = 5; // Results: アウトカム値・効果量 + アウトカム表
  // P6（Discussion/Conclusion/References）は quote の出所にならないため未使用

  const items: FieldInstanceContent[] = [];

  // --- study level ---
  items.push(
    reportedInstance('f_country', STUDY_ENTITY_KEY, paper.facts.country.value, paper.facts.country.sentence, P1, 'high', 'exact'),
    reportedInstance('f_design', STUDY_ENTITY_KEY, paper.facts.design.value, paper.facts.design.sentence, P1, 'high', 'exact'),
    reportedInstance(
      'f_enrollment_period',
      STUDY_ENTITY_KEY,
      paper.facts.enrollmentPeriod.value,
      paper.facts.enrollmentPeriod.sentence,
      P2,
      'high',
      'exact',
    ),
    reportedInstance(
      'f_followup_duration',
      STUDY_ENTITY_KEY,
      paper.facts.followupDuration.value,
      paper.facts.followupDuration.sentence,
      P2,
      'medium',
      'exact',
    ),
    reportedInstance(
      'f_sample_size_total',
      STUDY_ENTITY_KEY,
      paper.facts.sampleSizeTotal.value,
      paper.facts.sampleSizeTotal.sentence,
      P2,
      'high',
      'exact',
    ),
    reportedInstance('f_mean_age', STUDY_ENTITY_KEY, paper.facts.meanAge.value, paper.facts.meanAge.sentence, P4, 'high', 'exact'),
    // 意図的に fuzzy: quote は AI が丸めて写した値（本文は正確な値のまま。paperData.mjs 参照）
    reportedInstance(
      'f_female_percent',
      STUDY_ENTITY_KEY,
      paper.facts.femalePercent.value,
      paper.id === 'paper1'
        ? 'Of the 112 patients, 48 (43%) were female.' // 実文章は "43.4%"（丸め違いで fuzzy）
        : paper.facts.femalePercent.sentence,
      P4,
      'medium',
      paper.id === 'paper1' ? 'fuzzy' : 'exact',
    ),
    reportedInstance('f_funding_source', STUDY_ENTITY_KEY, paper.facts.fundingSource.value, null, null, 'low', 'exact'),
  );

  // --- arm level（群数ぶん） ---
  // 3 群目以降は Methods 続き（P3）に書く（build-fixtures.mjs のページ割りと対応）
  paper.arms.forEach((armFact, index) => {
    const namePage = index < 2 ? P2 : P3;
    const nPage = index < 2 ? P2 : P3;
    items.push(
      reportedInstance('f_arm_name', armFact.key, armFact.name, armFact.nameSentence, namePage, 'high', 'exact'),
      reportedInstance('f_arm_n', armFact.key, armFact.n, armFact.nSentence, nPage, 'high', 'exact'),
      reportedInstance(
        'f_arm_intervention',
        armFact.key,
        armFact.interventionValue,
        armFact.interventionSentence,
        P3,
        index === 0 ? 'high' : 'medium',
        'exact',
      ),
    );
  });

  // --- outcome_result level（群数ぶん） ---
  paper.outcome.perArm.forEach((outcomeArmFact) => {
    const entityKey = `outcome:${paper.outcome.slug}|${outcomeArmFact.armKey}`;
    const isArm1 = outcomeArmFact.armKey === 'arm:1';
    items.push(
      reportedInstance('f_outcome_name', entityKey, paper.outcome.name.value, paper.outcome.name.sentence, P4, 'high', 'exact'),
      reportedInstance(
        'f_outcome_timepoint',
        entityKey,
        paper.outcome.timepoint.value,
        paper.outcome.timepoint.sentence,
        P4,
        'high',
        'exact',
      ),
      reportedInstance('f_outcome_events', entityKey, outcomeArmFact.events.value, outcomeArmFact.events.sentence, P5, 'high', 'exact'),
      reportedInstance(
        'f_outcome_mean_sd',
        entityKey,
        outcomeArmFact.meanSd.value,
        outcomeArmFact.meanSd.sentence,
        P5,
        'high',
        'exact',
      ),
      // 意図的に failed: paper1 の arm:1 だけ、本文と一致しない quote を保存する
      // （§5「quote 再配置（relocate-quote）」の実演用。requirements.md §5）
      reportedInstance(
        'f_outcome_effect_size',
        entityKey,
        outcomeArmFact.effectSize.value,
        paper.id === 'paper1' && isArm1
          ? 'Mean difference 33.2 m (95% CI 25.0 to 41.4), P=0.004' // 本文中のどこにも一致しない
          : outcomeArmFact.effectSize.sentence,
        outcomeArmFact.effectSize.value === null ? null : P5,
        outcomeArmFact.effectSize.value === null ? 'low' : 'low',
        paper.id === 'paper1' && isArm1 ? 'failed' : 'exact',
      ),
    );
  });

  const pageTexts = buildPageTexts(paper);

  return {
    meta: { filename: paper.filename, title: paper.title, doi: paper.doi, pmid: null },
    pageTexts,
    fieldInstances: items,
  };
}

/**
 * extracted_texts 相当のページ別本文（fetchMock.ts の Drive テキスト取得・#/extract の
 * 一括抽出プロンプトの両方が参照する）。build-fixtures.mjs の HTML 生成と同じ文章・同じ
 * ページ割りにする（このモジュール冒頭コメント参照）。
 * 6 ページ目（Discussion/Conclusion/References）は quote の出所にならないが、実 PDF の
 * ページ数（6）と extracted_texts のページ数を一致させるため含めている
 */
function buildPageTexts(paper: PaperDefinition): string[] {
  const armNamesAndN = paper.arms.map((a) => `${a.nameSentence} ${a.nSentence}`);
  const armInterventions = paper.arms.map((a) => a.interventionSentence);
  const outcomeEvents = paper.outcome.perArm
    .map((a) => a.events.sentence)
    .filter((s): s is string => s !== null);
  const outcomeMeanSd = paper.outcome.perArm
    .map((a) => a.meanSd.sentence)
    .filter((s): s is string => s !== null);
  const outcomeEffectSizes = paper.outcome.perArm
    .map((a) => a.effectSize.sentence)
    .filter((s): s is string => s !== null);

  return [
    // page 1: Title / Abstract / Introduction
    [paper.title, paper.abstract, paper.facts.country.sentence, paper.facts.design.sentence].join('\n\n'),
    // page 2: Methods（登録・追跡・症例数 + 先頭 2 群の名称・N）
    [
      'Methods',
      paper.facts.enrollmentPeriod.sentence,
      paper.facts.followupDuration.sentence,
      paper.facts.sampleSizeTotal.sentence,
      ...armNamesAndN.slice(0, 2),
    ].join('\n\n'),
    // page 3: Methods 続き（3 群目以降の名称・N + 全群の介入内容）
    [...armNamesAndN.slice(2), ...armInterventions].join('\n\n'),
    // page 4: Methods 続き（年齢・性別）+ Outcomes 定義
    [
      paper.facts.meanAge.sentence,
      paper.facts.femalePercent.sentence,
      'Outcomes',
      paper.outcome.name.sentence,
      paper.outcome.timepoint.sentence,
    ].join('\n\n'),
    // page 5: Results（アウトカム値・効果量）
    ['Results', ...outcomeEvents, ...outcomeMeanSd, ...outcomeEffectSizes].join('\n\n'),
    // page 6: Discussion / Conclusion / References
    ['Discussion', DISCUSSION_TEXT, 'Conclusion', CONCLUSION_TEXT, 'References', referenceEntry(paper)].join('\n\n'),
  ];
}

const PAPER1_BUILT = buildPaperInstances(PAPER1);
const PAPER2_BUILT = buildPaperInstances(PAPER2);
const PAPER3_BUILT = buildPaperInstances(PAPER3);

/** デモ論文ごとの、書誌情報・本文・FIELD_INSTANCES 一式（Documents / #/extract 順 = 配列順） */
export const DEMO_PAPERS: readonly {
  paperId: string;
  meta: DemoPaperMeta;
  pageTexts: readonly string[];
  fieldInstances: readonly FieldInstanceContent[];
}[] = [
  { paperId: PAPER1.id, meta: PAPER1_BUILT.meta, pageTexts: PAPER1_BUILT.pageTexts, fieldInstances: PAPER1_BUILT.fieldInstances },
  { paperId: PAPER2.id, meta: PAPER2_BUILT.meta, pageTexts: PAPER2_BUILT.pageTexts, fieldInstances: PAPER2_BUILT.fieldInstances },
  { paperId: PAPER3.id, meta: PAPER3_BUILT.meta, pageTexts: PAPER3_BUILT.pageTexts, fieldInstances: PAPER3_BUILT.fieldInstances },
];

/**
 * relocate-quote skill（llmFixtures.ts）専用: anchor_status を意図的に 'failed' にした
 * 各項目について、本文（pageTexts）に実在する正しい quote と、それが載っているページを
 * 対応づける。上の buildPaperInstances 内のコメント「意図的に failed 用の素材」の対になる表で、
 * FIELD_INSTANCES 側は本文と一致しない quote を保持しているため、正しい quote はここから引く。
 * 現状デモ全体で該当は 1 件（デモ論文 1・outcome:six_minute_walk|arm:1・f_outcome_effect_size）
 */
export interface DemoFailedQuoteCorrection {
  paperId: string;
  fieldId: string;
  entityKey: string;
  /** 本文に実在する正しい quote（paperData.mjs の sentence をそのまま使う） */
  correctQuote: string;
  page: number;
}

const PAPER1_ARM1_OUTCOME = PAPER1.outcome.perArm.find((a) => a.armKey === 'arm:1');
if (PAPER1_ARM1_OUTCOME === undefined || PAPER1_ARM1_OUTCOME.effectSize.sentence === null) {
  // デモ fixture の前提が崩れている（paperData.mjs の構成変更等）ことを起動時に検知するための防御
  throw new Error('デモ論文1 の arm:1 に effect_size の本文（sentence）が見つかりません');
}

export const DEMO_FAILED_QUOTE_CORRECTIONS: readonly DemoFailedQuoteCorrection[] = [
  {
    paperId: PAPER1.id,
    fieldId: 'f_outcome_effect_size',
    entityKey: `outcome:${PAPER1.outcome.slug}|arm:1`,
    correctQuote: PAPER1_ARM1_OUTCOME.effectSize.sentence,
    page: 5,
  },
];
