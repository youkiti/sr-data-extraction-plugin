// 進捗表示と独立した費用・予算カード。呼び出し側が owner のみに表示する。
import type { UsageSummary } from '../../features/usage/aggregateUsage';
import { t, type MessageKey } from '../../lib/i18n';
import type { DashboardState } from '../store';
import { el } from '../ui/dom';
import { headingWithHelp } from '../ui/helpButton';
import type { DashboardViewCallbacks } from './types';

function usd(value: number | null): string {
  return value === null
    ? t('dashboard.usageUnavailable')
    : t('dashboard.usageUsd', { value: value.toFixed(4) });
}

function table(
  id: string,
  title: string,
  headers: string[],
  rows: (string | HTMLElement)[][],
): HTMLElement {
  if (rows.length === 0) {
    return el('p', { id, text: t('dashboard.usageNoCalls', { axis: title }) });
  }
  return el('div', { className: 'dashboard__usage-table-wrap' }, [
    el('table', { id, className: 'dashboard__matrix' }, [
      el('caption', { className: 'dashboard__matrix-caption', text: title }),
      el('thead', {}, [
        el(
          'tr',
          {},
          headers.map((text) => el('th', { text, attributes: { scope: 'col' } })),
        ),
      ]),
      el(
        'tbody',
        {},
        rows.map((row) =>
          el(
            'tr',
            {},
            row.map((value) =>
              typeof value === 'string' ? el('td', { text: value }) : el('td', {}, [value]),
            ),
          ),
        ),
      ),
    ]),
  ]);
}

function renderSummary(summary: UsageSummary): HTMLElement {
  const { totals } = summary;
  const item = (key: MessageKey, value: string): HTMLElement[] => [
    el('dt', { text: t(key) }),
    el('dd', { text: value }),
  ];
  const perType = (key: string) => summary.byRunType.find((row) => row.key === key);
  const children = [
    ...item('dashboard.usageCost', usd(totals.costUsd)),
    ...item(
      'dashboard.usageCalls',
      t('dashboard.usageCallCount', { n: totals.calls, errors: totals.errorCalls }),
    ),
    ...item(
      'dashboard.usageTokensIn',
      totals.tokensIn === null ? t('dashboard.usageUnavailable') : String(totals.tokensIn),
    ),
    ...item(
      'dashboard.usageTokensOut',
      totals.tokensOut === null ? t('dashboard.usageUnavailable') : String(totals.tokensOut),
    ),
    ...item(
      'dashboard.usageCache',
      totals.cacheHitRate === null
        ? t('dashboard.usageUnavailable')
        : t('dashboard.usagePercent', { value: (totals.cacheHitRate * 100).toFixed(1) }),
    ),
    ...item('dashboard.usageWasted', usd(totals.wastedCostUsd)),
    ...item(
      'dashboard.usageUnknown',
      t('dashboard.usageUnknownCount', { n: totals.unknownPriceCalls }),
    ),
    ...item('dashboard.usagePerStudy', usd(summary.costPerStudyUsd)),
    ...item('dashboard.usagePerPilot', usd(perType('pilot')?.costPerStudyUsd ?? null)),
    ...item('dashboard.usagePerFull', usd(perType('full')?.costPerStudyUsd ?? null)),
  ];
  const single = perType('single_study');
  if (single !== undefined && single.calls > 0) {
    children.push(...item('dashboard.usagePerSingle', usd(single.costPerStudyUsd)));
  }
  return el('dl', { id: 'dashboard-usage-summary', className: 'dashboard__summary' }, children);
}

function renderBudget(
  usage: DashboardState['usage'],
  callbacks: DashboardViewCallbacks,
): HTMLElement {
  const budget = usage.budget?.budgetUsd ?? null;
  // 呼び出し側が summary 読込済みを確認してから描画する。
  const spent = (usage.summary as UsageSummary).totals.costUsd;
  const input = el('input', {
    id: 'dashboard-budget-input',
    attributes: {
      type: 'text',
      inputmode: 'decimal',
      'aria-label': t('dashboard.budgetInput'),
    },
  });
  const draft = usage.budgetDraft ?? (budget === null ? '' : String(budget));
  input.value = draft;
  input.addEventListener('input', () => callbacks.onBudgetDraftChange(input.value));
  input.disabled = usage.budgetSaving;
  const error = el('p', {
    id: 'dashboard-budget-error',
    className: 'dashboard__error',
    text:
      usage.budgetError === null
        ? ''
        : t('dashboard.budgetSaveError', { reason: usage.budgetError }),
    attributes: { role: 'alert' },
  });
  error.hidden = usage.budgetError === null;
  const save = el('button', {
    id: 'dashboard-budget-save',
    text: t('dashboard.budgetSave'),
    attributes: { type: 'button' },
  });
  save.disabled = usage.budgetSaving;
  save.addEventListener('click', () => {
    const value = Number(draft);
    if (draft.trim() === '' || !Number.isFinite(value) || value <= 0) {
      callbacks.onBudgetError(t('dashboard.budgetInvalid'));
      return;
    }
    callbacks.onSaveBudget(value);
  });
  const children: HTMLElement[] = [
    el('h4', { text: t('dashboard.budgetTitle') }),
    el('p', {
      id: 'dashboard-budget-status',
      text:
        budget === null
          ? t('dashboard.budgetUnset')
          : t('dashboard.budgetStatus', {
              budget: usd(budget),
              spent: usd(spent),
              percent:
                budget === 0
                  ? t('dashboard.usageUnavailable')
                  : ((spent / budget) * 100).toFixed(1),
              by: usage.budget?.updatedBy ?? t('dashboard.usageUnavailable'),
              at: usage.budget?.updatedAt ?? t('dashboard.usageUnavailable'),
            }),
    }),
    input,
    save,
    error,
    el('p', { text: t('dashboard.budgetNote') }),
  ];
  if (budget !== null) {
    const clear = el('button', {
      id: 'dashboard-budget-clear',
      text: t('dashboard.budgetClear'),
      attributes: { type: 'button' },
    });
    clear.disabled = usage.budgetSaving;
    clear.addEventListener('click', () => callbacks.onSaveBudget(null));
    children.push(clear);
    if (spent > budget) {
      children.push(
        el('p', {
          id: 'dashboard-budget-over',
          text: t('dashboard.budgetOver'),
          attributes: { role: 'status' },
        }),
      );
    }
  }
  return el('section', { id: 'dashboard-budget' }, children);
}

export function renderDashboardUsage(
  usage: DashboardState['usage'],
  callbacks: DashboardViewCallbacks,
): HTMLElement {
  const children: HTMLElement[] = [headingWithHelp('h3', t('dashboard.usageTitle'), 'usage')];
  const reload = el('button', {
    id: 'dashboard-usage-reload',
    text: t('common.reload'),
    attributes: { type: 'button' },
  });
  reload.disabled = usage.loading || usage.budgetSaving;
  reload.addEventListener('click', () => callbacks.onReloadUsage());
  children.push(reload);
  if (usage.loadError !== null) {
    children.push(
      el('p', {
        id: 'dashboard-usage-error',
        className: 'dashboard__error',
        text: t('dashboard.usageError', { reason: usage.loadError }),
        attributes: { role: 'alert' },
      }),
    );
  } else if (usage.loading || usage.summary === null) {
    children.push(el('p', { id: 'dashboard-usage-loading', text: t('dashboard.usageLoading') }));
  } else {
    const summary = usage.summary;
    children.push(renderSummary(summary));
    if (summary.undercountedGeminiCalls > 0) {
      children.push(
        el('p', {
          id: 'dashboard-usage-undercount',
          text: t('dashboard.usageUndercount', {
            n: summary.undercountedGeminiCalls,
            cost: usd(summary.undercountedGeminiCostUsd),
          }),
        }),
      );
    }
    if (summary.estimatedCalls > 0 || summary.unassignedCalls > 0) {
      children.push(
        el('p', {
          id: 'dashboard-usage-estimated',
          text: t('dashboard.usageEstimated', {
            n: summary.estimatedCalls,
            cost: usd(summary.estimatedCostUsd),
            unassigned: summary.unassignedCalls,
            unassignedCost: usd(summary.unassignedCostUsd),
          }),
        }),
      );
    }
    children.push(
      table(
        'dashboard-usage-by-run',
        t('dashboard.usageByRun'),
        [
          t('dashboard.usageStarted'),
          t('dashboard.usageRunType'),
          t('dashboard.usageStatus'),
          t('dashboard.usageModel'),
          t('dashboard.usageCalls'),
          t('dashboard.usageCost'),
          t('dashboard.usageSucceeded'),
          t('dashboard.usagePerStudy'),
        ],
        summary.byRun.map((row) => [
          row.startedAt ?? t('dashboard.usageUnavailable'),
          row.runType,
          t(
            row.status === 'running'
              ? 'dashboard.usageInterrupted'
              : row.status === 'done'
                ? 'dashboard.usageDone'
                : 'dashboard.usagePartial',
          ),
          row.model,
          el(
            'span',
            { text: String(row.calls) },
            row.estimated
              ? [
                  el('span', {
                    className: 'dashboard__estimated verify__badge',
                    text: t('dashboard.usageEstimatedBadge'),
                  }),
                ]
              : [],
          ),
          usd(row.costUsd),
          String(row.succeededStudies),
          usd(row.costPerStudyUsd),
        ]),
      ),
    );
    for (const [id, title, rows] of [
      ['purpose', t('dashboard.usageByPurpose'), summary.byPurpose],
      ['model', t('dashboard.usageByModel'), summary.byModel],
      ['month', t('dashboard.usageByMonth'), summary.byMonth],
    ] as const) {
      children.push(
        table(
          `dashboard-usage-by-${id}`,
          title,
          [title, t('dashboard.usageCalls'), t('dashboard.usageCost')],
          rows.map((row) => [row.key, String(row.calls), usd(row.costUsd)]),
        ),
      );
    }
    children.push(renderBudget(usage, callbacks));
  }
  return el('section', { id: 'dashboard-usage' }, children);
}
