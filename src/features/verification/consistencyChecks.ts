// 決定論的な数値整合性チェック（issue #65）。
// AI と人間は同じ表を同じに読み違えうる（誤りが相関する）ため、LLM を一切使わない
// 純ロジックの機械的整合性チェックを「第 3 の独立検証系」として効かせる。
// 数値制約（events ≤ total 等）に違反するセルへ検証画面でバッジ表示するだけの情報提示であり、
// 判定操作を増やしたりブロックしたりはしない（automation bias 対策の既存動作は不変更）。
//
// --- 許容幅の設計（報告精度の区間演算方式）------------------------------------
// 報告値はその報告精度へ丸められた値であるため、報告どおりの数値をそのまま比較すると
// 丸めに起因する見かけの矛盾（例: 平均 5.15 が四捨五入で "5.2"、CI 下限が四捨五入で
// "5.1" となり、本来矛盾しない 2 値が字面上だけ矛盾して見える）を誤検出してしまう。
// これを原理的に排除するため、値を「真値の区間」として扱う区間演算を採用する:
//   - dataType === 'float' のフィールド値 v（小数 d 桁で報告）は
//     真値区間 [v − 0.5×10⁻ᵈ, v + 0.5×10⁻ᵈ] として扱う
//     （例: "5.2" → [5.15, 5.25]、"12" → [11.5, 12.5]）
//   - dataType === 'integer' のフィールド（イベント数・例数などの計数値）は
//     丸めのない正確値として扱う（区間幅 0）
//   - 制約 a ≤ b の違反は「区間同士でも矛盾する場合のみ」= lo(a) > hi(b) のときだけ警告する。
//     丸めで説明できる見かけの矛盾は警告しない（誤検出を原理的に排除する設計）
import { NOT_REPORTED_TOKEN } from '../../domain/annotation';
import type { FieldDataType } from '../../domain/schemaField';
import type { CellGroup, TabModel, VerificationCell } from './cells';

/** 1 件の整合性チェック違反。関与した全セルの cellKey へ同じメッセージが付く */
export interface ConsistencyWarning {
  cellKey: string;
  message: string;
}

/** 真値区間 [lo, hi]。dataType === 'integer' は lo === hi（丸めなし） */
interface Interval {
  lo: number;
  hi: number;
}

/** trim 後にこの形式へ完全一致する文字列だけを数値として扱う（誤検出防止。指数表記・範囲表記等は対象外） */
const NUMERIC_PATTERN = /^[+-]?\d+(\.\d+)?$/;

/** 数値解決済みのフィールド（cell 本体 + 表示用の値 + 比較用の区間） */
interface ResolvedField {
  cell: VerificationCell;
  /** メッセージ表示用のフィールドラベル（cell.field.fieldLabel） */
  label: string;
  /** メッセージ表示用の生値（trim 済み・報告どおりの文字列） */
  raw: string;
  /** 正確な数値（C7 の厳密比較・C2 の n ≥ 2 判定に使う） */
  value: number;
  interval: Interval;
}

/**
 * セルの現在値を解決する（判定確定値 > AI 抽出値。focusUnits.ts の resolvedCellValue と同じ優先順）。
 * null・NOT_REPORTED_TOKEN は「値なし」として扱う
 */
function resolveCellRawValue(cell: VerificationCell): string | null {
  const raw = cell.state.value ?? cell.evidence?.value ?? null;
  if (raw === null || raw === NOT_REPORTED_TOKEN) {
    return null;
  }
  return raw;
}

/** 数値 value の真値区間を dataType に応じて算出する（integer は幅 0） */
function toInterval(value: number, raw: string, dataType: FieldDataType): Interval {
  if (dataType === 'integer') {
    return { lo: value, hi: value };
  }
  const dotIndex = raw.indexOf('.');
  const decimals = dotIndex === -1 ? 0 : raw.length - dotIndex - 1;
  const halfUnit = 0.5 * 10 ** -decimals;
  return { lo: value - halfUnit, hi: value + halfUnit };
}

/**
 * group から field_name 完全一致でセルを探し、値を解決する（focusUnits.ts の
 * CONTINUOUS_SUMMARY_FIELDS と同じ「field_name 完全一致」方式）。
 * セル不在・値なし・数値としてパース不能（テキスト・指数表記等）のいずれも null
 */
function resolveField(group: CellGroup, fieldName: string): ResolvedField | null {
  const cell = group.cells.find((candidate) => candidate.field.fieldName === fieldName);
  if (cell === undefined) {
    return null;
  }
  const raw = resolveCellRawValue(cell);
  if (raw === null) {
    return null;
  }
  const trimmed = raw.trim();
  if (!NUMERIC_PATTERN.test(trimmed)) {
    return null;
  }
  const value = Number(trimmed);
  return {
    cell,
    label: cell.field.fieldLabel,
    raw: trimmed,
    value,
    interval: toInterval(value, trimmed, cell.field.dataType),
  };
}

/** a・b の両方に同じメッセージの警告を付与する（1 つの違反 = 関与した全セルへ同じメッセージ） */
function pushPairWarning(
  warnings: ConsistencyWarning[],
  a: ResolvedField,
  b: ResolvedField,
  message: string,
): void {
  warnings.push({ cellKey: a.cell.cellKey, message });
  warnings.push({ cellKey: b.cell.cellKey, message });
}

/** a ≤ b の違反（lo(a) > hi(b)）だけを警告する。a・b のどちらかが未解決なら何もしない */
function checkLe(warnings: ConsistencyWarning[], a: ResolvedField | null, b: ResolvedField | null): void {
  if (a === null || b === null) {
    return;
  }
  if (a.interval.lo > b.interval.hi) {
    pushPairWarning(warnings, a, b, `${a.label} (${a.raw}) が${b.label} (${b.raw}) を超えています`);
  }
}

/** field ≥ 0 の違反（区間の hi < 0）だけを警告する */
function checkNonNegative(warnings: ConsistencyWarning[], field: ResolvedField | null): void {
  if (field === null) {
    return;
  }
  if (field.interval.hi < 0) {
    warnings.push({ cellKey: field.cell.cellKey, message: `${field.label} (${field.raw}) が負の値です` });
  }
}

/**
 * 1 entity インスタンス（CellGroup）内の整合性チェック。関与する値が全て存在・
 * パース可能なときだけ各ルールを適用する（値なし・非数値・フィールド不在は自動的にスキップされる）
 */
export function checkGroupConsistency(group: CellGroup): ConsistencyWarning[] {
  const warnings: ConsistencyWarning[] = [];

  // 二値プリセット（outcomeTemplates.ts OUTCOME_TEMPLATE_BINARY）
  const events = resolveField(group, 'outcome_events');
  const total = resolveField(group, 'outcome_total');
  // 連続プリセット（同 OUTCOME_TEMPLATE_CONTINUOUS）
  const mean = resolveField(group, 'outcome_mean');
  const sd = resolveField(group, 'outcome_sd');
  const se = resolveField(group, 'outcome_se');
  const ciLower = resolveField(group, 'outcome_ci_lower');
  const ciUpper = resolveField(group, 'outcome_ci_upper');
  const ciLevel = resolveField(group, 'outcome_ci_level');
  const median = resolveField(group, 'outcome_median');
  const q1 = resolveField(group, 'outcome_q1');
  const q3 = resolveField(group, 'outcome_q3');
  const min = resolveField(group, 'outcome_min');
  const max = resolveField(group, 'outcome_max');
  const n = resolveField(group, 'outcome_n');

  // B1: events ≤ total
  checkLe(warnings, events, total);
  // B2: events ≥ 0、total ≥ 0
  checkNonNegative(warnings, events);
  checkNonNegative(warnings, total);

  // C1: sd ≥ 0、se ≥ 0、n ≥ 0
  checkNonNegative(warnings, sd);
  checkNonNegative(warnings, se);
  checkNonNegative(warnings, n);

  // C2: se < sd（n が存在して n ≥ 2 のときのみ。数学的に SE = SD/√n < SD。
  // 違反 = lo(se) > hi(sd)。丸めで説明できる境界一致（例: sd=1.0, se=1.05）は警告しない）
  if (se !== null && sd !== null && n !== null && n.value >= 2 && se.interval.lo > sd.interval.hi) {
    pushPairWarning(
      warnings,
      se,
      sd,
      `標準誤差 (${se.raw}) が標準偏差 (${sd.raw}) 以上です（n=${n.raw} のとき標準誤差は標準偏差より小さくなるはずです）`,
    );
  }

  // C3: ci_lower ≤ ci_upper
  checkLe(warnings, ciLower, ciUpper);

  // C4: ci_lower ≤ mean ≤ ci_upper（3 値そろったときだけ適用）
  if (ciLower !== null && mean !== null && ciUpper !== null) {
    checkLe(warnings, ciLower, mean);
    checkLe(warnings, mean, ciUpper);
  }

  // C5: q1 ≤ median ≤ q3（3 値そろったときだけ適用）
  if (q1 !== null && median !== null && q3 !== null) {
    checkLe(warnings, q1, median);
    checkLe(warnings, median, q3);
  }

  // C6: min ≤ q1、q3 ≤ max（各 2 値のみで判定）+
  //     min ≤ median ≤ max、min ≤ mean ≤ max（各 3 値そろったときだけ適用）+ min ≤ max
  checkLe(warnings, min, q1);
  checkLe(warnings, q3, max);
  if (min !== null && median !== null && max !== null) {
    checkLe(warnings, min, median);
    checkLe(warnings, median, max);
  }
  if (min !== null && mean !== null && max !== null) {
    checkLe(warnings, min, mean);
    checkLe(warnings, mean, max);
  }
  checkLe(warnings, min, max);

  // C7: 0 < ci_level < 100（正確値比較でよい。区間演算は不要）
  if (ciLevel !== null && (ciLevel.value <= 0 || ciLevel.value >= 100)) {
    warnings.push({
      cellKey: ciLevel.cell.cellKey,
      message: `${ciLevel.label} (${ciLevel.raw}) は 0 〜 100 の範囲で報告してください`,
    });
  }

  return warnings;
}

/**
 * タブ全体の警告を cellKey → メッセージ列へ集約する（UI 配線用）。
 * study / arm / rob_domain タブは対象フィールド名（outcome_* プリセット）を持たないため
 * 自然に空になる（entity_level での絞り込みは不要 — field_name 完全一致方式のため）
 */
export function collectConsistencyWarnings(model: TabModel): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const group of model.groups) {
    for (const warning of checkGroupConsistency(group)) {
      const messages = result.get(warning.cellKey);
      if (messages === undefined) {
        result.set(warning.cellKey, [warning.message]);
      } else {
        messages.push(warning.message);
      }
    }
  }
  return result;
}
