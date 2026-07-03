// PDF.js ビューアペイン（requirements.md §4.2 左ペイン: ページ送り / ズーム / テキスト検索 +
// 根拠ハイライトのオーバーレイ描画）。
// - 単一ページ表示。canvas 描画は非同期・連番ガードで競合を破棄する
// - オーバーレイは TextLayerPage の寸法（scale 1）から同期配置できるため、canvas の
//   描画完了を待たずにハイライトが出る（PDF ユーザー空間は原点左下 → CSS は左上に変換）
// - ハイライト矩形はクリック可能（フォーム側への双方向ジャンプ。ui-flow.md §3）
import type { TextLayerPage } from '../../domain/textLayer';
import {
  renderPdfPageToCanvas,
  type PdfViewerDocument,
} from '../../lib/pdf/renderPage';
import { searchPages, type HighlightOccurrence } from '../../features/verification/highlights';
import { el } from './dom';

/** ハイライト色の区分（requirements.md §5-4: 検証済み = 緑 / 未検証 = 黄 / low = 橙） */
export type ViewerHighlightKind = 'verified' | 'unverified' | 'low';

export interface ViewerHighlight {
  /** 検証セルのキー（フォーム側との対応付け） */
  id: string;
  /** クリック矩形の aria-label に使う表示名（項目ラベル） */
  label: string;
  kind: ViewerHighlightKind;
  /** 表示する 1 出現（複数一致の切替は呼び出し側が差し替える） */
  occurrence: HighlightOccurrence;
}

export interface PdfViewerOptions {
  document: PdfViewerDocument;
  /** テキスト層（scale 1 の寸法 + 検索対象テキスト）。テキスト層なし PDF は空テキストのまま */
  pages: readonly TextLayerPage[];
  onHighlightClick?: (id: string) => void;
  /** テスト差し替え用（既定は renderPdfPageToCanvas） */
  renderPage?: typeof renderPdfPageToCanvas;
}

export interface PdfViewerHandle {
  root: HTMLElement;
  /** ハイライト一覧と強調対象を差し替える（ページ移動はしない） */
  setHighlights(highlights: readonly ViewerHighlight[], activeId: string | null): void;
  /** 指定ハイライトのページへ移動して強調する（f キー / 項目フォーカス） */
  focusHighlight(id: string): void;
  /** テキスト検索。同じクエリの再実行は次の一致へ送る（anchor failed のフォールバック） */
  search(query: string): void;
  getCurrentPage(): number;
}

const ZOOM_LEVELS = ['0.75', '1', '1.25', '1.5'] as const;

export function createPdfViewer(options: PdfViewerOptions): PdfViewerHandle {
  const renderPage = options.renderPage ?? renderPdfPageToCanvas;
  const numPages = options.document.numPages;

  let currentPage = 1;
  let scale = 1;
  let highlights: readonly ViewerHighlight[] = [];
  let activeId: string | null = null;
  let searchQuery = '';
  let searchHits: HighlightOccurrence[] = [];
  let searchIndex = 0;
  let renderSeq = 0;

  // --- ツールバー ---------------------------------------------------------
  const prevButton = el('button', {
    className: 'pdf-viewer__prev',
    text: '前のページ',
    attributes: { type: 'button' },
  });
  const nextButton = el('button', {
    className: 'pdf-viewer__next',
    text: '次のページ',
    attributes: { type: 'button' },
  });
  const pageIndicator = el('span', { className: 'pdf-viewer__page-indicator' });
  const zoomSelect = el('select', {
    className: 'pdf-viewer__zoom',
    attributes: { 'aria-label': 'ズーム' },
  });
  for (const level of ZOOM_LEVELS) {
    const option = el('option', { text: `${Number(level) * 100}%`, attributes: { value: level } });
    zoomSelect.append(option);
  }
  zoomSelect.value = '1';
  const searchInput = el('input', {
    className: 'pdf-viewer__search-input',
    attributes: { type: 'search', 'aria-label': '本文検索', placeholder: '本文を検索' },
  });
  const searchButton = el('button', {
    className: 'pdf-viewer__search-button',
    text: '検索',
    attributes: { type: 'button' },
  });
  const searchStatus = el('span', {
    className: 'pdf-viewer__search-status',
    attributes: { 'aria-live': 'polite' },
  });

  // --- 本体 ---------------------------------------------------------------
  const canvas = el('canvas', { className: 'pdf-viewer__canvas' });
  const overlay = el('div', { className: 'pdf-viewer__overlay' });
  const pageWrap = el('div', { className: 'pdf-viewer__page' }, [canvas, overlay]);
  const errorEl = el('p', { className: 'pdf-viewer__error', attributes: { role: 'alert' } });
  errorEl.hidden = true;
  const scroller = el('div', { className: 'pdf-viewer__scroller' }, [errorEl, pageWrap]);
  const root = el('div', { className: 'pdf-viewer' }, [
    el('div', { className: 'pdf-viewer__toolbar' }, [
      prevButton,
      pageIndicator,
      nextButton,
      zoomSelect,
      searchInput,
      searchButton,
      searchStatus,
    ]),
    scroller,
  ]);

  /** 現在ページの scale 1 寸法（テキスト層が無いページ番号は canvas 描画後の寸法に任せる） */
  function pageDims(): { width: number; height: number } | null {
    const page = options.pages.find((candidate) => candidate.page === currentPage);
    return page === undefined ? null : { width: page.width, height: page.height };
  }

  function rectStyle(
    node: HTMLElement,
    pageHeight: number,
    rect: { x: number; y: number; width: number; height: number },
  ): void {
    node.style.left = `${rect.x * scale}px`;
    node.style.top = `${(pageHeight - rect.y - rect.height) * scale}px`;
    node.style.width = `${rect.width * scale}px`;
    node.style.height = `${rect.height * scale}px`;
  }

  function renderOverlay(): void {
    const dims = pageDims();
    overlay.replaceChildren();
    if (dims === null) {
      return;
    }
    pageWrap.style.width = `${dims.width * scale}px`;
    pageWrap.style.height = `${dims.height * scale}px`;
    for (const highlight of highlights) {
      if (highlight.occurrence.page !== currentPage) {
        continue;
      }
      for (const rect of highlight.occurrence.rects) {
        const node = el('button', {
          className: `pdf-viewer__hl pdf-viewer__hl--${highlight.kind}`,
          attributes: { type: 'button', 'aria-label': `根拠: ${highlight.label}` },
        });
        if (highlight.id === activeId) {
          node.classList.add('pdf-viewer__hl--active');
        }
        rectStyle(node, dims.height, rect);
        node.addEventListener('click', () => options.onHighlightClick?.(highlight.id));
        overlay.append(node);
      }
    }
    const hit = searchHits[searchIndex];
    if (hit !== undefined && hit.page === currentPage) {
      for (const rect of hit.rects) {
        const node = el('span', { className: 'pdf-viewer__hl pdf-viewer__hl--search' });
        rectStyle(node, dims.height, rect);
        overlay.append(node);
      }
    }
  }

  function renderToolbar(): void {
    pageIndicator.textContent = `${currentPage} / ${numPages} ページ`;
    prevButton.disabled = currentPage <= 1;
    nextButton.disabled = currentPage >= numPages;
  }

  function redrawCanvas(): void {
    const seq = ++renderSeq;
    void (async () => {
      try {
        const page = await options.document.getPage(currentPage);
        await renderPage(page, canvas, scale);
        if (seq === renderSeq) {
          errorEl.hidden = true;
        }
      } catch (err) {
        if (seq === renderSeq) {
          errorEl.textContent = `PDF を表示できません: ${err instanceof Error ? err.message : String(err)}`;
          errorEl.hidden = false;
        }
      }
    })();
  }

  function update(): void {
    renderToolbar();
    renderOverlay();
    redrawCanvas();
  }

  function goToPage(page: number): void {
    currentPage = Math.min(Math.max(page, 1), numPages);
    update();
  }

  prevButton.addEventListener('click', () => goToPage(currentPage - 1));
  nextButton.addEventListener('click', () => goToPage(currentPage + 1));
  zoomSelect.addEventListener('change', () => {
    scale = Number(zoomSelect.value);
    update();
  });

  function runSearch(query: string): void {
    const trimmed = query.trim();
    if (trimmed === '') {
      return;
    }
    if (trimmed === searchQuery && searchHits.length > 0) {
      // 同じクエリの再実行は次の一致へ（末尾まで行ったら先頭へ戻る）
      searchIndex = (searchIndex + 1) % searchHits.length;
    } else {
      searchQuery = trimmed;
      searchHits = searchPages(trimmed, options.pages);
      searchIndex = 0;
    }
    const hit = searchHits[searchIndex];
    if (hit === undefined) {
      searchStatus.textContent = '一致する本文が見つかりません';
      renderOverlay();
      return;
    }
    searchStatus.textContent = `${searchIndex + 1} / ${searchHits.length} 件`;
    goToPage(hit.page);
  }

  searchButton.addEventListener('click', () => runSearch(searchInput.value));
  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      runSearch(searchInput.value);
    }
  });

  update();

  return {
    root,
    getCurrentPage: () => currentPage,
    setHighlights(next, nextActiveId) {
      highlights = next;
      activeId = nextActiveId;
      renderOverlay();
    },
    focusHighlight(id) {
      const highlight = highlights.find((candidate) => candidate.id === id);
      if (highlight === undefined) {
        return;
      }
      activeId = id;
      goToPage(highlight.occurrence.page);
    },
    search(query) {
      searchInput.value = query;
      runSearch(query);
    },
  };
}
