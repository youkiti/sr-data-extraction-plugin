// #/documents: 文献取り込み（S3）。著作権の注意書きは常時表示（requirements.md §1.5 / ui-states.md §3）
import { el } from '../ui/dom';
import type { AppState } from '../store';

export function renderDocumentsView(_state: AppState): HTMLElement {
  return el('section', { className: 'view view--documents' }, [
    el('h2', { text: '文献取り込み' }),
    el('p', {
      className: 'view__notice',
      text: '著作権フリー / 利用許諾済みの PDF のみ取り込んでください。取り込んだ PDF が外部へ送信されるのは LLM API への抽出リクエストのみです。',
    }),
    el('p', {
      className: 'view__lead',
      text: 'Google Drive Picker で採用論文の PDF を選択し、プロジェクトフォルダへコピーしてテキスト層を抽出します。',
    }),
    el('p', {
      className: 'view__todo',
      text: 'Drive Picker 連携はスケルトン段階のため未実装です。docs/ui-states.md §3 が target spec です。',
    }),
  ]);
}
