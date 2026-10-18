import { normalizeText } from '../../../src/features/anchoring/normalizeText';
import type { GoldFile, GoldRow } from './validateGold';
import { isTableLikelyField } from './fieldSources';
import type { BenchmarkInputMode } from './config';

export interface RunItem {
  fieldId: string;
  entityKey: string;
  value: string | null;
  notReported: boolean;
  quote: string | null;
  anchor: { status: 'exact' | 'normalized' | 'fuzzy' | 'failed' } | null;
}

export interface ScorableRun {
  runId: string;
  model: string;
  inputMode: BenchmarkInputMode;
  pdfId: string;
  repeat: number;
  elapsedMs: number;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
  error: string | null;
  formatError: string | null;
  items: RunItem[];
}

export interface MetricSlice {
  rowCount: number;
  accuracy: number | null;
  accuracyNumeric: number | null;
  notReportedSensitivity: number | null;
  notReportedSpecificity: number | null;
  majorErrorRate: number | null;
}

export interface PerRunMetrics {
  runId: string;
  model: string;
  inputMode: BenchmarkInputMode;
  pdfId: string;
  repeat: number;
  failed: boolean;
  failureReason: string | null;
  overall: MetricSlice;
  tableLikely: MetricSlice;
  anchorSuccessRate: number | null;
  verbatimRate: number | null;
  costUsd: number | null;
  elapsedMs: number;
  tokensIn: number | null;
  tokensOut: number | null;
  missingGoldCount: number;
  extraAiCount: number;
}

function rounded(value: number | null): number | null {
  return value === null ? null : Math.round(value * 1e4) / 1e4;
}

function rowKey(fieldId: string, entityKey: string): string {
  return `${fieldId} ${entityKey}`;
}

export function matchesValue(aiValue: string | null, goldRow: GoldRow): boolean {
  if (aiValue === null) return false;
  const normalized = normalizeText(aiValue);
  if (goldRow.value_gold !== null && normalized === normalizeText(goldRow.value_gold)) return true;
  return (goldRow.acceptable_values ?? []).some((value) => normalized === normalizeText(value));
}

// 浮動小数点へ変換せず、符号・整数部・小数部を正規化する。
function decimalText(value: string | null): string | null {
  if (value === null) return null;
  let text = value.trim().replace(/(?<=\d)[·⋅](?=\d)/g, '.').replace(/^−/, '-');
  const sign = /^[+-]/.test(text) ? text[0]! : '';
  let unsigned = sign ? text.slice(1) : text;
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(unsigned)) unsigned = unsigned.replace(/,/g, '');
  text = sign + unsigned;
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(text)) return null;
  const [whole = '', fraction = ''] = unsigned.split('.');
  const integer = whole.replace(/^0+/, '') || '0';
  const decimals = fraction.replace(/0+$/, '');
  const magnitude = integer + (decimals ? '.' + decimals : '');
  return sign === '-' && magnitude !== '0' ? '-' + magnitude : magnitude;
}

/** 既存の文字列一致を保ち、数として読める値だけ表記差を除いた一致を返す。単位換算はしない。 */
export function matchesValueNumeric(aiValue: string | null, goldRow: GoldRow): boolean {
  if (matchesValue(aiValue, goldRow)) return true;
  const numeric = decimalText(aiValue);
  return numeric !== null && [goldRow.value_gold, ...(goldRow.acceptable_values ?? [])]
    .some((value) => decimalText(value) === numeric);
}

function computeSlice(rows: GoldRow[], itemsByKey: Map<string, RunItem>): MetricSlice {
  if (rows.length === 0) {
    return { rowCount: 0, accuracy: null, accuracyNumeric: null, notReportedSensitivity: null, notReportedSpecificity: null, majorErrorRate: null };
  }
  const reported = rows.filter((row) => !row.not_reported);
  const notReported = rows.filter((row) => row.not_reported);
  let correct = 0;
  let correctNumeric = 0;
  let nrTruePositive = 0;
  let nrTrueNegative = 0;
  let majorErrors = 0;
  for (const row of rows) {
    const item = itemsByKey.get(rowKey(row.field_id, row.entity_key));
    if (row.not_reported) {
      if (item?.notReported === true) {
        correct += 1;
        correctNumeric += 1;
        nrTruePositive += 1;
      }
    } else if (item?.notReported === false) {
      nrTrueNegative += 1;
      if (matchesValueNumeric(item.value, row)) correctNumeric += 1;
      if (matchesValue(item.value, row)) correct += 1;
      else if (item.value !== null) majorErrors += 1;
    }
  }
  return {
    rowCount: rows.length,
    accuracy: rounded(correct / rows.length),
    accuracyNumeric: rounded(correctNumeric / rows.length),
    notReportedSensitivity: rounded(notReported.length === 0 ? null : nrTruePositive / notReported.length),
    notReportedSpecificity: rounded(reported.length === 0 ? null : nrTrueNegative / reported.length),
    majorErrorRate: rounded(reported.length === 0 ? null : majorErrors / reported.length),
  };
}

export function computePerRunMetrics(run: ScorableRun, gold: GoldFile): PerRunMetrics {
  const itemsByKey = new Map(run.items.map((item) => [rowKey(item.fieldId, item.entityKey), item]));
  const quoted = run.items.filter((item) => item.quote !== null);
  const anchored = quoted.filter((item) => item.anchor !== null && item.anchor.status !== 'failed');
  const verbatim = quoted.filter(
    (item) => item.anchor?.status === 'exact' || item.anchor?.status === 'normalized',
  );
  const goldKeys = new Set(gold.rows.map((row) => rowKey(row.field_id, row.entity_key)));
  const itemKeys = new Set(run.items.map((item) => rowKey(item.fieldId, item.entityKey)));
  return {
    runId: run.runId,
    model: run.model,
    inputMode: run.inputMode,
    pdfId: run.pdfId,
    repeat: run.repeat,
    failed: run.error !== null || run.formatError !== null,
    failureReason: run.error ?? run.formatError,
    overall: computeSlice(gold.rows, itemsByKey),
    tableLikely: computeSlice(gold.rows.filter((row) => isTableLikelyField(row.field_id)), itemsByKey),
    anchorSuccessRate: rounded(quoted.length === 0 ? null : anchored.length / quoted.length),
    verbatimRate: rounded(quoted.length === 0 ? null : verbatim.length / quoted.length),
    costUsd: rounded(run.costUsd),
    elapsedMs: run.elapsedMs,
    tokensIn: run.tokensIn,
    tokensOut: run.tokensOut,
    missingGoldCount: [...goldKeys].filter((key) => !itemKeys.has(key)).length,
    extraAiCount: [...itemKeys].filter((key) => !goldKeys.has(key)).length,
  };
}

export function mean(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0 ? null : rounded(present.reduce((sum, value) => sum + value, 0) / present.length);
}
