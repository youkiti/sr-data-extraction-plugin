// #/home: プロジェクト概要（進捗サマリ）。0 文献でも崩れないこと（ui-states.md §3）。
// カウントは起動時に Sheets から読み込む（homeService）。読み込み中 / 失敗 + 再読み込み / 通常の 3 状態
import { el } from '../ui/dom';
import type { AppState } from '../store';
import type { ViewContext } from './types';

function summaryItems(label: string, value: number): HTMLElement[] {
  return [
    el('dt', { className: 'home__summary-label', text: label }),
    el('dd', { className: 'home__summary-value', text: String(value) }),
  ];
}

export function renderHomeView(state: AppState, ctx: ViewContext): HTMLElement {
  const { counts, home } = state;
  const projectName = state.currentProject?.name ?? '未選択';
  const children: Array<HTMLElement | string> = [
    el('h2', { text: 'プロジェクト概要' }),
    el('p', { className: 'view__lead', text: `プロジェクト: ${projectName}` }),
  ];

  if (home.countsLoading) {
    children.push(el('p', { id: 'home-counts-loading', text: '進捗を読み込んでいます…' }));
  } else if (home.countsError !== null) {
    const reload = el('button', {
      id: 'home-counts-reload',
      text: '再読み込み',
      attributes: { type: 'button' },
    });
    reload.addEventListener('click', () => ctx.home.onReload());
    children.push(
      el('p', {
        id: 'home-counts-error',
        className: 'home__error',
        attributes: { role: 'alert' },
        text: `進捗を読み込めませんでした: ${home.countsError}`,
      }),
      reload,
    );
  } else {
    children.push(
      el('dl', { className: 'home__summary' }, [
        ...summaryItems('文献数', counts.documents),
        ...summaryItems('プロトコル版数', counts.protocolVersions),
        ...summaryItems('確定スキーマ版数', counts.schemaVersions),
        ...summaryItems('AI 抽出済み Evidence 行数', counts.evidenceRows),
        ...summaryItems('データ行数（StudyData + ResultsData）', counts.dataRows),
      ]),
    );
  }

  return el('section', { className: 'view view--home' }, children);
}
