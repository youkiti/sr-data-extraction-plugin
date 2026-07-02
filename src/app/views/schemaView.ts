// #/schema: スキーマデザイン（S5）。AI ドラフト → 表形式エディタ → 版として確定
import type { AppState } from '../store';
import { renderPlaceholderView } from './placeholder';

export function renderSchemaView(_state: AppState): HTMLElement {
  return renderPlaceholderView({
    title: 'スキーマデザイン',
    purpose:
      'プロトコルとサンプル論文から AI が抽出スキーマをドラフトし、表形式エディタで承認・編集して版として確定します。',
  });
}
