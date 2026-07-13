// RoB 2（Cochrane risk-of-bias tool for randomized trials）の signaling question（SQ）回答から
// ドメイン別判定・overall 判定を機械的に導出する純ロジック層（issue #61 PR1）。
//
// --- 出典 -----------------------------------------------------------------
// signaling question の文言・条件付き質問の発火規則・ドメイン別アルゴリズム（決定木）・
// overall の統合規則は、いずれも Sterne JAC et al. "RoB 2: a revised tool for assessing risk
// of bias in randomised trials." BMJ 2019;366:l4898 の付随ガイダンス（Cochrane, RoB 2
// guidance, 2019）に基づく。
//
// 実装当時（issue #61 PR1）は outbound egress 制限により一次資料（riskofbias.info の公式配布
// PDF・BMJ 誌本体等）へ直接アクセスできなかったため、上記 BMJ 論文を明示的な典拠として
// docstring に引用しているサードパーティの OSS 実装
// （GitHub: rob-luke/risk-of-bias。取得日 2026-07-12 の main ブランチ）
//   - risk_of_bias/frameworks/rob2/domains/_domain_1_randomization.py の _compute_judgement
//   - risk_of_bias/frameworks/rob2/domains/_domain_2_deviations.py の _compute_judgement
//   - risk_of_bias/frameworks/rob2/domains/_domain_3_missing.py の _compute_judgement
//   - risk_of_bias/frameworks/rob2/domains/_domain_4_measurement.py の _compute_judgement
//   - risk_of_bias/frameworks/rob2/domains/_domain_5_selection.py の _compute_judgement
//   - risk_of_bias/types/_framework_types.py の Framework.judgement（overall の統合規則）
// から 5 ドメインぶんの決定木・overall の「最悪ドメイン優先」規則をそのまま移植した
// （転記元の経緯として記録を残す）。
//
// 原典照合の記録（issue #103）: 2026-07-13 に公式一次資料（RoB 2 full guidance 2019-08-22 /
// cribsheet 2019-08-14 / Word completion template 2019-08-22。いずれも riskofbias.info の
// 公式配布リンク経由で取得）を入手し、`c:\tmp\rob-prespec\`（originals/ に SHA-256 記録付きの
// SOURCES.md、extracted/ に機械抽出テキスト、詳細は同 REPORT.md）へ保全した。signaling question
// 全 22 問の文言は公式 Word template と逐語照合し **22/22 一致・修正不要**を確認済み
// （robTemplates.ts の出典コメント参照。「原典照合待ち」TODO は解消）。決定木（本ファイルの
// judgeDomain1〜5）そのものは、公式ガイダンスでは流れ図（Figure 1〜5・7）として与えられており、
// 2026-07-13 の照合は SQ 質問本文を対象としたため決定木の分岐単位の逐語照合は含まない
// （移植元 OSS の典拠が同一の公式ガイダンスであることは確認済み）。
//
// --- 実装上の意図的な差分 ----------------------------------------------------
// 移植元 Python は Domain 2（deviations）の _compute_judgement のみ「未回答（None）」の
// 明示ガードを持たない（他の 4 ドメインは関数冒頭で `if None in (...): return None` を持つ）。
// 本実装は issue #61 の要件「回答不足（未回答項目がある）場合は提案なし（null）を返す」を
// 全ドメインへ一律適用するため、Domain 2 にも同様のガードを追加している（決定木本体は移植元と同一）。

/** RoB 2 signaling question の回答コード（y/py/pn/n/ni/na の 6 択） */
export type Rob2SqAnswer = 'y' | 'py' | 'pn' | 'n' | 'ni' | 'na';

/** RoB 2 のドメイン判定（low / some_concerns / high の 3 段階） */
export type Rob2Judgement = 'low' | 'some_concerns' | 'high';

const YES = new Set<Rob2SqAnswer>(['y', 'py']);
const NO = new Set<Rob2SqAnswer>(['n', 'pn']);
const NI = new Set<Rob2SqAnswer>(['ni']);
const YES_OR_NI = new Set<Rob2SqAnswer>(['y', 'py', 'ni']);
const NO_OR_NI = new Set<Rob2SqAnswer>(['n', 'pn', 'ni']);

/**
 * Domain 1（bias arising from the randomization process）。SQ 1.1〜1.3。
 * 出典: _domain_1_randomization.py の _compute_judgement。
 */
export function judgeDomain1Randomization(
  q1_1: Rob2SqAnswer | null,
  q1_2: Rob2SqAnswer | null,
  q1_3: Rob2SqAnswer | null,
): Rob2Judgement | null {
  if (q1_1 === null || q1_2 === null || q1_3 === null) {
    return null;
  }
  if (NO.has(q1_2)) {
    return 'high';
  }
  if (NI.has(q1_2)) {
    if (YES.has(q1_3)) {
      return 'high';
    }
    if (NO.has(q1_3) || NI.has(q1_3)) {
      return 'some_concerns';
    }
    return null; // q1_3 = na（本来 1.1〜1.3 はいずれも無条件設問のため na は想定外の入力）
  }
  if (YES.has(q1_2)) {
    if (NO.has(q1_1)) {
      return 'some_concerns';
    }
    if (YES_OR_NI.has(q1_1)) {
      if (NO_OR_NI.has(q1_3)) {
        return 'low';
      }
      if (YES.has(q1_3)) {
        return 'some_concerns';
      }
      return null; // q1_3 = na
    }
    return null; // q1_1 = na
  }
  return null; // q1_2 = na
}

/**
 * Domain 2（deviations from intended interventions – effect of assignment to intervention,
 * ITT 版）。SQ 2.1〜2.7。出典: _domain_2_deviations.py の _compute_judgement。
 * 移植時の差分: 未回答（null）ガードを追加（原文にはない。冒頭コメント参照）
 */
export function judgeDomain2Deviations(
  q2_1: Rob2SqAnswer | null,
  q2_2: Rob2SqAnswer | null,
  q2_3: Rob2SqAnswer | null,
  q2_4: Rob2SqAnswer | null,
  q2_5: Rob2SqAnswer | null,
  q2_6: Rob2SqAnswer | null,
  q2_7: Rob2SqAnswer | null,
): Rob2Judgement | null {
  if (
    q2_1 === null ||
    q2_2 === null ||
    q2_3 === null ||
    q2_4 === null ||
    q2_5 === null ||
    q2_6 === null ||
    q2_7 === null
  ) {
    return null;
  }

  // Part 1（2.1〜2.5: 意図した介入からの逸脱）
  let part1: Rob2Judgement;
  if (NO.has(q2_1) && NO.has(q2_2)) {
    part1 = 'low';
  } else if (NO.has(q2_3)) {
    part1 = 'low';
  } else if (NI.has(q2_3)) {
    part1 = 'some_concerns';
  } else if (NO.has(q2_4)) {
    // q2_3 in YES
    part1 = 'some_concerns';
  } else if (YES.has(q2_5)) {
    part1 = 'some_concerns';
  } else {
    part1 = 'high';
  }

  // Part 2（2.6〜2.7: 割付治療の効果を推定する解析方法）
  let part2: Rob2Judgement;
  if (YES.has(q2_6)) {
    part2 = 'low';
  } else if (NO.has(q2_7)) {
    part2 = 'some_concerns';
  } else {
    part2 = 'high';
  }

  if (part1 === 'low' && part2 === 'low') {
    return 'low';
  }
  if (part1 === 'high' || part2 === 'high') {
    return 'high';
  }
  return 'some_concerns';
}

/**
 * Domain 3（missing outcome data）。SQ 3.1〜3.4。
 * 出典: _domain_3_missing.py の _compute_judgement。
 */
export function judgeDomain3Missing(
  q3_1: Rob2SqAnswer | null,
  q3_2: Rob2SqAnswer | null,
  q3_3: Rob2SqAnswer | null,
  q3_4: Rob2SqAnswer | null,
): Rob2Judgement | null {
  if (q3_1 === null || q3_2 === null || q3_3 === null || q3_4 === null) {
    return null;
  }
  if (YES.has(q3_1)) {
    return 'low';
  }
  if (YES.has(q3_2)) {
    return 'low';
  }
  if (NO.has(q3_3)) {
    return 'low';
  }
  if (NO.has(q3_4)) {
    return 'some_concerns';
  }
  return 'high';
}

/**
 * Domain 4（measurement of the outcome）。SQ 4.1〜4.5。
 * 出典: _domain_4_measurement.py の _compute_judgement。
 */
export function judgeDomain4Measurement(
  q4_1: Rob2SqAnswer | null,
  q4_2: Rob2SqAnswer | null,
  q4_3: Rob2SqAnswer | null,
  q4_4: Rob2SqAnswer | null,
  q4_5: Rob2SqAnswer | null,
): Rob2Judgement | null {
  if (q4_1 === null || q4_2 === null || q4_3 === null || q4_4 === null || q4_5 === null) {
    return null;
  }
  if (YES.has(q4_1)) {
    return 'high';
  }
  if (YES.has(q4_2)) {
    return 'high';
  }
  if (NO.has(q4_2)) {
    if (NO.has(q4_3)) {
      return 'low';
    }
    if (NO.has(q4_4)) {
      return 'low';
    }
    if (NO.has(q4_5)) {
      return 'some_concerns';
    }
    return 'high';
  }
  // q4_2 = ni（YES でも NO でもない残余経路。原文コメント通り NI 経路として扱う）
  if (NO.has(q4_3)) {
    return 'some_concerns';
  }
  if (NO.has(q4_4)) {
    return 'some_concerns';
  }
  if (NO.has(q4_5)) {
    return 'some_concerns';
  }
  return 'high';
}

/**
 * Domain 5（selection of the reported result）。SQ 5.1〜5.3。
 * 出典: _domain_5_selection.py の _compute_judgement。
 */
export function judgeDomain5Selection(
  q5_1: Rob2SqAnswer | null,
  q5_2: Rob2SqAnswer | null,
  q5_3: Rob2SqAnswer | null,
): Rob2Judgement | null {
  if (q5_1 === null || q5_2 === null || q5_3 === null) {
    return null;
  }
  if (YES.has(q5_2) || YES.has(q5_3)) {
    return 'high';
  }
  if (NO.has(q5_2) && NO.has(q5_3)) {
    return YES.has(q5_1) ? 'low' : 'some_concerns';
  }
  return 'some_concerns';
}

const JUDGEMENT_SEVERITY: Record<Rob2Judgement, number> = { low: 0, some_concerns: 1, high: 2 };
const SEVERITY_TO_JUDGEMENT: readonly Rob2Judgement[] = ['low', 'some_concerns', 'high'];

/**
 * overall（全ドメイン統合）判定。出典: _framework_types.py の Framework.judgement
 * （"Overall" という名前のドメインを除く全ドメインの最悪値を採用する worst-domain 規則。
 * 全ドメイン low → low、いずれか high → high、それ以外（high は無いが some_concerns を含む）→
 * some_concerns）。domainJudgements が空、またはいずれかが null（未解決）なら null を返す
 * （issue #61 要件「回答不足の場合は提案なし」）
 */
export function judgeOverallRob2(domainJudgements: readonly (Rob2Judgement | null)[]): Rob2Judgement | null {
  if (domainJudgements.length === 0) {
    return null;
  }
  let worst = 0;
  for (const judgement of domainJudgements) {
    if (judgement === null) {
      return null;
    }
    worst = Math.max(worst, JUDGEMENT_SEVERITY[judgement]);
  }
  return SEVERITY_TO_JUDGEMENT[worst] as Rob2Judgement;
}

// --- ROBINS-I（非ランダム化介入研究）の signaling question 回答からドメイン別判定・overall 判定を
//     機械的に導出する純ロジック層（issue #61 PR2 = issue #87）。
//
// --- 出典・採用版 -----------------------------------------------------------
// 出典・2016 版（Sterne et al. BMJ 2016;355:i4919 + 同 detailed guidance）を採用した理由は
// features/schema/presets/robTemplates.ts 冒頭コメント参照。原典は 2026-07-13 に直接取得し、
// pdfjs-dist でページ本文を機械抽出のうえ逐語照合した（Box 4〜10 / Table 2・5〜11）。
//
// --- RoB 2 との重要な違い（判定アルゴリズムの性質） ---------------------------------
// RoB 2 は SQ 回答 → 判定の写像が完全な決定木として公式ガイダンスに定義されている（本ファイル冒頭の
// judgeDomain1Randomization 等）のに対し、ROBINS-I（2016 版）のドメイン判定基準（Table 5〜11）には
// "very strongly" 対 "not very strongly"、"substantial" 対 "important" のような程度の判断を要する
// 記述や、SQ に無い追加情報（negative control の有無、交絡が原理的に制御可能か等）を要求する分岐が
// 含まれる。これは 2016 版 ROBINS-I 自体の既知の性質であり（2024 年に公表された ROBINS-I V2 が
// 「SQ 回答から判定を導く公式アルゴリズム」を新規導入した動機そのものでもある — 採用版について詳細は
// robTemplates.ts 冒頭コメント参照）、本実装のバグではない。
//
// このため以下の `judgeRobinsIDomain*` は、**原典の基準が SQ 回答から一意に導ける分岐でのみ判定値を
// 返し、程度の判断や SQ に無い情報を要する分岐では null（提案なし）を返す**。具体的には、
// いずれの関数も critical を一度も返さない（critical の基準は例外なく「著しく」「原理的に制御
// 不能」等の追加判断を要するため）。これは既存の「回答不足なら提案なし」という契約
// （buildInfo・collectRobAlgorithmInfo）の自然な拡張であり、issue #61 D-2 合意
// 「アルゴリズム導出 + 人間確定」（アルゴリズムが自信を持てないときは沈黙し、人間の判定に委ねる）
// とも整合する。

/** ROBINS-I のドメイン判定（low / moderate / serious / critical / no_information の 5 段階） */
export type RobinsIJudgement = 'low' | 'moderate' | 'serious' | 'critical' | 'no_information';

/**
 * Domain 1（bias due to confounding）。SQ 1.1〜1.8。出典: Box 4 / Table 5。
 * 1.6（post-intervention 変数への不適切調整の有無）は Table 5 の判定基準に明示の言及が無いため、
 * アルゴリズムには使わず人間への参考情報として扱う（SQ 項目自体はプリセットに残る）
 */
export function judgeRobinsIDomain1Confounding(
  q1_1: Rob2SqAnswer | null,
  q1_2: Rob2SqAnswer | null,
  q1_3: Rob2SqAnswer | null,
  q1_4: Rob2SqAnswer | null,
  q1_5: Rob2SqAnswer | null,
  _q1_6: Rob2SqAnswer | null,
  q1_7: Rob2SqAnswer | null,
  q1_8: Rob2SqAnswer | null,
): RobinsIJudgement | null {
  if (q1_1 === null) {
    return null;
  }
  if (NO.has(q1_1)) {
    return 'low'; // Table 5 Low: 「No confounding expected」
  }
  if (!YES.has(q1_1)) {
    return null; // 1.1 は原典上 NI/NA を持たない設問。想定外入力は防御的に null
  }

  // 1.1 = y/py（交絡の可能性あり）。時間依存交絡の評価が必要かを 1.2/1.3 で判定する
  if (q1_2 === null) {
    return null;
  }
  let timeVarying: boolean;
  if (NO.has(q1_2)) {
    timeVarying = false;
  } else if (YES.has(q1_2)) {
    if (q1_3 === null) {
      return null;
    }
    if (NO.has(q1_3)) {
      timeVarying = false;
    } else if (YES.has(q1_3)) {
      timeVarying = true;
    } else {
      return null; // 1.3 = ni/na（経路を判定できない）
    }
  } else {
    return null; // 1.2 = ni/na（経路を判定できない）
  }

  const controlQ = timeVarying ? q1_7 : q1_4;
  const reliabilityQ = timeVarying ? q1_8 : q1_5;

  if (controlQ === null) {
    return null;
  }
  if (NO.has(controlQ) || NI.has(controlQ)) {
    return 'serious'; // Table 5 Serious(i): 重要な交絡ドメインの少なくとも 1 つが未制御
  }
  if (!YES.has(controlQ)) {
    return null; // na（想定外の経路）
  }
  if (reliabilityQ === null) {
    return null;
  }
  if (NO.has(reliabilityQ) || NI.has(reliabilityQ)) {
    return 'serious'; // Table 5 Serious(ii): 妥当性・信頼性が不十分
  }
  if (YES.has(reliabilityQ)) {
    return 'moderate'; // Table 5 Moderate(i)+(ii)
  }
  return null; // na（想定外）
}

/**
 * Domain 2（bias in selection of participants into the study）。SQ 2.1〜2.5。
 * 出典: Box 5 / Table 6。Serious / Critical は「very strongly」等の程度判断を要するため提案しない
 */
export function judgeRobinsIDomain2Selection(
  q2_1: Rob2SqAnswer | null,
  q2_2: Rob2SqAnswer | null,
  q2_3: Rob2SqAnswer | null,
  q2_4: Rob2SqAnswer | null,
  q2_5: Rob2SqAnswer | null,
): RobinsIJudgement | null {
  if (q2_1 === null || q2_4 === null) {
    return null;
  }

  let characteristicsIssue: boolean;
  if (NO.has(q2_1)) {
    characteristicsIssue = false;
  } else if (YES.has(q2_1)) {
    if (q2_2 === null || q2_3 === null) {
      return null;
    }
    if (YES.has(q2_2) && YES.has(q2_3)) {
      characteristicsIssue = true;
    } else if (NO.has(q2_2) || NO.has(q2_3)) {
      characteristicsIssue = false;
    } else {
      return null; // 2.2/2.3 が ni のみ残り判定不能
    }
  } else {
    return null; // 2.1 = ni/na
  }

  let lagIssue: boolean;
  if (YES.has(q2_4)) {
    lagIssue = false;
  } else if (NO.has(q2_4)) {
    lagIssue = true;
  } else {
    return null; // 2.4 = ni/na
  }

  if (!characteristicsIssue && !lagIssue) {
    return 'low'; // Table 6 Low(i)+(ii)
  }
  if (q2_5 === null) {
    return null;
  }
  if (YES.has(q2_5)) {
    return 'moderate'; // Table 6 Moderate: 調整技法で選択バイアスを補正
  }
  return null; // n/pn/ni: Serious/Critical は程度判断を要するため提案しない
}

/**
 * Domain 3（bias in classification of interventions）。SQ 3.1〜3.3。
 * 出典: Box 6 / Table 7。Critical（「極端に高い誤分類」）は程度判断を要するため提案しない
 */
export function judgeRobinsIDomain3Classification(
  q3_1: Rob2SqAnswer | null,
  q3_2: Rob2SqAnswer | null,
  q3_3: Rob2SqAnswer | null,
): RobinsIJudgement | null {
  if (q3_1 === null) {
    return null;
  }
  if (NO.has(q3_1)) {
    return 'serious'; // Table 7 Serious(i): 介入群の定義が不明瞭
  }
  if (!YES.has(q3_1)) {
    return null; // 3.1 = ni/na
  }
  if (q3_2 === null) {
    return null;
  }
  if (YES.has(q3_2)) {
    return 'low'; // Table 7 Low: 介入時点で収集された情報のみに基づく
  }
  if (!NO.has(q3_2)) {
    return null; // 3.2 = ni/na
  }
  if (q3_3 === null) {
    return null;
  }
  if (NO.has(q3_3)) {
    return 'moderate'; // Table 7 Moderate: 一部遡及的だが結果の知識に影響されていない
  }
  if (YES.has(q3_3)) {
    return 'serious'; // Table 7 Serious(ii): 結果の知識に影響されて分類された可能性
  }
  return null; // 3.3 = ni/na
}

type Rob4PathJudgement = 'low' | 'moderate' | 'serious';

/** D4 の「assignment への効果」評価版（SQ 4.1〜4.2）。出典: Table 8「Effect of assignment」 */
function judgeRobinsIDomain4AssignmentPath(
  q4_1: Rob2SqAnswer | null,
  q4_2: Rob2SqAnswer | null,
): Rob4PathJudgement | null {
  if (q4_1 === null) {
    return null;
  }
  if (NO.has(q4_1)) {
    return 'low'; // 通常診療の範囲内の逸脱のみ
  }
  if (!YES.has(q4_1)) {
    return null; // 4.1 = ni/na
  }
  if (q4_2 === null) {
    return null;
  }
  if (YES.has(q4_2)) {
    return 'serious'; // Table 8 Serious: 「不均衡かつ結果に影響」と原文の複合条件に逐語一致
  }
  if (NO.has(q4_2)) {
    return 'low'; // 複合条件（不均衡かつ結果に影響）が不成立
  }
  return null; // 4.2 = ni/na
}

/** D4 の「starting and adhering への効果」評価版（SQ 4.3〜4.6）。出典: Table 8「Effect of starting…」 */
function judgeRobinsIDomain4AdheringPath(
  q4_3: Rob2SqAnswer | null,
  q4_4: Rob2SqAnswer | null,
  q4_5: Rob2SqAnswer | null,
  q4_6: Rob2SqAnswer | null,
): Rob4PathJudgement | null {
  if (q4_3 === null || q4_4 === null || q4_5 === null) {
    return null;
  }
  if (YES.has(q4_3) && YES.has(q4_4) && YES.has(q4_5)) {
    return 'low'; // Table 8 Low: 併用療法が均衡・実施と遵守に問題なし
  }
  if (!(NO.has(q4_3) || NO.has(q4_4) || NO.has(q4_5))) {
    return null; // 明確な NO が無く（ni混在等）程度判断が必要
  }
  if (q4_6 === null) {
    return null;
  }
  if (YES.has(q4_6)) {
    return 'moderate'; // Table 8 Moderate(ii): 適切な解析で逸脱を補正
  }
  if (NO.has(q4_6)) {
    return 'serious'; // Table 8 Serious(ii): 補正されていない
  }
  return null; // 4.6 = ni/na
}

const ROB4_PATH_RANK: Readonly<Record<Rob4PathJudgement, number>> = { low: 0, moderate: 1, serious: 2 };

/**
 * Domain 4（bias due to deviations from intended interventions）。SQ 4.1〜4.6。出典: Box 7 / Table 8。
 * 「assignment への効果」評価版（4.1〜4.2）と「starting and adhering への効果」評価版（4.3〜4.6）の
 * いずれか一方だけが実質的に回答され、他方は na になる想定（D-5 合意）。両方に実回答がある場合は
 * 安全側に倒して悪い方（low < moderate < serious）を採用する
 */
export function judgeRobinsIDomain4Deviations(
  q4_1: Rob2SqAnswer | null,
  q4_2: Rob2SqAnswer | null,
  q4_3: Rob2SqAnswer | null,
  q4_4: Rob2SqAnswer | null,
  q4_5: Rob2SqAnswer | null,
  q4_6: Rob2SqAnswer | null,
): RobinsIJudgement | null {
  const assignmentPath = judgeRobinsIDomain4AssignmentPath(q4_1, q4_2);
  const adheringPath = judgeRobinsIDomain4AdheringPath(q4_3, q4_4, q4_5, q4_6);
  if (assignmentPath === null) {
    return adheringPath;
  }
  if (adheringPath === null) {
    return assignmentPath;
  }
  return ROB4_PATH_RANK[assignmentPath] >= ROB4_PATH_RANK[adheringPath] ? assignmentPath : adheringPath;
}

/**
 * Domain 5（bias due to missing data）。SQ 5.1〜5.5。出典: Box 8 / Table 9。
 * Low 以外（Moderate/Serious/Critical）の境界は「slightly」対「substantially」等の程度判断を
 * 要し SQ 回答だけでは一意に決まらないため、本アルゴリズムは low または null のみを返す
 */
export function judgeRobinsIDomain5Missing(
  q5_1: Rob2SqAnswer | null,
  q5_2: Rob2SqAnswer | null,
  q5_3: Rob2SqAnswer | null,
  q5_4: Rob2SqAnswer | null,
  q5_5: Rob2SqAnswer | null,
): RobinsIJudgement | null {
  if (q5_1 === null || q5_2 === null || q5_3 === null) {
    return null;
  }
  let triggered: boolean | null;
  if (NO.has(q5_1) || YES.has(q5_2) || YES.has(q5_3)) {
    triggered = true;
  } else if (YES.has(q5_1) && NO.has(q5_2) && NO.has(q5_3)) {
    triggered = false;
  } else {
    triggered = null; // ni が残り判定不能
  }
  if (triggered === null) {
    return null;
  }
  if (!triggered) {
    return 'low'; // Table 9 Low(i): データがおおむね揃っている
  }
  if (q5_4 === null || q5_5 === null) {
    return null;
  }
  if (YES.has(q5_4) || YES.has(q5_5)) {
    return 'low'; // Table 9 Low(ii)/(iii): 群間で同程度、または解析で頑健性を確認
  }
  return null; // Moderate/Serious/Critical の境界は程度判断を要するため提案しない
}

/**
 * Domain 6（bias in measurement of outcomes）。SQ 6.1〜6.4。出典: Box 9 / Table 10。
 * Critical（「比較不能なほど方法が異なる」）は程度判断を要するため提案しない
 */
export function judgeRobinsIDomain6Measurement(
  q6_1: Rob2SqAnswer | null,
  q6_2: Rob2SqAnswer | null,
  q6_3: Rob2SqAnswer | null,
  q6_4: Rob2SqAnswer | null,
): RobinsIJudgement | null {
  if (q6_1 === null || q6_2 === null || q6_3 === null || q6_4 === null) {
    return null;
  }
  if (NO.has(q6_3)) {
    return 'serious'; // Table 10 Serious(i): 評価方法が群間で比較可能でない
  }
  if (!YES.has(q6_3)) {
    return null; // 6.3 = ni/na
  }
  if (YES.has(q6_4)) {
    return 'serious'; // Table 10 Serious(iii): 測定誤差が介入状況と関連
  }
  if (!NO.has(q6_4)) {
    return null; // 6.4 = ni/na
  }
  if (YES.has(q6_1) && YES.has(q6_2)) {
    return 'serious'; // Table 10 Serious(ii): 主観的な指標かつ評価者が非盲検
  }
  if (NI.has(q6_1) || NI.has(q6_2)) {
    return null; // 判定不能
  }
  return 'low'; // Table 10 Low: 比較可能な方法・客観的または盲検・誤差は介入状況と無関係
}

/**
 * Domain 7（bias in selection of the reported result）。SQ 7.1〜7.3。出典: Box 10 / Table 11。
 * Table 11 の Low は事前登録プロトコルとの一致という SQ に無い追加情報を要求するため、
 * 本アルゴリズムは（選択的報告の証拠が無い場合でも）moderate までしか提案しない
 */
export function judgeRobinsIDomain7Reporting(
  q7_1: Rob2SqAnswer | null,
  q7_2: Rob2SqAnswer | null,
  q7_3: Rob2SqAnswer | null,
): RobinsIJudgement | null {
  if (q7_1 === null || q7_2 === null || q7_3 === null) {
    return null;
  }
  if (YES.has(q7_1) || YES.has(q7_2) || YES.has(q7_3)) {
    return 'serious'; // Table 11 Serious: 複数測定・複数解析・部分集団からの選択的報告の疑い
  }
  if (NI.has(q7_1) || NI.has(q7_2) || NI.has(q7_3)) {
    return null; // 判定不能
  }
  return 'moderate'; // 全問 n/pn（選択的報告の証拠なし）
}

/**
 * overall（全ドメイン統合）判定。出典: Table 2。
 * - 全ドメイン low → low
 * - serious/critical が無く（moderate を含んでもよい）→ moderate
 * - いずれか 1 つ以上 serious（critical は無し）→ serious
 * - いずれか 1 つ以上 critical → critical
 * - serious/critical は無いが 1 つ以上のドメインが no_information → no_information
 * domainJudgements が空、またはいずれかが null（未解決）なら null（issue #61 要件「回答不足なら
 * 提案なし」。RobinsIJudgement 自体は 'no_information' を持つため、こちらは「セルに値が無い」
 * ケースのみを指し、AI/人間が明示的に no_information を選んだ場合とは区別する）
 */
export function judgeOverallRobinsI(
  domainJudgements: readonly (RobinsIJudgement | null)[],
): RobinsIJudgement | null {
  if (domainJudgements.length === 0) {
    return null;
  }
  const resolved: RobinsIJudgement[] = [];
  for (const judgement of domainJudgements) {
    if (judgement === null) {
      return null;
    }
    resolved.push(judgement);
  }
  if (resolved.some((judgement) => judgement === 'critical')) {
    return 'critical';
  }
  if (resolved.some((judgement) => judgement === 'serious')) {
    return 'serious';
  }
  if (resolved.some((judgement) => judgement === 'no_information')) {
    return 'no_information';
  }
  if (resolved.some((judgement) => judgement === 'moderate')) {
    return 'moderate';
  }
  return 'low';
}

// --- UI 配線用の集約（issue #61 §3。#65 の collectConsistencyWarnings と同じ
//     「純関数 + cellKey → 情報」パターン） --------------------------------------
import { NOT_REPORTED_TOKEN } from '../../domain/annotation';
import { parseEntityKey } from '../../utils/entityKey';
import { ROB2_SQ_FIELD_NAMES, ROBINS_I_SQ_FIELD_NAMES } from '../schema/presets/robTemplates';
import type { CellGroup, TabModel, VerificationCell } from './cells';

/** rob2 プリセット（軽量版・SQ 完全版共通）の判定フィールド名 */
const ROB2_JUDGEMENT_FIELD_NAME = 'rob2_judgement';

/** robins_i プリセット（軽量版・SQ 完全版共通）の判定フィールド名 */
const ROBINS_I_JUDGEMENT_FIELD_NAME = 'robins_i_judgement';

/** RCT 版 RoB 2 の 5 固定ドメイン id（overall 統合に使う固定順。ROB2_DOMAINS と対応） */
const ROB2_RCT_DOMAIN_IDS: readonly string[] = [
  'd1_randomization',
  'd2_deviations',
  'd3_missing_data',
  'd4_measurement',
  'd5_reporting',
];

/** ROBINS-I の 7 固定ドメイン id（overall 統合に使う固定順。ROBINS_I_DOMAINS と対応） */
const ROBINS_I_DOMAIN_IDS: readonly string[] = [
  'd1_confounding',
  'd2_selection',
  'd3_classification',
  'd4_deviations',
  'd5_missing_data',
  'd6_measurement',
  'd7_reporting',
];

type DomainJudgeFn = (answers: readonly (Rob2SqAnswer | null)[]) => Rob2Judgement | RobinsIJudgement | null;

/** ドメイン id ごとの SQ field_name 一覧 + 判定関数を 1 つに束ねる。
 *
 * fieldNames・judge を別々の Record として持つと（例: `fieldNames[id] !== undefined &&
 * judge[id] !== undefined` のような 2 テーブル併用チェック）、両テーブルのキー集合が
 * 常に一致するよう構築している以上「片方だけ定義されている」組み合わせが実行時に絶対発生せず、
 * カバレッジ上到達不能な分岐を生んでしまう。1 つの Record にまとめることでチェックが
 * 1 箇所（`DOMAIN_ALGORITHMS[id] !== undefined` 相当）に収まり、定義済み / 未定義の両方が
 * 現実のデータで到達可能になる（未定義側は ROBINS-I 等 SQ を持たないドメインで発生する）。
 * `fieldNames` は ROB2_SQ_FIELD_NAMES（robTemplates.ts が生成する field_name と同一情報源）
 * から取り、`as readonly string[]` は「この 5 キーは必ず存在する」という不変条件に基づく
 * 型注釈（実行時分岐を生まない）。judge 内の `answers[n] as ...` も同様に、
 * fieldNames.length と answers.length が呼び出し側で必ず一致する不変条件に基づく型注釈であり、
 * `?? null` のような実行時フォールバックは使わない（同じ理由で到達不能分岐を避けるため） */
const DOMAIN_ALGORITHMS: Readonly<Record<string, { fieldNames: readonly string[]; judge: DomainJudgeFn }>> = {
  d1_randomization: {
    fieldNames: ROB2_SQ_FIELD_NAMES['d1_randomization'] as readonly string[],
    judge: (answers) =>
      judgeDomain1Randomization(
        answers[0] as Rob2SqAnswer | null,
        answers[1] as Rob2SqAnswer | null,
        answers[2] as Rob2SqAnswer | null,
      ),
  },
  d2_deviations: {
    fieldNames: ROB2_SQ_FIELD_NAMES['d2_deviations'] as readonly string[],
    judge: (answers) =>
      judgeDomain2Deviations(
        answers[0] as Rob2SqAnswer | null,
        answers[1] as Rob2SqAnswer | null,
        answers[2] as Rob2SqAnswer | null,
        answers[3] as Rob2SqAnswer | null,
        answers[4] as Rob2SqAnswer | null,
        answers[5] as Rob2SqAnswer | null,
        answers[6] as Rob2SqAnswer | null,
      ),
  },
  d3_missing_data: {
    fieldNames: ROB2_SQ_FIELD_NAMES['d3_missing_data'] as readonly string[],
    judge: (answers) =>
      judgeDomain3Missing(
        answers[0] as Rob2SqAnswer | null,
        answers[1] as Rob2SqAnswer | null,
        answers[2] as Rob2SqAnswer | null,
        answers[3] as Rob2SqAnswer | null,
      ),
  },
  d4_measurement: {
    fieldNames: ROB2_SQ_FIELD_NAMES['d4_measurement'] as readonly string[],
    judge: (answers) =>
      judgeDomain4Measurement(
        answers[0] as Rob2SqAnswer | null,
        answers[1] as Rob2SqAnswer | null,
        answers[2] as Rob2SqAnswer | null,
        answers[3] as Rob2SqAnswer | null,
        answers[4] as Rob2SqAnswer | null,
      ),
  },
  d5_reporting: {
    fieldNames: ROB2_SQ_FIELD_NAMES['d5_reporting'] as readonly string[],
    judge: (answers) =>
      judgeDomain5Selection(
        answers[0] as Rob2SqAnswer | null,
        answers[1] as Rob2SqAnswer | null,
        answers[2] as Rob2SqAnswer | null,
      ),
  },
  // --- ここから ROBINS-I（issue #87）。RoB 2 とはドメイン id の名前空間が重ならないため
  //     （d1_randomization 対 d1_confounding 等）、同一の DOMAIN_ALGORITHMS へ追記できる ---
  d1_confounding: {
    fieldNames: ROBINS_I_SQ_FIELD_NAMES['d1_confounding'] as readonly string[],
    judge: (answers) =>
      judgeRobinsIDomain1Confounding(
        answers[0] as Rob2SqAnswer | null,
        answers[1] as Rob2SqAnswer | null,
        answers[2] as Rob2SqAnswer | null,
        answers[3] as Rob2SqAnswer | null,
        answers[4] as Rob2SqAnswer | null,
        answers[5] as Rob2SqAnswer | null,
        answers[6] as Rob2SqAnswer | null,
        answers[7] as Rob2SqAnswer | null,
      ),
  },
  d2_selection: {
    fieldNames: ROBINS_I_SQ_FIELD_NAMES['d2_selection'] as readonly string[],
    judge: (answers) =>
      judgeRobinsIDomain2Selection(
        answers[0] as Rob2SqAnswer | null,
        answers[1] as Rob2SqAnswer | null,
        answers[2] as Rob2SqAnswer | null,
        answers[3] as Rob2SqAnswer | null,
        answers[4] as Rob2SqAnswer | null,
      ),
  },
  d3_classification: {
    fieldNames: ROBINS_I_SQ_FIELD_NAMES['d3_classification'] as readonly string[],
    judge: (answers) =>
      judgeRobinsIDomain3Classification(
        answers[0] as Rob2SqAnswer | null,
        answers[1] as Rob2SqAnswer | null,
        answers[2] as Rob2SqAnswer | null,
      ),
  },
  d4_deviations: {
    fieldNames: ROBINS_I_SQ_FIELD_NAMES['d4_deviations'] as readonly string[],
    judge: (answers) =>
      judgeRobinsIDomain4Deviations(
        answers[0] as Rob2SqAnswer | null,
        answers[1] as Rob2SqAnswer | null,
        answers[2] as Rob2SqAnswer | null,
        answers[3] as Rob2SqAnswer | null,
        answers[4] as Rob2SqAnswer | null,
        answers[5] as Rob2SqAnswer | null,
      ),
  },
  d5_missing_data: {
    fieldNames: ROBINS_I_SQ_FIELD_NAMES['d5_missing_data'] as readonly string[],
    judge: (answers) =>
      judgeRobinsIDomain5Missing(
        answers[0] as Rob2SqAnswer | null,
        answers[1] as Rob2SqAnswer | null,
        answers[2] as Rob2SqAnswer | null,
        answers[3] as Rob2SqAnswer | null,
        answers[4] as Rob2SqAnswer | null,
      ),
  },
  d6_measurement: {
    fieldNames: ROBINS_I_SQ_FIELD_NAMES['d6_measurement'] as readonly string[],
    judge: (answers) =>
      judgeRobinsIDomain6Measurement(
        answers[0] as Rob2SqAnswer | null,
        answers[1] as Rob2SqAnswer | null,
        answers[2] as Rob2SqAnswer | null,
        answers[3] as Rob2SqAnswer | null,
      ),
  },
  d7_reporting: {
    fieldNames: ROBINS_I_SQ_FIELD_NAMES['d7_reporting'] as readonly string[],
    judge: (answers) =>
      judgeRobinsIDomain7Reporting(
        answers[0] as Rob2SqAnswer | null,
        answers[1] as Rob2SqAnswer | null,
        answers[2] as Rob2SqAnswer | null,
      ),
  },
};

const SQ_ANSWER_VALUES: readonly Rob2SqAnswer[] = ['y', 'py', 'pn', 'n', 'ni', 'na'];
const ROB2_JUDGEMENT_VALUES: readonly Rob2Judgement[] = ['low', 'some_concerns', 'high'];
const ROBINS_I_JUDGEMENT_VALUES: readonly RobinsIJudgement[] = [
  'low',
  'moderate',
  'serious',
  'critical',
  'no_information',
];
/** 両ツールの判定値をまとめた集合（同一ドメインの現在値としてしか使わないため、
 * 'low' のような共通値があっても曖昧さは生じない） */
const JUDGEMENT_VALUES: readonly (Rob2Judgement | RobinsIJudgement)[] = [
  ...ROB2_JUDGEMENT_VALUES,
  ...ROBINS_I_JUDGEMENT_VALUES,
];

function parseSqAnswer(raw: string | null): Rob2SqAnswer | null {
  if (raw === null) {
    return null;
  }
  const trimmed = raw.trim().toLowerCase();
  return (SQ_ANSWER_VALUES as readonly string[]).includes(trimmed) ? (trimmed as Rob2SqAnswer) : null;
}

function parseJudgementValue(raw: string | null): Rob2Judgement | RobinsIJudgement | null {
  if (raw === null) {
    return null;
  }
  const trimmed = raw.trim().toLowerCase();
  return (JUDGEMENT_VALUES as readonly string[]).includes(trimmed)
    ? (trimmed as Rob2Judgement | RobinsIJudgement)
    : null;
}

/**
 * セルの現在値を解決する（判定確定値 > AI 抽出値。consistencyChecks.ts の resolveCellRawValue と
 * 同じ優先規則 — issue #61 D-2 合意「#65 と同じ優先規則」）。null・NOT_REPORTED_TOKEN は「値なし」
 */
function resolveCellRawValue(cell: VerificationCell): string | null {
  const raw = cell.state.value ?? cell.evidence?.value ?? null;
  if (raw === null || raw === NOT_REPORTED_TOKEN) {
    return null;
  }
  return raw;
}

function findCellByFieldName(group: CellGroup, fieldName: string): VerificationCell | undefined {
  return group.cells.find((cell) => cell.field.fieldName === fieldName);
}

/** rob_domain タブの judgement セル 1 件ぶんの情報（提案チップ・不一致警告・未確認表示の素材） */
export interface RobAlgorithmInfo {
  cellKey: string;
  /** SQ 回答（overall は他ドメインの現在判定値）から導出した提案。回答不足なら null */
  suggestion: Rob2Judgement | RobinsIJudgement | null;
  /** セルの現在値（判定確定値 > AI 値）。judgement の enum 値として解釈できないときも null */
  currentValue: Rob2Judgement | RobinsIJudgement | null;
  /** suggestion・currentValue が共に存在し、値が食い違うか */
  mismatch: boolean;
  /** AI が値を出しているが人間の判定が 0 件（未検証）か */
  aiUnconfirmed: boolean;
}

function buildInfo(cell: VerificationCell, suggestion: Rob2Judgement | RobinsIJudgement | null): RobAlgorithmInfo {
  const currentValue = parseJudgementValue(resolveCellRawValue(cell));
  return {
    cellKey: cell.cellKey,
    suggestion,
    currentValue,
    mismatch: suggestion !== null && currentValue !== null && suggestion !== currentValue,
    aiUnconfirmed: cell.evidence !== null && cell.state.status === 'unverified',
  };
}

/**
 * rob_domain タブの TabModel から、ドメイン別 SQ 回答によるアルゴリズム提案・現在値との
 * 食い違い・AI 判定未確認を judgement セル（field_name が `_judgement` で終わる）ごとに集約する
 * （issue #61 §3。#65 の collectConsistencyWarnings と同じ「純関数 + cellKey → 情報」パターン）。
 * RoB 2 / ROBINS-I いずれの judgement セルも DOMAIN_ALGORITHMS で提案を算出する（両ツールの
 * ドメイン id は名前空間が重ならないため同一マップに同居できる。robTemplates.ts 参照）。
 * SQ を持たないカスタム RoB 項目（field_name が `_judgement` で終わるが DOMAIN_ALGORITHMS に
 * 無い domain_id）は suggestion が自然に null になり、aiUnconfirmed だけが有効に働く。
 * rob2 / robins_i それぞれの軽量版・SQ 完全版が同一スキーマに混在する場合（field_name は同じだが
 * 通常はエディタの重複バリデーションで防止される組み合わせ）も、group 内の `_judgement` セルを
 * 漏れなく走査する
 */
export function collectRobAlgorithmInfo(model: TabModel): Map<string, RobAlgorithmInfo> {
  const result = new Map<string, RobAlgorithmInfo>();
  const domainCurrentValues = new Map<string, Rob2Judgement | RobinsIJudgement | null>();
  const overallCells: VerificationCell[] = [];

  for (const group of model.groups) {
    const entityKey = group.cells[0]?.entityKey;
    if (entityKey === undefined) {
      continue;
    }
    const parsed = parseEntityKey(entityKey);
    if (parsed === null || parsed.level !== 'rob_domain') {
      continue;
    }
    const judgementCells = group.cells.filter((cell) => cell.field.fieldName.endsWith('_judgement'));
    if (judgementCells.length === 0) {
      continue;
    }
    if (parsed.domain === 'overall') {
      overallCells.push(...judgementCells);
      continue;
    }

    const algorithm = DOMAIN_ALGORITHMS[parsed.domain];
    const sqSuggestion =
      algorithm === undefined
        ? null
        : algorithm.judge(
            algorithm.fieldNames.map((name) => {
              const cell = findCellByFieldName(group, name);
              return cell === undefined ? null : parseSqAnswer(resolveCellRawValue(cell));
            }),
          );

    for (const judgementCell of judgementCells) {
      const fieldName = judgementCell.field.fieldName;
      const isPrimaryJudgement =
        fieldName === ROB2_JUDGEMENT_FIELD_NAME || fieldName === ROBINS_I_JUDGEMENT_FIELD_NAME;
      const info = buildInfo(judgementCell, isPrimaryJudgement ? sqSuggestion : null);
      result.set(info.cellKey, info);
      if (isPrimaryJudgement) {
        domainCurrentValues.set(parsed.domain, info.currentValue);
      }
    }
  }

  for (const cell of overallCells) {
    const fieldName = cell.field.fieldName;
    let suggestion: Rob2Judgement | RobinsIJudgement | null = null;
    if (fieldName === ROB2_JUDGEMENT_FIELD_NAME) {
      suggestion = judgeOverallRob2(
        ROB2_RCT_DOMAIN_IDS.map((id) => (domainCurrentValues.get(id) as Rob2Judgement | null) ?? null),
      );
    } else if (fieldName === ROBINS_I_JUDGEMENT_FIELD_NAME) {
      suggestion = judgeOverallRobinsI(
        ROBINS_I_DOMAIN_IDS.map((id) => (domainCurrentValues.get(id) as RobinsIJudgement | null) ?? null),
      );
    }
    const info = buildInfo(cell, suggestion);
    result.set(info.cellKey, info);
  }

  return result;
}
