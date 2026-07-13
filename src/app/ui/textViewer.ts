// 抽出テキストビュー（pdfViewer の兄弟コンポーネント。issue #28 案2）。
// 検証パネル左ペインの表示切替で pdfViewer の代わりに表示する: 出所文書 / ページ番号 /
// 根拠引用（<mark> 強調）/ 引用前後の文脈。座標計算・描画は一切持たず、呼び出し側
// （verificationPanel）が features/verification/textContext.ts で組み立てたスニペットを
// そのまま流し込む純粋な表示コンポーネント
import { t } from '../../lib/i18n';
import { el } from './dom';

export interface TextViewerSnippet {
  /** 出所文書の表示名（ファイル名 + role ラベル） */
  documentLabel: string;
  /** ハイライト表示する引用文字列 */
  quote: string;
  /** ページ本文上で再特定できた場合のページ番号 + 前後文脈。再特定不能なら null */
  located: { page: number; before: string; after: string } | null;
}

export interface TextViewerHandle {
  root: HTMLElement;
  /**
   * アクティブな根拠のスニペットを差し替える。
   * null = 根拠未選択（案内文言）/ located あり = スニペット表示 / located なし = 再特定不能
   */
  setSnippet(snippet: TextViewerSnippet | null): void;
}

export function createTextViewer(): TextViewerHandle {
  const body = el('div', { className: 'text-viewer__body' });
  const root = el('div', { className: 'text-viewer' }, [body]);

  function renderEmpty(): void {
    body.replaceChildren(
      el('p', {
        className: 'text-viewer__empty',
        text: t('verify.textViewerEmpty'),
      }),
    );
  }

  function renderUnresolved(snippet: TextViewerSnippet): void {
    body.replaceChildren(
      el('p', { className: 'text-viewer__doc-label', text: snippet.documentLabel }),
      el('p', {
        className: 'text-viewer__unresolved-note',
        text: t('verify.textViewerUnresolved'),
      }),
      el('blockquote', { className: 'text-viewer__quote-full', text: snippet.quote }),
    );
  }

  function renderResolved(
    snippet: TextViewerSnippet,
    located: NonNullable<TextViewerSnippet['located']>,
  ): void {
    body.replaceChildren(
      el('p', { className: 'text-viewer__doc-label', text: snippet.documentLabel }),
      el('p', { className: 'text-viewer__page', text: t('verify.textViewerPage', { page: located.page }) }),
      el('p', { className: 'text-viewer__snippet' }, [
        located.before,
        el('mark', { className: 'text-viewer__mark', text: snippet.quote }),
        located.after,
      ]),
    );
  }

  renderEmpty();

  return {
    root,
    setSnippet(snippet) {
      if (snippet === null) {
        renderEmpty();
      } else if (snippet.located === null) {
        renderUnresolved(snippet);
      } else {
        renderResolved(snippet, snippet.located);
      }
    },
  };
}
