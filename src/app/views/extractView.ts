// #/extract: 一括抽出（S7）。コスト概算 → 確認 → 実行、進捗と失敗リトライ
import type { AppState } from '../store';
import { renderPlaceholderView } from './placeholder';

export function renderExtractView(_state: AppState): HTMLElement {
  return renderPlaceholderView({
    title: '一括抽出',
    purpose:
      '対象文献とモデルを選び、コスト概算を確認してから全論文の AI 抽出を実行します。失敗分はリトライできます。',
  });
}
