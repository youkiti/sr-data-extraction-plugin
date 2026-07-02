// #/home: プロジェクト概要（進捗サマリ）。0 文献でも崩れないこと（ui-states.md §3）
import { el } from '../ui/dom';
import type { AppState } from '../store';

function summaryItems(label: string, value: number): HTMLElement[] {
  return [
    el('dt', { className: 'home__summary-label', text: label }),
    el('dd', { className: 'home__summary-value', text: String(value) }),
  ];
}

export function renderHomeView(state: AppState): HTMLElement {
  const { counts } = state;
  const projectName = state.currentProject?.name ?? '未選択';
  return el('section', { className: 'view view--home' }, [
    el('h2', { text: 'プロジェクト概要' }),
    el('p', { className: 'view__lead', text: `プロジェクト: ${projectName}` }),
    el('dl', { className: 'home__summary' }, [
      ...summaryItems('文献数', counts.documents),
      ...summaryItems('プロトコル版数', counts.protocolVersions),
      ...summaryItems('確定スキーマ版数', counts.schemaVersions),
      ...summaryItems('AI 抽出済み Evidence 行数', counts.evidenceRows),
      ...summaryItems('データ行数（StudyData + ResultsData）', counts.dataRows),
    ]),
  ]);
}
