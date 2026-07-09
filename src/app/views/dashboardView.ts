// #/dashboard: ダッシュボード（S9 / ui-states.md §3。v0.10 フェーズ 3 = study 単位）。
// 状態: 読み込み中 / 読み込み失敗 / 0 件 / 通常（サマリ + study × section マトリクス）。
// セルクリックは `#/verify?study={study_id}&entity={entity_key}` へのハッシュ遷移
// （ui-flow.md §3 のセル単位ディープリンク）で、コールバックを介さない
import type {
  AccuracyBreakdown,
  DashboardData,
  DashboardRow,
  DashboardSectionCell,
  RateCount,
} from '../../features/verification/dashboard';
import { el } from '../ui/dom';
import type { AppState } from '../store';
import type { ViewContext } from './types';

/** 率の表示（分母 0 は「—」。ui-states.md §3 `#/dashboard`） */
export function rateText(rate: RateCount): string {
  if (rate.denominator === 0) {
    return '—';
  }
  const percent = Math.round((rate.numerator / rate.denominator) * 100);
  return `${rate.numerator} / ${rate.denominator}（${percent}%）`;
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
  return `承認 ${accuracy.accept}・修正 ${accuracy.edit}・棄却 ${accuracy.reject}・報告なし ${accuracy.notReported}`;
}

function renderSummary(data: DashboardData): HTMLElement {
  const { totals } = data;
  const item = (label: string, value: string): HTMLElement[] => [
    el('dt', { text: label }),
    el('dd', { text: value }),
  ];
  return el('dl', { id: 'dashboard-summary', className: 'dashboard__summary' }, [
    ...item('検証進捗', rateText({ numerator: totals.progress.decided, denominator: totals.progress.total })),
    ...item('AI 採用率（人が無修正で承認）', acceptRateText(totals.accuracy)),
    ...item('AI 精度内訳', accuracyBreakdownText(totals.accuracy)),
    ...item('anchor 失敗率', rateText(totals.anchor)),
    ...item('not_reported 率', rateText(totals.notReported)),
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
        'aria-label': `${row.studyLabel} の ${cell.section} を検証（判定済み ${cell.decided} / ${cell.total}）`,
      },
    }),
  );
  return td;
}

function renderMatrix(data: DashboardData): HTMLElement {
  const headRow = el('tr', {}, [
    el('th', { text: '研究', attributes: { scope: 'col' } }),
    ...data.sections.map((section) => el('th', { text: section, attributes: { scope: 'col' } })),
    el('th', { text: 'AI 採用率', attributes: { scope: 'col' } }),
    el('th', { text: 'anchor 失敗率', attributes: { scope: 'col' } }),
    el('th', { text: 'not_reported 率', attributes: { scope: 'col' } }),
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
      text: 'study × section の検証進捗（セル = 判定済み / 総セル。クリックで検証画面へ）',
    }),
    el('thead', {}, [headRow]),
    el('tbody', {}, bodyRows),
  ]);
}

export function renderDashboardView(state: AppState, ctx: ViewContext): HTMLElement {
  const children: HTMLElement[] = [
    el('h2', { text: 'ダッシュボード' }),
    el('p', {
      className: 'view__lead',
      text: '検証の進捗マトリクス、AI 採用率（人の判定から算出）、anchor 失敗率、not_reported 率を可視化します。',
    }),
  ];
  const dashboard = state.dashboard;

  if (dashboard.loadError !== null) {
    const reload = el('button', {
      id: 'dashboard-reload',
      text: '再読み込み',
      attributes: { type: 'button' },
    });
    reload.addEventListener('click', () => ctx.dashboard.onReload());
    children.push(
      el('p', {
        id: 'dashboard-load-error',
        className: 'dashboard__error',
        attributes: { role: 'alert' },
        text: `進捗を読み込めませんでした: ${dashboard.loadError}`,
      }),
      reload,
    );
    return el('section', { className: 'view view--dashboard' }, children);
  }

  if (dashboard.data === null || dashboard.loading) {
    children.push(el('p', { id: 'dashboard-loading', text: '進捗を読み込んでいます…' }));
    return el('section', { className: 'view view--dashboard' }, children);
  }

  if (dashboard.data.rows.length === 0) {
    children.push(
      el('div', { id: 'dashboard-empty', className: 'dashboard__empty' }, [
        el('p', { text: 'まだ抽出がありません。' }),
        el('a', { text: '一括抽出を実行する', attributes: { href: '#/extract' } }),
      ]),
    );
    return el('section', { className: 'view view--dashboard' }, children);
  }

  children.push(renderSummary(dashboard.data), renderMatrix(dashboard.data));
  return el('section', { className: 'view view--dashboard' }, children);
}
