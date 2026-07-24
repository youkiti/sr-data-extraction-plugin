// S9 ダッシュボードの集計（requirements.md §4.1 S9 / ui-states.md §3 `#/dashboard`。
// v0.10 フェーズ 3 = study 単位）。study × section の検証進捗マトリクスと、anchor 失敗率・
// not_reported 率を組み立てる。1 study の Evidence は配下の全文書ぶんを合算する。
// 進捗はセルモデル（cells.ts）基準 = 検証画面の進捗チップと同じ数え方（自分の判定のみ）
import type { Decision } from '../../domain/decision';
import type { Evidence } from '../../domain/evidence';
import type { ConfirmedArmStructure } from '../../domain/armStructure';
import type { SchemaField } from '../../domain/schemaField';
import { availableTabs, buildTabModel, type VerificationCell } from './cells';

/** 率の素材（分母 0 のときの「—」表示は view 側の責務） */
export interface RateCount {
  numerator: number;
  denominator: number;
}

/**
 * AI 精度の内訳（人の判定 = AI 出力への変更）。undo 反映後の現在セル状態基準で、
 * 判定済みセルを人の判定種別で分類する。未検証セルは母数に含めない。
 * - accept: AI 値を無修正で承認（AI 正解）
 * - edit: 人が AI 値を書き換え（AI 不正確）
 * - reject: 棄却（AI 誤り）
 * - notReported: 人が「報告なし」と判定（AI の過剰抽出）
 * 採用率 = accept / decided（率表示は view 側）
 */
export interface AccuracyBreakdown {
  accept: number;
  edit: number;
  reject: number;
  notReported: number;
  /** = accept + edit + reject + notReported（判定済みセル数） */
  decided: number;
}

/** マトリクス 1 セル = 1 study × 1 section の進捗 */
export interface DashboardSectionCell {
  section: string;
  decided: number;
  total: number;
  /** セルクリックのディープリンク先（セクション先頭セルの entity_key）。セル 0 件は null */
  entityKey: string | null;
}

/** マトリクス 1 行 = 1 study */
export interface DashboardRow {
  studyId: string;
  studyLabel: string;
  /** DashboardData.sections と同順。当該 study のスキーマにない section は null */
  cells: (DashboardSectionCell | null)[];
  progress: { decided: number; total: number };
  /** AI 精度の内訳（判定済みセルを人の判定種別で分類） */
  accuracy: AccuracyBreakdown;
  /** anchor 失敗率: 分子 = anchor_status = failed、分母 = anchor_status 非 null（アンカリング対象） */
  anchor: RateCount;
  /** not_reported 率: 分子 = not_reported = TRUE、分母 = Evidence 総数 */
  notReported: RateCount;
}

export interface DashboardData {
  /** マトリクスの列（section の和集合。タブ順 → field_index 順の登場順） */
  sections: string[];
  rows: DashboardRow[];
  totals: {
    progress: { decided: number; total: number };
    accuracy: AccuracyBreakdown;
    anchor: RateCount;
    notReported: RateCount;
  };
}

/** 1 study ぶんの集計素材（verifyService の検証対象と同じ束 + 自分の判定） */
export interface DashboardStudyInput {
  studyId: string;
  /** 表示ラベル（Studies 由来） */
  studyLabel: string;
  fields: readonly SchemaField[];
  /** study 配下の全文書ぶんの Evidence */
  evidence: readonly Evidence[];
  /** 自分の annotator 行への判定のみ（cells.ts と同じ契約） */
  ownDecisions: readonly Decision[];
  /** 自分が確定した群構成。確定 arm 由来の空セルも分母へ含める */
  armStructure?: ConfirmedArmStructure | null;
}

/** 検証フォームと同じ順（タブ順 → グループ順）で全セルを連結する */
function orderedCells(input: DashboardStudyInput): VerificationCell[] {
  return availableTabs(input.fields).flatMap(
    (tab) =>
      buildTabModel(tab, input.fields, input.evidence, input.ownDecisions, {
        armStructure: input.armStructure ?? null,
      }).cells,
  );
}

/** 当該 study のスキーマに登場する section（タブ順 → field_index 順の初出順） */
function documentSections(fields: readonly SchemaField[]): string[] {
  const sections: string[] = [];
  for (const tab of availableTabs(fields)) {
    const tabFields = fields
      .filter((field) => field.entityLevel === tab)
      .sort((a, b) => a.fieldIndex - b.fieldIndex);
    for (const field of tabFields) {
      if (!sections.includes(field.section)) {
        sections.push(field.section);
      }
    }
  }
  return sections;
}

/**
 * セルを AI 精度内訳（accept/edit/reject/notReported）へ算入してよいかを判定する
 * （PR #190 レビュー対応: study 単位の `aiExtractionStatus` フラグを廃止し、セル単位の
 * 判定へ置き換える）。算入条件:
 * - セルに AI Evidence が表示されている（`cell.evidence !== null`）。AI 根拠が無い
 *   手入力を「AI を修正した」と数えると automation bias の指標が汚染されるため除外する
 * - かつ、セルの現在判定（`cell.state.stack` 末尾 = 最新の有効判定）の `decidedAt` が、
 *   その Evidence を生んだ run（`cell.evidence.runId`）の `started_at` より後（文字列
 *   比較で厳密に大きい）。これにより「no_result（AI 抽出結果なし）の間に行った手入力が、
 *   再抽出成功後に study の status が 'extracted' に変わることで AI 精度へ混入する」事故を防ぐ
 *   （手入力時点ではまだ表示中の Evidence は存在せず、その判定は「AI 出力を見た上での判定」
 *   ではないため）。副次的に、再抽出で表示 run が変わったときも旧 run 時代の判定は
 *   算入対象から外れる
 * `started_at` が null の run（旧プロトコルで未記録）は「最古」扱いとして常に算入する
 * （後方互換）。runId が runStartedAt に無い場合も従来どおり算入する（防御的フォールバック。
 * composeEvidenceByStudy は完了 run の Evidence しか通さないため実際には到達しない）
 */
function isAiAccuracyEligible(
  cell: VerificationCell,
  runStartedAt: ReadonlyMap<string, string | null>,
): boolean {
  if (cell.evidence === null) {
    return false;
  }
  // 呼び出し元（buildRow）は status !== 'unverified' のセルだけを渡すため、
  // stack は必ず 1 件以上積まれている（cellState.ts の stateOfStack）
  const decision = cell.state.stack[cell.state.stack.length - 1] as Decision;
  const startedAt = runStartedAt.get(cell.evidence.runId) ?? null;
  if (startedAt === null) {
    return true;
  }
  return decision.decidedAt.localeCompare(startedAt) > 0;
}

function buildRow(
  input: DashboardStudyInput,
  sections: readonly string[],
  runStartedAt: ReadonlyMap<string, string | null>,
): DashboardRow {
  const own = documentSections(input.fields);
  const bySection = new Map<string, DashboardSectionCell>(
    own.map((section) => [section, { section, decided: 0, total: 0, entityKey: null }]),
  );
  let decided = 0;
  let total = 0;
  const accuracy: AccuracyBreakdown = {
    accept: 0,
    edit: 0,
    reject: 0,
    notReported: 0,
    decided: 0,
  };
  for (const cell of orderedCells(input)) {
    // セルはスキーマ項目から作られるため、その section は必ず bySection に存在する
    const entry = bySection.get(cell.field.section) as DashboardSectionCell;
    entry.total += 1;
    entry.entityKey = entry.entityKey ?? cell.entityKey;
    total += 1;
    const status = cell.state.status;
    if (status !== 'unverified') {
      entry.decided += 1;
      decided += 1;
      if (isAiAccuracyEligible(cell, runStartedAt)) {
        accuracy.decided += 1;
        if (status === 'not_reported') {
          accuracy.notReported += 1;
        } else {
          // status は accept / edit / reject のいずれか
          accuracy[status] += 1;
        }
      }
    }
  }
  const anchored = input.evidence.filter((item) => item.anchorStatus !== null);
  return {
    studyId: input.studyId,
    studyLabel: input.studyLabel,
    cells: sections.map((section) => bySection.get(section) ?? null),
    progress: { decided, total },
    accuracy,
    anchor: {
      numerator: anchored.filter((item) => item.anchorStatus === 'failed').length,
      denominator: anchored.length,
    },
    notReported: {
      numerator: input.evidence.filter((item) => item.notReported).length,
      denominator: input.evidence.length,
    },
  };
}

/**
 * ダッシュボードの表示データを組み立てる。
 * inputs は Evidence がある study のみ（verifyService の検証対象一覧と同じ母集団）。
 * runStartedAt は run_id → started_at（完了 run の ExtractionRuns 由来。旧プロトコルの
 * 未記録行は null）の全 study 共通 map（isAiAccuracyEligible が使う。field ごとに表示 run が
 * 異なりうるため study 単位ではなく run_id 単位で持つ）
 */
export function buildDashboard(
  inputs: readonly DashboardStudyInput[],
  runStartedAt: ReadonlyMap<string, string | null>,
): DashboardData {
  const sections: string[] = [];
  for (const input of inputs) {
    for (const section of documentSections(input.fields)) {
      if (!sections.includes(section)) {
        sections.push(section);
      }
    }
  }
  const rows = inputs.map((input) => buildRow(input, sections, runStartedAt));
  const totals = {
    progress: {
      decided: rows.reduce((sum, row) => sum + row.progress.decided, 0),
      total: rows.reduce((sum, row) => sum + row.progress.total, 0),
    },
    accuracy: {
      accept: rows.reduce((sum, row) => sum + row.accuracy.accept, 0),
      edit: rows.reduce((sum, row) => sum + row.accuracy.edit, 0),
      reject: rows.reduce((sum, row) => sum + row.accuracy.reject, 0),
      notReported: rows.reduce((sum, row) => sum + row.accuracy.notReported, 0),
      decided: rows.reduce((sum, row) => sum + row.accuracy.decided, 0),
    },
    anchor: {
      numerator: rows.reduce((sum, row) => sum + row.anchor.numerator, 0),
      denominator: rows.reduce((sum, row) => sum + row.anchor.denominator, 0),
    },
    notReported: {
      numerator: rows.reduce((sum, row) => sum + row.notReported.numerator, 0),
      denominator: rows.reduce((sum, row) => sum + row.notReported.denominator, 0),
    },
  };
  return { sections, rows, totals };
}
