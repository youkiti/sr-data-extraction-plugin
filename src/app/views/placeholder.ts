// スケルトン段階の未実装画面の共通描画。実装が入り次第、各 view から置き換える
import { el } from '../ui/dom';

export function renderPlaceholderView(options: { title: string; purpose: string }): HTMLElement {
  return el('section', { className: 'view' }, [
    el('h2', { text: options.title }),
    el('p', { className: 'view__lead', text: options.purpose }),
    el('p', {
      className: 'view__todo',
      text: 'この画面はスケルトン段階のため未実装です。docs/ui-states.md の該当セクションが target spec です。',
    }),
  ]);
}
