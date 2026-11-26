import { normalizeText } from '../../../src/features/anchoring/normalizeText';
import { parseEntityKey } from '../../../src/utils/entityKey';
import type { EvalValue } from './evaluationSet';
import type { ScoringItem, RunRecord } from './runner';
import type { LedgerEntry } from './ledger';
import { listCostUsd, reportCostUsd } from './cost';
import { MODELS } from './config';

// extraction-benchmark-real/src/metrics.ts の decimalText をそのまま移植。
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
export function matchesGold(ai: string, gold: string): boolean {
  return normalizeText(ai) === normalizeText(gold) || (decimalText(ai) !== null && decimalText(ai) === decimalText(gold));
}
export type AnswerState = 'run_missing' | 'run_failed' | 'not_returned' | 'not_reported' | 'multiple_values' | 'match' | 'wrong_value';
export interface Answer { state: AnswerState; value: string | null; candidates: ScoringItem[] }
export type ScoreRun = Pick<RunRecord, 'outcome' | 'items'>;
export function candidatesFor(value: EvalValue, items: ScoringItem[]): ScoringItem[] {
  return items.filter((item) => {
    const parsed = parseEntityKey(item.entityKey);
    return item.fieldId === value.field && parsed?.level === 'outcome_result' && parsed.outcome === `o${value.itemIndex}`;
  });
}
export function answerState(value: EvalValue, run: ScoreRun | null): Answer {
  const candidates = run ? candidatesFor(value, run.items) : [];
  const answer = (state: AnswerState, text: string | null = null): Answer => ({ state, value: text, candidates });
  if (!run) return answer('run_missing');
  if (run.outcome !== 'ok') return answer('run_failed');
  const values = candidates.filter((item) => !item.notReported && item.value !== null && item.value.trim() !== '').map((item) => item.value!);
  const distinct = values.filter((text, i) => !values.slice(0, i).some((previous) => matchesGold(text, previous)));
  if (!distinct.length) return answer(candidates.some((item) => item.notReported) ? 'not_reported' : 'not_returned');
  if (distinct.length > 1) return answer('multiple_values');
  return answer(matchesGold(distinct[0]!, value.gold) ? 'match' : 'wrong_value', distinct[0]!);
}
export function errorCategory(value: EvalValue, answer: Answer, values: EvalValue[]): string | null {
  if (value.label !== 'reported' || answer.state === 'match') return null;
  if (answer.state === 'run_failed') return '0_run_failed';
  if (answer.state === 'not_reported') return '1_not_reported';
  if (answer.state === 'not_returned') return '1_not_returned';
  if (answer.state === 'multiple_values') return '4_multiple_values';
  const sameStudy = values.filter((other) => other.studyKey === value.studyKey && other.valueKind === value.valueKind);
  if (answer.value !== null && sameStudy.some((other) => other.itemIndex === value.itemIndex && other.group !== value.group && matchesGold(answer.value!, other.gold))) return '2_group';
  if (answer.value !== null && sameStudy.some((other) => other.itemIndex !== value.itemIndex && other.group === value.group && matchesGold(answer.value!, other.gold))) return '3_item';
  return '4_other';
}
export interface ScoredValue extends EvalValue { answer: Answer; errorCategory: string | null }
export function scoreValues(values: EvalValue[], runs: Map<string, ScoreRun>): ScoredValue[] {
  return values.map((value) => {
    const answer = answerState(value, runs.get(value.studyKey) ?? null);
    return { ...value, answer, errorCategory: errorCategory(value, answer, values) };
  });
}
const ratio = (n: number, d: number) => d ? n / d : null;
const mean = (numbers: number[]) => ratio(numbers.reduce((a, b) => a + b, 0), numbers.length);
const median = (numbers: number[]) => {
  const sorted = [...numbers].sort((a, b) => a - b);
  return sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)]! + sorted[Math.floor(sorted.length / 2)]!) / 2 : null;
};
export function sensitivity(rows: ScoredValue[]) {
  const reviews = [...new Set(rows.map((row) => row.reviewId))].sort();
  const perReview = reviews.map((reviewId) => {
    const reported = rows.filter((row) => row.reviewId === reviewId && row.label === 'reported');
    return { reviewId, reported: reported.length, matched: reported.filter((row) => row.answer.state === 'match').length };
  });
  const eligible = perReview.filter((review) => review.reported > 0);
  return { primary: mean(eligible.map((review) => review.matched / review.reported)), reviewsUsed: eligible.length,
    zeroReportedReviews: perReview.filter((review) => !review.reported).map((review) => review.reviewId), perReview,
    micro: ratio(eligible.reduce((n, r) => n + r.matched, 0), eligible.reduce((n, r) => n + r.reported, 0)),
    values: rows.length, reported: perReview.reduce((n, r) => n + r.reported, 0) };
}
export function metrics(rows: ScoredValue[], runs: RunRecord[], ledger: LedgerEntry[]) {
  const reported = rows.filter((row) => row.label === 'reported');
  const absent = rows.filter((row) => row.label === 'not_in_documents');
  const derivable = rows.filter((row) => row.label === 'derivable');
  const count = (set: ScoredValue[], states: AnswerState[]) => set.filter((row) => states.includes(row.answer.state)).length;
  const quoted = new Set(rows.flatMap((row) => row.answer.candidates.filter((item) => item.quote?.trim())));
  const elapsed = runs.filter((run) => run.outcome !== 'request_failed').map((run) => run.elapsedMs).sort((a, b) => a - b);
  const runIds = new Set(runs.map((run) => run.runId));
  const attempts = ledger.filter((entry) => runIds.has(entry.runId));
  const measured = attempts.filter((entry) => entry.costBasis === 'measured' || entry.costBasis === 'measured_failure');
  const subscription = [...runs, ...attempts].some((run) => MODELS.some((model) => model.id === run.model && !('keyEnv' in model)));
  const elapsedRequests = attempts.map((entry) => entry.elapsedMs);
  const failureClasses = Object.fromEntries(['null', 'rate_limit', 'server_error', 'network', 'timeout', 'output_limit', 'retryable_flag', 'other'].map((kind) =>
    [kind, attempts.filter((entry) => String(entry.failureClass ?? null) === kind).length]));
  const breakdown: Record<string, number> = {};
  for (const row of rows) if (row.errorCategory) breakdown[row.errorCategory] = (breakdown[row.errorCategory] ?? 0) + 1;
  const strata: Record<string, Record<string, ReturnType<typeof sensitivity>>> = {};
  for (const key of ['tier', 'dataType', 'valueKind', 'provenance', 'figureOnly', 'relabelled'] as const) {
    const stratum = (row: ScoredValue) => String(key === 'relabelled' ? row.relabelled ?? false : row[key]);
    strata[key] = Object.fromEntries([...new Set(rows.map(stratum))].sort().map((value) =>
      [value, sensitivity(rows.filter((row) => stratum(row) === value))]));
  }
  return { ...sensitivity(rows), wrongValueRate: ratio(count(reported, ['wrong_value', 'multiple_values']), reported.length),
    notReportedMissRate: ratio(count(reported, ['not_reported']), reported.length), notReturnedRate: ratio(count(reported, ['not_returned']), reported.length),
    answerRateNotInDocuments: ratio(count(absent, ['match', 'wrong_value', 'multiple_values']), absent.length),
    accuracy: ratio(count(reported, ['match']) + count(absent, ['not_reported']), reported.length + absent.length),
    notReturnedNotInDocuments: count(absent, ['not_returned']),
    derivableMatch: ratio(count(derivable, ['match']), derivable.length), goldMatch: ratio(count(rows, ['match']), rows.length),
    differentValueCount: rows.filter((row) => row.label === 'different_value').length,
    anchorSuccessRate: ratio([...quoted].filter((item) => item.anchorStatus !== null && item.anchorStatus !== 'failed').length, quoted.size),
    reportCostPerStudy: subscription ? null : ratio(attempts.reduce((n, entry) => n + reportCostUsd(entry.model, entry.tokensIn, entry.tokensOut, entry.cachedTokensIn, Date.parse(entry.attemptAt)), 0), runs.length),
    listCostPerStudy: subscription ? null : ratio(attempts.reduce((n, entry) => n + listCostUsd(entry.model, entry.tokensIn, entry.tokensOut), 0), runs.length),
    ...(subscription ? { costNote: 'subscription_not_computable' } : {}),
    tokensInPerStudy: ratio(measured.reduce((n, entry) => n + entry.tokensIn, 0), runs.length),
    tokensOutPerStudy: ratio(measured.reduce((n, entry) => n + entry.tokensOut, 0), runs.length),
    tokensUnmeasuredAttempts: attempts.length - measured.length,
    thoughtsTokensPerStudy: mean(runs.flatMap((run) => typeof run.thoughtsTokens === 'number' ? [run.thoughtsTokens] : [])),
    elapsedMsSuccessfulRunMean: mean(elapsed), elapsedMsSuccessfulRunMedian: median(elapsed),
    elapsedMsPerRequestMean: mean(elapsedRequests), elapsedMsPerRequestMedian: median(elapsedRequests),
    failureClasses, retries: attempts.filter((entry) => entry.attempt > 1).length,
    failedRuns: runs.filter((run) => run.outcome !== 'ok').length, runCount: runs.length,
    failedRunRate: ratio(runs.filter((run) => run.outcome !== 'ok').length, runs.length), breakdown, strata };
}
