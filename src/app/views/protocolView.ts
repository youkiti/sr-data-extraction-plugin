// #/protocol: プロトコル入力（S4）。sr-query-builder の protocol 画面 UI を移植予定
import type { AppState } from '../store';
import { renderPlaceholderView } from './placeholder';

export function renderProtocolView(_state: AppState): HTMLElement {
  return renderPlaceholderView({
    title: 'プロトコル入力',
    purpose: '手入力または .md / .docx アップロードで研究プロトコルを登録します。',
  });
}
