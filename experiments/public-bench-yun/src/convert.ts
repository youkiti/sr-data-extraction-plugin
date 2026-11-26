import path from 'node:path';
import { parseEntityKey } from '../../../src/utils/entityKey';
import { quantile } from '../../cochrane-numeric-benchmark/src/bootstrap';
import { listCostUsd, reportCostUsd } from '../../cochrane-numeric-benchmark/src/cost';
import { readOptional } from '../../cochrane-numeric-benchmark/src/io';
import { assertRunLedger, type LedgerEntry } from '../../cochrane-numeric-benchmark/src/ledger';
import { runIdFor } from '../../cochrane-numeric-benchmark/src/resume';
import type { RunRecord, ScoringItem } from './runner';
import type { Ico, Study } from './dataset';

export const TASK_FIELDS = {
  binary: ['intervention_events', 'intervention_group_size', 'comparator_events', 'comparator_group_size'],
  continuous: ['intervention_mean', 'intervention_standard_deviation', 'intervention_group_size',
    'comparator_mean', 'comparator_standard_deviation', 'comparator_group_size'],
} as const;
export type UpstreamValue = number | string;
export type State = 'value' | 'multiple_values' | 'not_reported' | 'not_returned' | 'run_failed';
export interface ConvertedField { value: UpstreamValue; valueNoComma: UpstreamValue; raw: string | null; state: State }
export interface ConvertedIco { id: number; pmcid: number; outcomeType: Ico['outcome_type']; fields: Record<string, ConvertedField> }
export type ScoreRun = Pick<RunRecord, 'outcome' | 'items'>;
function numericValue(text: string, comma: boolean): UpstreamValue {
  const original = text.trim();
  let value = original.replace(/^[−－]/, '-');
  const sign = /^[+-]/.test(value) ? value[0]! : '';
  let unsigned = sign ? value.slice(1) : value;
  if (comma && /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(unsigned)) unsigned = unsigned.replace(/,/g, '');
  value = sign + unsigned;
  return /^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(value) ? Number(value) : original;
}
export const toUpstreamValue = (text: string): UpstreamValue => numericValue(text, true);
export const toUpstreamValueNoComma = (text: string): UpstreamValue => numericValue(text, false);
export function candidatesFor(field: string, outcomeId: string, items: ScoringItem[]): ScoringItem[] {
  return items.filter((item) => {
    const parsed = parseEntityKey(item.entityKey);
    return item.fieldId === field && parsed?.level === 'outcome_result' && parsed.outcome === outcomeId;
  });
}
export function convertField(field: string, outcomeId: string, run: ScoreRun | null): ConvertedField {
  if (!run) throw new Error('未実行の run があります。全 run が揃うまで変換できません');
  const sentinel = (value: string, state: State): ConvertedField => ({ value, valueNoComma: value, raw: null, state });
  if (run.outcome !== 'ok') return sentinel('__run_failed__', 'run_failed');
  const candidates = candidatesFor(field, outcomeId, run.items);
  const values = candidates.filter((item) => !item.notReported && item.value !== null && item.value.trim() !== '').map((item) => item.value!);
  const distinct = [...new Set(values.map(toUpstreamValue))];
  if (!distinct.length) return sentinel('x', candidates.some((item) => item.notReported) ? 'not_reported' : 'not_returned');
  if (distinct.length > 1) return sentinel('__multiple_values__', 'multiple_values');
  // カンマ無しの反実仮想でも、候補全体の重複・競合を判定する。
  const noComma = [...new Set(values.map(toUpstreamValueNoComma))];
  return { value: distinct[0]!, valueNoComma: noComma.length === 1 ? noComma[0]! : '__multiple_values__', raw: values[0]!, state: 'value' };
}
export function convertStudies(studies: Study[], runs: Map<string, ScoreRun>): ConvertedIco[] {
  return studies.flatMap((study) => study.icos.map((ico) => ({ id: ico.id, pmcid: study.pmcid, outcomeType: ico.outcome_type,
    fields: Object.fromEntries(TASK_FIELDS[ico.outcome_type].map((field) => [field, convertField(field, ico.outcomeId, runs.get(study.studyKey) ?? null)])),
  })));
}
export async function loadRuns(dir: string, model: string, studies: Study[], ledger: LedgerEntry[], version: number): Promise<RunRecord[]> {
  const runs: RunRecord[] = [];
  for (const study of studies) {
    const id = runIdFor(model, study.studyKey);
    const run = await readOptional<RunRecord>(path.join(dir, `${id}.json`));
    if (!run) throw new Error(`未実行の run があります: ${id}`);
    if (run.runId !== id || run.model !== model || run.studyKey !== study.studyKey || run.promptVersion !== version ||
      !['ok', 'format_error', 'request_failed'].includes(run.outcome) || !Array.isArray(run.items)) throw new Error(`run の形式・識別子・プロンプト版数が不正です: ${id}`);
    assertRunLedger([id], ledger);
    runs.push(run);
  }
  return runs;
}
const ratio = (n: number, d: number) => d ? n / d : null;
export function secondaryMetrics(model: string, studies: Study[], runs: RunRecord[], ledger: LedgerEntry[]) {
  const ids = new Set(runs.map((run) => run.runId));
  const attempts = ledger.filter((line) => ids.has(line.runId));
  const sum = (get: (line: LedgerEntry) => number) => attempts.reduce((n, line) => n + get(line), 0);
  const elapsed = runs.filter((run) => run.outcome === 'ok').map((run) => run.elapsedMs);
  const quoted = new Set(studies.flatMap((study) => {
    const run = runs.find((entry) => entry.studyKey === study.studyKey)!;
    return study.icos.flatMap((ico) => TASK_FIELDS[ico.outcome_type].flatMap((field) =>
      candidatesFor(field, ico.outcomeId, run.items).filter((item) => !item.notReported && item.quote?.trim())));
  }));
  const subscription = model === 'gpt-6.2-sol';
  const costs = (get: (line: LedgerEntry) => number) => subscription ? null : { total: sum(get), perRctMean: ratio(sum(get), runs.length) };
  const tokens = (key: 'tokensIn' | 'tokensOut') => ({ total: sum((line) => line[key]), perRctMean: ratio(sum((line) => line[key]), runs.length) });
  // 渡したアウトカムの ID（o<k>）以外のキーで返した項目は採点で対応付かない（未返答に数える）。件数だけを残す。
  const returnedItems = studies.flatMap((study) => {
    const run = runs.find((entry) => entry.studyKey === study.studyKey)!;
    const listed = new Set(study.icos.map((ico) => ico.outcomeId));
    return run.items.map((item) => { const parsed = parseEntityKey(item.entityKey);
      return parsed?.level === 'outcome_result' && listed.has(parsed.outcome); });
  });
  return {
    items: { total: returnedItems.length, unlistedOutcome: returnedItems.filter((listed) => !listed).length },
    runs: { total: runs.length, ...Object.fromEntries(['ok', 'format_error', 'request_failed'].map((state) => [state, runs.filter((r) => r.outcome === state).length])),
      failureRate: ratio(runs.filter((r) => r.outcome !== 'ok').length, runs.length) },
    attempts: { total: attempts.length, retries: attempts.filter((line) => line.attempt > 1).length,
      byFailureClass: Object.fromEntries(['null', 'rate_limit', 'server_error', 'network', 'timeout', 'output_limit', 'retryable_flag', 'other'].map((kind) => [kind, attempts.filter((line) => String(line.failureClass ?? null) === kind).length])) },
    elapsed: { mean: ratio(elapsed.reduce((n, ms) => n + ms, 0), elapsed.length), median: quantile(elapsed, 0.5), totalLedger: sum((line) => line.elapsedMs) },
    tokens: { tokensIn: tokens('tokensIn'), tokensOut: tokens('tokensOut') },
    cost: { reportCostUsd: costs((line) => reportCostUsd(model, line.tokensIn, line.tokensOut, line.cachedTokensIn, Date.parse(line.attemptAt))),
      listCostUsd: costs((line) => listCostUsd(model, line.tokensIn, line.tokensOut)), ...(subscription ? { costNote: 'subscription_not_computable' } : {}) },
    quotes: { total: quoted.size, byAnchorStatus: Object.fromEntries(['exact', 'normalized', 'fuzzy', 'segments', 'failed', 'null'].map((status) =>
      [status, [...quoted].filter((item) => String(item.anchorStatus) === status).length])),
      nonFailedRate: ratio([...quoted].filter((item) => item.anchorStatus !== 'failed').length, quoted.size),
      successRate: ratio([...quoted].filter((item) => item.anchorStatus !== null && item.anchorStatus !== 'failed').length, quoted.size) },
  };
}
