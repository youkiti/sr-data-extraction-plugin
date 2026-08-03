// デモ論文 3 本ぶんの「事実（facts）」の唯一の正典。
//
// 【設計方針・重要】以前の実装は実在論文（PLoS ONE 2023, Zarkesh et al.）の書誌情報を
// Documents タブに表示しつつ、本文・quote・抽出値は独自の作文だった。これは
// (1) 実在の著者の論文に架空の抽出値が紐づいた画面が動画に映る、
// (2) 実ネットワーク環境で実 PDF を取得すると quote が本文と一致せず検証画面の
//     ハイライトが壊れる、という 2 つの問題があったため不採用にした。
// 本ファイルは完全に架空の臨床 RCT 論文 3 本（デモ論文 1 = 2 群、デモ論文 2 = 3 群、
// デモ論文 3 = 2 群）の事実（国・症例数・群構成・アウトカム値など）と、
// そこから機械的に組み立てた文章を持つ。
//
// 【study ごとの役割分担（PR2 最終ラウンド）】3 本は同じ「周術期の介入」という SR プロジェクトの
// 中で、それぞれ別の画面を実演する役割を持つ（詳細は各論文の定義直前のコメント参照）:
// - デモ論文 1（PAPER1）: 独立二重レビュー完了 + 裁定 → 裁定画面・κ 一致度レポートの実演用。
//   owner（ログインユーザー）自身の判定行は持たない
// - デモ論文 2（PAPER2）: 取り込みのみで未抽出 → #/extract のライブ抽出・群構成確定ゲートの実演用
// - デモ論文 3（PAPER3）: owner が単独で途中まで検証済み → ダッシュボード（進捗マトリクス・
//   AI 採用率・AI 精度内訳）とエクスポートの未検証セル警告の実演用（seed.ts 参照）
//
// 【単一の正典であることの意味】ここに定義した「文章（sentence）」は、
// - video/fixtures/build-fixtures.mjs が HTML フィクスチャ（→ PDF）を生成するときの本文と、
// - src/demo/paperContent.ts が Evidence.quote として保存する文字列
// の両方に**そのまま**使われる。文章を 2 箇所で別々にタイプしないことで、
// 「HTML の本文と quote がずれる」設計上の欠陥そのものを無くしている
// （anchor_status を意図的に fuzzy/failed にする 2 件だけは、paperContent.ts 側で
// ここの正しい文章から意図的に少し崩した文字列を別途組み立てる。当該箇所のコメント参照）。
//
// プレーン ESM（.mjs）にしているのは、本ファイルが 2 つの全く別の実行系（webpack が
// バンドルする TypeScript 側の src/demo/paperContent.ts と、素の Node で動く
// video/fixtures/build-fixtures.mjs）の両方から import されるため。TypeScript 化すると
// build-fixtures.mjs 側で ts-node 等のトランスパイル層が必要になり本質的でない複雑さが
// 増えるため、型は同居する paperData.d.mts（手書きの宣言ファイル）で与える。

/** 1 群ぶんの事実 */
function arm(key, name, n, nameSentence, nSentence, interventionValue, interventionSentence) {
  return { key, name, n, nameSentence, nSentence, interventionValue, interventionSentence };
}

/** outcome_result の 1 群ぶんの事実（events / meanSd / effectSize は not_reported なら null） */
function outcomeArm(armKey, events, meanSd, effectSize) {
  return { armKey, events, meanSd, effectSize };
}

/** value（セル素の値）+ sentence（本文に載せる、そのまま quote にもなる文）の組 */
function fact(value, sentence) {
  return { value, sentence };
}

// ============================================================================
// デモ論文 1（2 群）: 腹部手術後の早期離床プログラム
// ============================================================================

const PAPER1_ARMS = [
  arm(
    'arm:1',
    'Structured Early Mobilization Program group',
    '56',
    'Patients in the intervention group received a structured early mobilization program in addition to standard postoperative care.',
    'Fifty-six patients were randomized to the early mobilization program group.',
    'Supervised out-of-bed mobilization within 6 hours postoperatively, followed by a progressive ambulation protocol three times daily',
    'The early mobilization protocol required supervised out-of-bed mobilization within 6 hours after surgery, followed by progressive ambulation sessions three times daily until discharge.',
  ),
  arm(
    'arm:2',
    'Standard Postoperative Care group (control)',
    '56',
    'Patients in the control group received standard postoperative care, with mobilization timing left to the discretion of the ward team.',
    'The remaining fifty-six patients were allocated to the standard postoperative care group.',
    'Standard postoperative care without a structured mobilization protocol',
    'Standard care included routine nursing observation and analgesia, without a structured mobilization protocol.',
  ),
];

export const PAPER1 = {
  id: 'paper1',
  filename: 'demo-paper-01.pdf',
  title:
    'Effect of a Structured Early Mobilization Program on Postoperative Recovery after Elective Abdominal Surgery: A Two-Arm Randomized Controlled Trial',
  journal: 'Journal of Perioperative Rehabilitation Trials (SR-DEP Demo Fixture)',
  authors: 'Halvorsen K, Petrenko I, Okonkwo A, et al.',
  year: 2026,
  volumeInfo: 'J Perioper Rehabil Trials (Demo Fixture). 2026;3(2):71-79.',
  doi: '10.9999/jprt.2026.0142',
  disclaimerJa:
    '本稿は SR Data Extraction Plugin のデモ用に作成した架空のサンプル論文であり、実在の研究ではない。',
  abstract:
    'Early mobilization after abdominal surgery may accelerate functional recovery, but evidence from adequately powered trials is limited. ' +
    'We randomly allocated 112 adults undergoing elective abdominal surgery to a structured early mobilization program or standard postoperative care. ' +
    'The early mobilization group showed a significantly larger increase in Six-Minute Walk Test distance by postoperative day 5. ' +
    'No serious adverse events attributable to the mobilization protocol were observed.',
  facts: {
    country: fact(
      'Portugal',
      'This randomized controlled trial was conducted in the general surgery ward of a tertiary referral hospital in Portugal.',
    ),
    design: fact(
      'Randomized controlled trial (parallel-group, two-arm)',
      'Patients scheduled for elective abdominal surgery were randomly allocated to receive either a structured early mobilization program or standard postoperative care in this parallel-group, two-arm randomized controlled trial.',
    ),
    enrollmentPeriod: fact(
      'April 2025 to March 2026',
      'Eligible patients were enrolled between April 2025 and March 2026.',
    ),
    followupDuration: fact(
      'Until postoperative day 7 or hospital discharge, whichever came first',
      'Patients were followed until postoperative day 7 or hospital discharge, whichever occurred first.',
    ),
    sampleSizeTotal: fact(
      '112',
      'A total of 112 patients completed the study and were included in the final analysis.',
    ),
    meanAge: fact('58.6', 'The mean age of enrolled patients was 58.6 (SD 9.2) years.'),
    // 意図的に fuzzy 用の素材: 本文（実際の文章）は "43.4%"。quote 側（paperContent.ts）は
    // AI が丸めて写した "43%" にする。本文そのものは常に正確な値を書く
    femalePercent: fact('43', 'Of the 112 patients, 48 (43.4%) were female.'),
    fundingSource: fact(null, null), // not_reported
  },
  arms: PAPER1_ARMS,
  outcome: {
    slug: 'six_minute_walk',
    name: fact(
      'Six-Minute Walk Test (6MWT) distance',
      'The primary outcome was the change in Six-Minute Walk Test (6MWT) distance from baseline to postoperative day 5.',
    ),
    timepoint: fact(
      'Postoperative day 5',
      '6MWT distance was reassessed on postoperative day 5 in both groups.',
    ),
    perArm: [
      outcomeArm(
        'arm:1',
        fact(null, null), // 連続値アウトカムのためイベント数は not_reported
        fact(
          '62.4 (14.1) m',
          'In the early mobilization group, 6MWT distance increased by a mean of 62.4 (SD 14.1) meters by postoperative day 5.',
        ),
        // 意図的に failed 用の素材: 本文（実際の文章）はここの correctSentence。
        // quote 側（paperContent.ts）は数値も文言も異なる文字列を保存し、本文中のどこにも
        // 一致しない状態を作る（§5 の「quote 再配置（relocate-quote）」の実演用）
        fact(
          'Mean difference 20.7 m (95% CI 14.9 to 26.5, P<0.001)',
          'The between-group mean difference in 6MWT distance change was 20.7 m (95% CI 14.9 to 26.5), favoring the early mobilization group (P<0.001).',
        ),
      ),
      outcomeArm(
        'arm:2',
        fact(null, null), // 連続値アウトカムのためイベント数は not_reported
        fact(
          '41.7 (15.8) m',
          'In the standard care group, the mean increase in 6MWT distance was 41.7 (SD 15.8) meters.',
        ),
        fact(null, null), // 対照群側の effect_size は not_reported（比較の基準のため）
      ),
    ],
  },
};

// ============================================================================
// デモ論文 2（3 群）: 術後悪心・嘔吐(PONV)予防薬 NX-214 の用量比較試験
// ============================================================================

const PAPER2_ARMS = [
  arm(
    'arm:1',
    'NX-214 Low Dose (0.5 mg/kg) group',
    '60',
    'Patients in the first intervention group received the investigational agent NX-214 at a low dose (0.5 mg/kg) in addition to standard antiemetic prophylaxis.',
    'Sixty patients were randomized to the NX-214 low-dose group.',
    'Intravenous NX-214 0.5 mg/kg at induction of anesthesia plus standard antiemetic prophylaxis',
    'The low-dose regimen consisted of a single intravenous dose of NX-214 0.5 mg/kg administered at induction of anesthesia, in addition to standard antiemetic prophylaxis.',
  ),
  arm(
    'arm:2',
    'NX-214 High Dose (1.0 mg/kg) group',
    '60',
    'Patients in the second intervention group received the investigational agent NX-214 at a high dose (1.0 mg/kg) in addition to standard antiemetic prophylaxis.',
    'A further sixty patients were randomized to the NX-214 high-dose group.',
    'Intravenous NX-214 1.0 mg/kg at induction of anesthesia plus standard antiemetic prophylaxis',
    'The high-dose regimen consisted of a single intravenous dose of NX-214 1.0 mg/kg administered at induction of anesthesia, in addition to standard antiemetic prophylaxis.',
  ),
  arm(
    'arm:3',
    'Placebo group (control)',
    '60',
    'Patients in the control group received matching placebo in addition to standard antiemetic prophylaxis.',
    'The remaining sixty patients were allocated to the placebo group.',
    'Matching placebo administered at induction of anesthesia plus standard antiemetic prophylaxis',
    'The placebo regimen consisted of a matching volume of saline administered at induction of anesthesia, in addition to standard antiemetic prophylaxis.',
  ),
];

export const PAPER2 = {
  id: 'paper2',
  filename: 'demo-paper-02.pdf',
  title:
    'Three-Arm, Placebo-Controlled, Dose-Ranging Trial of NX-214 for Prevention of Postoperative Nausea and Vomiting after Laparoscopic Cholecystectomy',
  journal: 'Journal of Anesthesia and Perioperative Outcomes (SR-DEP Demo Fixture)',
  authors: 'Bergstrom L, Nakashima Y, Adeyemi O, et al.',
  year: 2026,
  volumeInfo: 'J Anesth Periop Outcomes (Demo Fixture). 2026;5(1):14-24.',
  doi: '10.9999/japo.2026.0087',
  disclaimerJa:
    '本稿は SR Data Extraction Plugin のデモ用に作成した架空のサンプル論文であり、実在の研究ではない。',
  abstract:
    'Postoperative nausea and vomiting (PONV) remains common after laparoscopic surgery despite standard prophylaxis. ' +
    'We randomly allocated 180 adults undergoing laparoscopic cholecystectomy to low-dose NX-214, high-dose NX-214, or placebo, each added to standard antiemetic prophylaxis. ' +
    'Both NX-214 doses reduced the incidence of PONV within 24 hours compared with placebo, with a larger reduction at the high dose.',
  facts: {
    country: fact(
      'Chile',
      'This randomized controlled trial was conducted in the surgical department of a university-affiliated hospital in Chile.',
    ),
    design: fact(
      'Randomized controlled trial (parallel-group, three-arm, placebo-controlled)',
      'Adult patients scheduled for elective laparoscopic cholecystectomy were randomly allocated to one of three parallel groups in this placebo-controlled, three-arm randomized controlled trial.',
    ),
    enrollmentPeriod: fact(
      'January 2025 to December 2025',
      'Eligible patients were enrolled between January 2025 and December 2025.',
    ),
    followupDuration: fact(
      'Until 24 hours after surgery',
      'Patients were monitored for postoperative nausea and vomiting until 24 hours after surgery.',
    ),
    sampleSizeTotal: fact(
      '180',
      'A total of 180 patients completed the study and were included in the final analysis.',
    ),
    meanAge: fact('45.2', 'The mean age of enrolled patients was 45.2 (SD 11.4) years.'),
    femalePercent: fact('68', 'Of the 180 patients, 122 (68%) were female.'),
    fundingSource: fact(null, null), // not_reported
  },
  arms: PAPER2_ARMS,
  outcome: {
    slug: 'ponv_incidence',
    name: fact(
      'Incidence of postoperative nausea and vomiting (PONV)',
      'The primary outcome was the incidence of postoperative nausea and vomiting (PONV) within 24 hours after surgery.',
    ),
    timepoint: fact(
      'Within 24 hours postoperatively',
      'PONV events were recorded within 24 hours after surgery in all three groups.',
    ),
    perArm: [
      outcomeArm(
        'arm:1',
        fact('12/60', 'In the NX-214 low-dose group, PONV occurred in 12 of 60 patients (20.0%).'),
        fact(null, null),
        fact(
          'Risk ratio 0.44 (95% CI 0.25 to 0.79) vs placebo',
          'Compared with placebo, the low-dose group had a risk ratio of 0.44 (95% CI 0.25 to 0.79) for PONV.',
        ),
      ),
      outcomeArm(
        'arm:2',
        fact('8/60', 'In the NX-214 high-dose group, PONV occurred in 8 of 60 patients (13.3%).'),
        fact(null, null),
        fact(
          'Risk ratio 0.30 (95% CI 0.15 to 0.58) vs placebo',
          'Compared with placebo, the high-dose group had a risk ratio of 0.30 (95% CI 0.15 to 0.58) for PONV.',
        ),
      ),
      outcomeArm(
        'arm:3',
        fact('27/60', 'In the placebo group, PONV occurred in 27 of 60 patients (45.0%).'),
        fact(null, null),
        fact(null, null), // 参照群（プラセボ）の effect_size は not_reported
      ),
    ],
  },
};

// ============================================================================
// デモ論文 3（2 群）: 心臓手術前の呼吸筋トレーニングによる術後在院日数への効果
// ============================================================================
//
// デモ論文 1（早期離床）と同系統の「周術期リハビリテーション」テーマにして、
// 3 study が同じ SR プロジェクト（周術期の介入レビュー）として辻褄が合うようにしている。
// アウトカムは連続値（術後在院日数）にし、デモ論文 1 と同じ「二値アウトカムのイベント数は
// not_reported」の形を踏襲する（seed.ts が owner の判定内訳を組み立てるときの土台）

const PAPER3_ARMS = [
  arm(
    'arm:1',
    'Preoperative Inspiratory Muscle Training group',
    '48',
    'Patients in the intervention group received a 2-week preoperative inspiratory muscle training program in addition to standard preoperative care.',
    'Forty-eight patients were randomized to the inspiratory muscle training group.',
    'Supervised threshold-loaded inspiratory muscle training for 30 minutes daily for 2 weeks before surgery, in addition to standard preoperative care',
    'The inspiratory muscle training protocol consisted of supervised threshold-loaded breathing exercises for 30 minutes daily for 2 weeks before surgery, in addition to standard preoperative care.',
  ),
  arm(
    'arm:2',
    'Standard Preoperative Care group (control)',
    '48',
    'Patients in the control group received standard preoperative care without a structured respiratory training protocol.',
    'The remaining forty-eight patients were allocated to the standard preoperative care group.',
    'Standard preoperative care without a structured respiratory training protocol',
    'Standard preoperative care included routine preoperative counselling and analgesia planning, without a structured respiratory training protocol.',
  ),
];

export const PAPER3 = {
  id: 'paper3',
  filename: 'demo-paper-03.pdf',
  title:
    'Effect of Preoperative Inspiratory Muscle Training on Postoperative Length of Hospital Stay after Elective Cardiac Surgery: A Two-Arm Randomized Controlled Trial',
  journal: 'International Journal of Perioperative Physiotherapy (SR-DEP Demo Fixture)',
  authors: 'Moreau C, Takahashi R, Osei-Bonsu K, et al.',
  year: 2026,
  volumeInfo: 'Int J Periop Physiother (Demo Fixture). 2026;2(4):101-109.',
  doi: '10.9999/ijpp.2026.0019',
  disclaimerJa:
    '本稿は SR Data Extraction Plugin のデモ用に作成した架空のサンプル論文であり、実在の研究ではない。',
  abstract:
    'Preoperative inspiratory muscle training (IMT) may reduce postoperative pulmonary complications after cardiac surgery, but its effect on length of hospital stay is less well characterized. ' +
    'We randomly allocated 96 adults undergoing elective cardiac surgery to a 2-week preoperative IMT program or standard preoperative care. ' +
    'The IMT group had a significantly shorter postoperative length of hospital stay. ' +
    'No serious adverse events attributable to the training protocol were observed.',
  facts: {
    country: fact(
      'Belgium',
      'This randomized controlled trial was conducted in the cardiothoracic surgery department of a university hospital in Belgium.',
    ),
    design: fact(
      'Randomized controlled trial (parallel-group, two-arm)',
      'Adult patients scheduled for elective cardiac surgery were randomly allocated to receive either a preoperative inspiratory muscle training program or standard preoperative care in this parallel-group, two-arm randomized controlled trial.',
    ),
    enrollmentPeriod: fact(
      'June 2025 to May 2026',
      'Eligible patients were enrolled between June 2025 and May 2026.',
    ),
    followupDuration: fact(
      'Until postoperative day 10 or hospital discharge, whichever came first',
      'Patients were followed until postoperative day 10 or hospital discharge, whichever occurred first.',
    ),
    sampleSizeTotal: fact(
      '96',
      'A total of 96 patients completed the study and were included in the final analysis.',
    ),
    meanAge: fact('61.3', 'The mean age of enrolled patients was 61.3 (SD 8.4) years.'),
    femalePercent: fact('35', 'Of the 96 patients, 34 (35.4%) were female.'),
    fundingSource: fact(null, null), // not_reported
  },
  arms: PAPER3_ARMS,
  outcome: {
    slug: 'postop_los',
    name: fact(
      'Postoperative length of hospital stay',
      'The primary outcome was the postoperative length of hospital stay, measured in days from surgery to discharge.',
    ),
    timepoint: fact(
      'At hospital discharge',
      'Length of stay was assessed at hospital discharge in both groups.',
    ),
    perArm: [
      outcomeArm(
        'arm:1',
        fact(null, null), // 連続値アウトカムのためイベント数は not_reported
        fact(
          '6.2 (1.8) days',
          'In the inspiratory muscle training group, the mean postoperative length of hospital stay was 6.2 (SD 1.8) days.',
        ),
        fact(
          'Mean difference -1.4 days (95% CI -2.3 to -0.5, P=0.003)',
          'The between-group mean difference in postoperative length of hospital stay was -1.4 days (95% CI -2.3 to -0.5), favoring the inspiratory muscle training group (P=0.003).',
        ),
      ),
      outcomeArm(
        'arm:2',
        fact(null, null), // 連続値アウトカムのためイベント数は not_reported
        fact(
          '7.6 (2.1) days',
          'In the standard care group, the mean postoperative length of hospital stay was 7.6 (SD 2.1) days.',
        ),
        fact(null, null), // 対照群側の effect_size は not_reported（比較の基準のため）
      ),
    ],
  },
};

/** 3 論文（配列順 = document_index の既定順）。デモの唯一の正典としてここから全体を辿れる */
export const PAPERS = [PAPER1, PAPER2, PAPER3];

// ============================================================================
// Discussion / Conclusion / References（quote の出所にはならない flavor 文）
// ============================================================================
//
// 6 ページ目（P6）の本文。build-fixtures.mjs の HTML 生成と paperContent.ts の
// PAGE_TEXTS（抽出済みテキストのページ 6）の両方がここを参照する。quote の対象では
// ないため FIELD_INSTANCES を持たないが、実 PDF のページ数（6）と extracted_texts の
// ページ数を一致させるため、両者が同じ文章を使う

export const DISCUSSION_TEXT =
  "This synthetic trial is provided solely as a fixture for demonstrating the SR Data Extraction Plugin's verification workflow. The narrative above intentionally mirrors the structure of a real clinical trial report (Background, Methods, Results) but reports no real-world findings.";

export const CONCLUSION_TEXT =
  "No clinical conclusions should be drawn from this document; it exists only to exercise the extension's PDF import, extraction, and verification screens.";

/** References セクションの 1 件目（journal/year は論文ごとに異なる） */
export function referenceEntry(paper) {
  return `Demo Fixture Group. Methodological considerations for systematic review data extraction tooling. ${paper.journal}. ${paper.year}.`;
}
