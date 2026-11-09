// issue #383: ダッシュボードで独立比較と、種類別の最終値比較を表示する。
// 定義の正典は docs/requirements.md §8「AI と人の比較（issue #383）」。
import { summarizeComparison, type ComparisonGroup, type ComparisonSummary } from '../../features/verification/aiHumanComparison';
import { t, type MessageKey } from '../../lib/i18n';
import type { DashboardState } from '../store';
import { el } from '../ui/dom';
import { headingWithHelp } from '../ui/helpButton';
import type { DashboardViewCallbacks } from './types';

const GROUPS: readonly ComparisonGroup[] = ['independent', 'consensus', 'human_independent', 'human_with_ai'];
const GROUP_LABELS: Record<ComparisonGroup, MessageKey> = {
  independent: 'dashboard.compareIndependent', consensus: 'dashboard.compareConsensus',
  human_independent: 'dashboard.compareFinalIndependent', human_with_ai: 'dashboard.compareAssisted',
};
const LEVEL_LABELS = {
  study: 'verify.tabStudy',
  arm: 'verify.tabArm',
  outcome_result: 'verify.tabOutcome',
  rob_domain: 'verify.tabRob',
} as const;

function percent(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`;
}

function renderTable(rows: readonly ComparisonSummary[], group: ComparisonGroup): HTMLElement {
  const headings: MessageKey[] = ['dashboard.compareScope', 'dashboard.compareDenominator', 'dashboard.compareMatch',
    'dashboard.compareWrong', 'dashboard.compareFabrication', 'dashboard.compareOmission', 'dashboard.compareIncomparable',
    'dashboard.compareHumanUnjudged', 'dashboard.compareNotExtracted', 'dashboard.compareMissingQuote'];
  return el('div', { className: 'dashboard__compare-scroll', attributes: { 'data-preserve-scroll': `ai-compare-${group}` } }, [
    el('table', { className: 'dashboard__matrix' }, [
      el('thead', {}, [el('tr', {}, headings.map((key) => el('th', { text: t(key), attributes: { scope: 'col' } })))]),
      el('tbody', {}, rows.map((row) => el('tr', {}, [
        el('th', { text: row.entityLevel === null ? t('dashboard.compareOverall')
          : row.fieldId === null ? t(LEVEL_LABELS[row.entityLevel]) : `${t(LEVEL_LABELS[row.entityLevel])}: ${row.fieldLabel}`,
        attributes: { scope: 'row' } }),
        ...[String(row.compared), `${row.match} (${percent(row.accuracy)})`, `${row.misclassification} (${percent(row.misclassificationProportion)})`,
          `${row.false_positive} (${percent(row.falsePositiveProportion)})`, `${row.false_negative} (${percent(row.falseNegativeProportion)})`,
          String(row.incomparable), String(row.humanUnjudged), String(row.aiNotExtracted), String(row.missingQuote)]
          .map((text) => el('td', { text })),
      ]))),
    ]),
  ]);
}

export function renderDashboardComparison(
  comparison: DashboardState['comparison'], ctx: DashboardViewCallbacks,
): HTMLElement {
  const calculate = el('button', { id: 'dashboard-ai-compare-calculate', text: t('dashboard.compareCalculate'),
    attributes: { type: 'button' } });
  calculate.disabled = comparison.loading;
  calculate.addEventListener('click', () => ctx.onCalculateComparison());
  const children = [headingWithHelp('h3', t('dashboard.compareTitle'), 'aiCompare'),
    el('p', { text: t('dashboard.compareDescription') }), calculate];
  if (comparison.loading) {
    children.push(el('p', { id: 'dashboard-ai-compare-loading', text: t('dashboard.compareLoading'), attributes: { role: 'status' } }));
  } else if (comparison.error !== null) {
    children.push(el('p', { id: 'dashboard-ai-compare-error', text: comparison.error, attributes: { role: 'alert' } }));
  } else if (comparison.data !== null) {
    const report = comparison.data;
    children.push(el('p', { text: t('dashboard.compareStudies', {
      unextracted: report.unextractedStudyIds.length, noFinal: report.noFinalStudyIds.length,
    }) }));
    const summary = summarizeComparison(report.cells);
    if (!summary.some((row) => row.compared > 0)) {
      children.push(el('p', { id: 'dashboard-ai-compare-empty', text: t('dashboard.compareEmpty') }));
    } else {
      for (const group of GROUPS) {
        const rows = summary.filter((row) => row.group === group);
        children.push(el('h4', { text: t(GROUP_LABELS[group]) }));
        if (group === 'human_with_ai') {
          children.push(el('p', { text: t('dashboard.compareAssistedNote') }));
        }
        children.push(rows.length === 0 ? el('p', { text: t('dashboard.compareEmpty') }) : renderTable(rows, group));
      }
    }
    for (const kind of ['summary', 'cells'] as const) {
      const button = el('button', { id: `dashboard-ai-compare-${kind}-csv`,
        text: t(kind === 'summary' ? 'dashboard.compareSummaryCsv' : 'dashboard.compareCellsCsv'), attributes: { type: 'button' } });
      button.addEventListener('click', () => ctx.onDownloadComparisonCsv(kind));
      children.push(button);
    }
  }
  return el('section', { id: 'dashboard-ai-compare' }, children);
}
