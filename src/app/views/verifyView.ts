// #/verify: 検証（S8・中核画面）。左 = PDF.js ビューア（根拠ハイライト）、右 = 抽出フォーム
import type { AppState } from '../store';
import { renderPlaceholderView } from './placeholder';

export function renderVerifyView(_state: AppState): HTMLElement {
  return renderPlaceholderView({
    title: '検証',
    purpose:
      'PDF 上の根拠ハイライトを見ながら、AI 抽出値を accept / edit / reject / not_reported で判定します。',
  });
}
