// RoB 2（Cochrane risk-of-bias tool for randomized trials）の signaling question（SQ）回答から
// ドメイン別判定・overall 判定を機械的に導出する純ロジック層（issue #61 PR1）。
//
// --- 出典 -----------------------------------------------------------------
// signaling question の文言・条件付き質問の発火規則・ドメイン別アルゴリズム（決定木）・
// overall の統合規則は、いずれも Sterne JAC et al. "RoB 2: a revised tool for assessing risk
// of bias in randomised trials." BMJ 2019;366:l4898 の付随ガイダンス（Cochrane, RoB 2
// guidance, 2019）に基づく。
//
// 一次資料（cochrane.de の PDF・BMJ 誌本体・riskofbias.info・training.cochrane.org・arxiv.org
// 等）は、本セッションの outbound egress ポリシーにより直接アクセスできなかった
// （github.com / raw.githubusercontent.com 以外の大半のホストが 403 で遮断された。
// /root/.ccr/README.md 参照。10 件以上のホストを試行したが成功したのは GitHub 系のみ）。
// そのため、上記 BMJ 論文を明示的な典拠として docstring に引用しているサードパーティの OSS 実装
// （GitHub: rob-luke/risk-of-bias。取得日 2026-07-12 の main ブランチ）
//   - risk_of_bias/frameworks/rob2/domains/_domain_1_randomization.py の _compute_judgement
//   - risk_of_bias/frameworks/rob2/domains/_domain_2_deviations.py の _compute_judgement
//   - risk_of_bias/frameworks/rob2/domains/_domain_3_missing.py の _compute_judgement
//   - risk_of_bias/frameworks/rob2/domains/_domain_4_measurement.py の _compute_judgement
//   - risk_of_bias/frameworks/rob2/domains/_domain_5_selection.py の _compute_judgement
//   - risk_of_bias/types/_framework_types.py の Framework.judgement（overall の統合規則）
// を取得し、5 ドメインぶんの決定木・overall の「最悪ドメイン優先」規則をそのまま移植した。
// 各ファイルの docstring が同一の BMJ 論文を典拠として明記しており、質問文言・条件分岐の構造も
// 既知の RoB 2 ツール（Excel 版・riskofbias.info の cribsheet）の一般的な記述と整合する。
// ただし一次資料との逐語照合はできていないため、**正式なガイダンス PDF 入手時に再照合すること**
// （TODO: 原典照合待ち）。
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

// --- UI 配線用の集約（issue #61 §3。#65 の collectConsistencyWarnings と同じ
//     「純関数 + cellKey → 情報」パターン） --------------------------------------
import { NOT_REPORTED_TOKEN } from '../../domain/annotation';
import { parseEntityKey } from '../../utils/entityKey';
import { ROB2_SQ_FIELD_NAMES } from '../schema/presets/robTemplates';
import type { CellGroup, TabModel, VerificationCell } from './cells';

/** rob2 プリセット（軽量版・SQ 完全版共通）の判定フィールド名 */
const ROB2_JUDGEMENT_FIELD_NAME = 'rob2_judgement';

/** RCT 版 RoB 2 の 5 固定ドメイン id（overall 統合に使う固定順。ROB2_DOMAINS と対応） */
const ROB2_RCT_DOMAIN_IDS: readonly string[] = [
  'd1_randomization',
  'd2_deviations',
  'd3_missing_data',
  'd4_measurement',
  'd5_reporting',
];

type DomainJudgeFn = (answers: readonly (Rob2SqAnswer | null)[]) => Rob2Judgement | null;

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
};

const SQ_ANSWER_VALUES: readonly Rob2SqAnswer[] = ['y', 'py', 'pn', 'n', 'ni', 'na'];
const JUDGEMENT_VALUES: readonly Rob2Judgement[] = ['low', 'some_concerns', 'high'];

function parseSqAnswer(raw: string | null): Rob2SqAnswer | null {
  if (raw === null) {
    return null;
  }
  const trimmed = raw.trim().toLowerCase();
  return (SQ_ANSWER_VALUES as readonly string[]).includes(trimmed) ? (trimmed as Rob2SqAnswer) : null;
}

function parseJudgementValue(raw: string | null): Rob2Judgement | null {
  if (raw === null) {
    return null;
  }
  const trimmed = raw.trim().toLowerCase();
  return (JUDGEMENT_VALUES as readonly string[]).includes(trimmed) ? (trimmed as Rob2Judgement) : null;
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
  suggestion: Rob2Judgement | null;
  /** セルの現在値（判定確定値 > AI 値）。judgement の enum 値として解釈できないときも null */
  currentValue: Rob2Judgement | null;
  /** suggestion・currentValue が共に存在し、値が食い違うか */
  mismatch: boolean;
  /** AI が値を出しているが人間の判定が 0 件（未検証）か */
  aiUnconfirmed: boolean;
}

function buildInfo(cell: VerificationCell, suggestion: Rob2Judgement | null): RobAlgorithmInfo {
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
 * RoB2 以外（ROBINS-I 等。PR2 以降で SQ 対応予定）の judgement セルは SQ 回答が存在しないため
 * suggestion は自然に null になり、aiUnconfirmed だけが有効に働く。
 * rob2 の軽量版・SQ 完全版が同一スキーマに混在する場合（field_name は同じだが通常はエディタの
 * 重複バリデーションで防止される組み合わせ）も、group 内の `_judgement` セルを漏れなく走査する
 */
export function collectRobAlgorithmInfo(model: TabModel): Map<string, RobAlgorithmInfo> {
  const result = new Map<string, RobAlgorithmInfo>();
  const domainCurrentValues = new Map<string, Rob2Judgement | null>();
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
      const isRob2Judgement = judgementCell.field.fieldName === ROB2_JUDGEMENT_FIELD_NAME;
      const info = buildInfo(judgementCell, isRob2Judgement ? sqSuggestion : null);
      result.set(info.cellKey, info);
      if (isRob2Judgement) {
        domainCurrentValues.set(parsed.domain, info.currentValue);
      }
    }
  }

  for (const cell of overallCells) {
    const isRob2Judgement = cell.field.fieldName === ROB2_JUDGEMENT_FIELD_NAME;
    const suggestion = isRob2Judgement
      ? judgeOverallRob2(ROB2_RCT_DOMAIN_IDS.map((id) => domainCurrentValues.get(id) ?? null))
      : null;
    const info = buildInfo(cell, suggestion);
    result.set(info.cellKey, info);
  }

  return result;
}
