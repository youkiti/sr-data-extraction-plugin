// #/export: エクスポート（S10）。study_wide / results_long / audit の 3 形式の CSV 生成
import type { AppState } from '../store';
import { renderPlaceholderView } from './placeholder';

export function renderExportView(_state: AppState): HTMLElement {
  return renderPlaceholderView({
    title: 'エクスポート',
    purpose: '確定データを study_wide / results_long / audit の CSV として生成し、Drive に保存します。',
  });
}
