// #/dashboard: ダッシュボード（S9 / ui-states.md §3。v0.10 フェーズ 3 = study 単位）。
// 状態: 読み込み中 / 読み込み失敗 / 0 件 / 通常（サマリ + study × section マトリクス）。
// セルクリックは `#/verify?study={study_id}&entity={entity_key}` へのハッシュ遷移
// （ui-flow.md §3 のセル単位ディープリンク）で、コールバックを介さない
import { compareReviewSetIds } from '../../domain/reviewSet';
import type {
  AccuracyBreakdown,
  DashboardData,
  DashboardRow,
  DashboardSectionCell,
  RateCount,
} from '../../features/verification/dashboard';
import { currentReviewSets } from '../../features/review/reviewSets';
import { resolveActiveStudies } from '../../features/documents/studyRepository';
import { t } from '../../lib/i18n';
import { el } from '../ui/dom';
import { headingWithHelp } from '../ui/helpButton';
import type { AppState } from '../store';
import { renderDashboardUsage } from './dashboardUsage';
import type { ViewContext } from './types';

/** 率の表示（分母 0 は「—」。ui-states.md §3 `#/dashboard`） */
export function rateText(rate: RateCount): string {
  if (rate.denominator === 0) {
    return '—';
  }
  const percent = Math.round((rate.numerator / rate.denominator) * 100);
  return t('dashboard.rate', {
    numerator: rate.numerator,
    denominator: rate.denominator,
    percent,
  });
}

function verifyHref(studyId: string, entityKey: string): string {
  return `#/verify?study=${encodeURIComponent(studyId)}&entity=${encodeURIComponent(entityKey)}`;
}

/** AI 採用率（人が無修正で承認した割合）= accept / decided。判定 0 件は「—」 */
export function acceptRateText(accuracy: AccuracyBreakdown): string {
  return rateText({ numerator: accuracy.accept, denominator: accuracy.decided });
}

/** AI 精度の内訳（承認 / 修正 / 棄却 / 報告なし）を人向け文字列に */
export function accuracyBreakdownText(accuracy: AccuracyBreakdown): string {
  return t('dashboard.accuracyBreakdown', {
    accept: accuracy.accept,
    edit: accuracy.edit,
    reject: accuracy.reject,
    notReported: accuracy.notReported,
  });
}

function renderSummary(data: DashboardData): HTMLElement {
  const { totals } = data;
  const item = (label: string, value: string): HTMLElement[] => [
    el('dt', { text: label }),
    el('dd', { text: value }),
  ];
  return el('dl', { id: 'dashboard-summary', className: 'dashboard__summary' }, [
    ...item(
      t('dashboard.summaryProgress'),
      rateText({ numerator: totals.progress.decided, denominator: totals.progress.total }),
    ),
    ...item(t('dashboard.summaryAcceptRate'), acceptRateText(totals.accuracy)),
    ...item(t('dashboard.summaryAccuracy'), accuracyBreakdownText(totals.accuracy)),
    ...item(t('dashboard.summaryAnchor'), rateText(totals.anchor)),
    ...item(t('dashboard.summaryNotReported'), rateText(totals.notReported)),
  ]);
}

function renderSectionCell(row: DashboardRow, cell: DashboardSectionCell | null): HTMLElement {
  const td = el('td', { className: 'dashboard__cell' });
  if (cell === null || cell.entityKey === null) {
    // 当該 study のスキーマにない section / セル 0 件はリンクなし
    td.textContent = '—';
    return td;
  }
  td.append(
    el('a', {
      className: 'dashboard__cell-link',
      text: `${cell.decided} / ${cell.total}`,
      attributes: {
        href: verifyHref(row.studyId, cell.entityKey),
        'aria-label': t('dashboard.cellAria', {
          study: row.studyLabel,
          section: cell.section,
          decided: cell.decided,
          total: cell.total,
        }),
      },
    }),
  );
  return td;
}

function renderMatrix(data: DashboardData): HTMLElement {
  const headRow = el('tr', {}, [
    el('th', { text: t('dashboard.headStudy'), attributes: { scope: 'col' } }),
    ...data.sections.map((section) => el('th', { text: section, attributes: { scope: 'col' } })),
    el('th', { text: t('dashboard.headAcceptRate'), attributes: { scope: 'col' } }),
    el('th', { text: t('dashboard.summaryAnchor'), attributes: { scope: 'col' } }),
    el('th', { text: t('dashboard.summaryNotReported'), attributes: { scope: 'col' } }),
  ]);
  const bodyRows = data.rows.map((row) =>
    el('tr', { className: 'dashboard__row' }, [
      el('th', {
        className: 'dashboard__doc',
        text: `${row.studyLabel}（${row.progress.decided} / ${row.progress.total}）`,
        attributes: { scope: 'row' },
      }),
      ...row.cells.map((cell) => renderSectionCell(row, cell)),
      el('td', {
        className: 'dashboard__rate',
        text: acceptRateText(row.accuracy),
        attributes: { title: accuracyBreakdownText(row.accuracy) },
      }),
      el('td', { className: 'dashboard__rate', text: rateText(row.anchor) }),
      el('td', { className: 'dashboard__rate', text: rateText(row.notReported) }),
    ]),
  );
  return el('table', { id: 'dashboard-matrix', className: 'dashboard__matrix' }, [
    el('caption', {
      className: 'dashboard__matrix-caption',
      attributes: { 'data-tour': 'export-data-progress' },
      text: t('dashboard.caption'),
    }),
    el('thead', {}, [headRow]),
    el('tbody', {}, bodyRows),
  ]);
}

/** 担当していない組み合わせを横棒で示す reviewer × セット表 */
function renderReviewSetProgress(state: AppState): HTMLElement | null {
  const progress = state.dashboard.reviewSetProgress;
  if (progress === null) return null;
  const emails = [...new Set(progress.map((row) => row.email))].sort();
  const studies = resolveActiveStudies(
    state.documents.studies ?? [],
    state.documents.records ?? [],
  );
  const sets = currentReviewSets(studies, state.reviewSets.sets ?? [])
    .map((set) => set.setId)
    .sort(compareReviewSetIds);
  return el('table', { id: 'dashboard-review-sets', className: 'reviewers__table' }, [
    el('caption', { text: t('dashboard.reviewSetsTitle') }),
    el('thead', {}, [
      el('tr', {}, [
        el('th', { text: t('reviewSets.headReviewers'), attributes: { scope: 'col' } }),
        ...sets.map((setId) => el('th', { text: setId, attributes: { scope: 'col' } })),
      ]),
    ]),
    el(
      'tbody',
      {},
      emails.map((email) =>
        el('tr', {}, [
          el('th', { text: email, attributes: { scope: 'row' } }),
          ...sets.map((setId) => {
            const row = progress.find((entry) => entry.email === email && entry.setId === setId);
            return el('td', {
              text:
                row === undefined
                  ? '—'
                  : t('dashboard.reviewSetsCell', { m: row.done, n: row.total }),
            });
          }),
        ]),
      ),
    ),
  ]);
}

export function renderDashboardView(state: AppState, ctx: ViewContext): HTMLElement {
  const children: HTMLElement[] = [
    headingWithHelp('h2', t('app.navDashboard'), 'dashboard'),
    el('p', {
      className: 'view__lead',
      text: t('dashboard.lead'),
    }),
  ];
  const dashboard = state.dashboard;
  const finish = (): HTMLElement => {
    if ((state.role.role ?? 'owner') === 'owner') {
      children.push(renderDashboardUsage(dashboard.usage, ctx.dashboard));
    }
    return el('section', { className: 'view view--dashboard' }, children);
  };

  if (dashboard.loadError !== null) {
    const reload = el('button', {
      id: 'dashboard-reload',
      text: t('common.reload'),
      attributes: { type: 'button' },
    });
    reload.addEventListener('click', () => ctx.dashboard.onReload());
    children.push(
      el('p', {
        id: 'dashboard-load-error',
        className: 'dashboard__error',
        attributes: { role: 'alert' },
        text: t('dashboard.loadError', { reason: dashboard.loadError }),
      }),
      reload,
    );
    return finish();
  }

  if (dashboard.data === null || dashboard.loading) {
    children.push(el('p', { id: 'dashboard-loading', text: t('dashboard.loading') }));
    return finish();
  }

  const reviewSets = renderReviewSetProgress(state);
  if (reviewSets !== null) children.push(reviewSets);

  if (dashboard.data.rows.length === 0) {
    children.push(
      el('div', { id: 'dashboard-empty', className: 'dashboard__empty' }, [
        el('p', { text: t('dashboard.emptyBody') }),
        el('a', { text: t('dashboard.emptyLink'), attributes: { href: '#/extract' } }),
      ]),
    );
    return finish();
  }

  children.push(renderSummary(dashboard.data), renderMatrix(dashboard.data));
  return finish();
}
