// #/pilot: パイロット抽出（S6）。少数論文で AI 抽出 → 検証 → スキーマ改訂の反復
import type { AppState } from '../store';
import { renderPlaceholderView } from './placeholder';

export function renderPilotView(_state: AppState): HTMLElement {
  return renderPlaceholderView({
    title: 'パイロット抽出',
    purpose: '2〜3 本の論文で AI 抽出を試行し、検証結果をもとにスキーマを改訂します。',
  });
}
