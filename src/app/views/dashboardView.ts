// #/dashboard: ダッシュボード（S9）。document × section の検証進捗マトリクス等
import type { AppState } from '../store';
import { renderPlaceholderView } from './placeholder';

export function renderDashboardView(_state: AppState): HTMLElement {
  return renderPlaceholderView({
    title: 'ダッシュボード',
    purpose: '検証の進捗マトリクス、anchor 失敗率、not_reported 率を可視化します。',
  });
}
