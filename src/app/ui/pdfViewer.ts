// PDF.js ビューアペイン（requirements.md §4.2 左ペイン: ページ送り / ズーム / テキスト検索 +
// 根拠ハイライトのオーバーレイ描画）。
// - 単一ページ表示。canvas 描画は非同期・連番ガードで競合を破棄する
// - オーバーレイは TextLayerPage の寸法（scale 1）から同期配置できるため、canvas の
//   描画完了を待たずにハイライトが出る（PDF ユーザー空間 → CSS 左上原点への写像は
//   ページ回転込みで toDisplayRect が行う）
// - ハイライト矩形はクリック可能（フォーム側への双方向ジャンプ。ui-flow.md §3）
// - 描画タスクの実キャンセル（issue #28 案3）: renderSeq の連番ガードは「結果を無視する」だけで
//   pdfjs の描画自体は走り続けていた。ページ送り・ズーム変更・setDocument の直前に、
//   進行中の RenderTask（renderPdfPageToCanvas が返す cancel()）を明示的にキャンセルする
import type { TextLayerPage } from '../../domain/textLayer';
import {
  renderPdfPageToCanvas,
  type PdfViewerDocument,
} from '../../lib/pdf/renderPage';
import { toDisplayRect } from '../../lib/pdf/viewportRect';
import { searchPages, type HighlightOccurrence } from '../../features/verification/highlights';
import { t } from '../../lib/i18n';
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
  /**
   * 表示中の文書を差し替える（v0.10: study 内の別 PDF へ切替）。ページは 1 に戻し、
   * 検索状態はクリアする。連番ガード（renderSeq）は維持され、旧文書の遅延描画は破棄される
   */
  setDocument(document: PdfViewerDocument, pages: readonly TextLayerPage[]): void;
  getCurrentPage(): number;
}

// issue #51: 小さい画面でも文字を追えるよう、上限を 200% → 300% まで広げる
// （#/pilot 埋め込み・#/verify 単独の両方でこの一覧を共有する）
const ZOOM_LEVELS = ['0.75', '1', '1.25', '1.5', '1.75', '2', '2.5', '3'] as const;

export function createPdfViewer(options: PdfViewerOptions): PdfViewerHandle {
  const renderPage = options.renderPage ?? renderPdfPageToCanvas;
  let document = options.document;
  let pages = options.pages;
  let numPages = document.numPages;

  let currentPage = 1;
  let scale = 1;
  let highlights: readonly ViewerHighlight[] = [];
  let activeId: string | null = null;
  let searchQuery = '';
  let searchHits: HighlightOccurrence[] = [];
  let searchIndex = 0;
  let renderSeq = 0;
  /** 進行中の pdfjs RenderTask（新しい描画開始前・setDocument 時にキャンセルする） */
  let currentRenderTask: { cancel(): void } | null = null;

  // --- ツールバー ---------------------------------------------------------
  const prevButton = el('button', {
    className: 'pdf-viewer__prev',
    text: t('pdf.prevPage'),
    attributes: { type: 'button' },
  });
  const nextButton = el('button', {
    className: 'pdf-viewer__next',
    text: t('pdf.nextPage'),
    attributes: { type: 'button' },
  });
  const pageIndicator = el('span', { className: 'pdf-viewer__page-indicator' });
  const zoomSelect = el('select', {
    className: 'pdf-viewer__zoom',
    attributes: { 'aria-label': t('pdf.zoomAria') },
  });
  for (const level of ZOOM_LEVELS) {
    const option = el('option', { text: `${Number(level) * 100}%`, attributes: { value: level } });
    zoomSelect.append(option);
  }
  zoomSelect.value = '1';
  const searchInput = el('input', {
    className: 'pdf-viewer__search-input',
    attributes: { type: 'search', 'aria-label': t('pdf.searchAria'), placeholder: t('pdf.searchPlaceholder') },
  });
  const searchButton = el('button', {
    className: 'pdf-viewer__search-button',
    text: t('pdf.searchButton'),
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
  // スクロール領域はキーボードで到達可能にする（axe: scrollable-region-focusable。
  // 兄弟ペイン（判定・セル一覧）が短いレイアウトだと本領域が縦にあふれ、tabindex 無しでは
  // キーボード操作でスクロールできなくなる。#/adjudicate のセル一覧が短くなる構成で顕在化した）
  // role='group' は aria-label を許容する（role なしの div では axe: aria-prohibited-attr に
  // なる）。focusable なスクロール領域に表示名を与えつつ landmark ノイズを避ける最小構成
  // data-preserve-scroll: ストア再描画の detach → reattach でスクロールが先頭へ戻らない
  // ようにする（bootstrap の購読ハンドラが退避・復元する。issue #192）
  const scroller = el('div', {
    className: 'pdf-viewer__scroller',
    attributes: {
      role: 'group',
      tabindex: '0',
      'aria-label': t('pdf.viewerAria'),
      'data-preserve-scroll': '',
    },
  }, [errorEl, pageWrap]);
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

  /** 現在ページのテキスト層（テキスト層が無いページ番号は canvas 描画後の寸法に任せる） */
  function currentTextLayerPage(): TextLayerPage | null {
    return pages.find((candidate) => candidate.page === currentPage) ?? null;
  }

  function rectStyle(
    node: HTMLElement,
    page: TextLayerPage,
    rect: { x: number; y: number; width: number; height: number },
    space: 'user' | 'display' = 'user',
  ): void {
    if (space === 'display') {
      // bbox 由来（handoff-scanned-pdf-native-highlight.md §7.4 PR3）: 矩形は既に
      // 回転適用後の表示フレーム座標（scale 1）なので toDisplayRect を通さない
      // （通すと二重回転になる。§7.3 / features/verification/highlights.ts の bboxToDisplayRect 参照）。
      // scale の拡縮だけ適用する
      node.style.left = `${rect.x * scale}px`;
      node.style.top = `${rect.y * scale}px`;
      node.style.width = `${rect.width * scale}px`;
      node.style.height = `${rect.height * scale}px`;
      return;
    }
    // 矩形は回転前のユーザー空間なので、ページ回転込みで表示座標へ写像してから拡縮する
    const display = toDisplayRect(rect, page);
    node.style.left = `${display.left * scale}px`;
    node.style.top = `${display.top * scale}px`;
    node.style.width = `${display.width * scale}px`;
    node.style.height = `${display.height * scale}px`;
  }

  function renderOverlay(): void {
    const page = currentTextLayerPage();
    overlay.replaceChildren();
    if (page === null) {
      return;
    }
    pageWrap.style.width = `${page.width * scale}px`;
    pageWrap.style.height = `${page.height * scale}px`;
    for (const highlight of highlights) {
      if (highlight.occurrence.page !== currentPage) {
        continue;
      }
      for (const rect of highlight.occurrence.rects) {
        const node = el('button', {
          className: `pdf-viewer__hl pdf-viewer__hl--${highlight.kind}`,
          attributes: { type: 'button', 'aria-label': t('pdf.highlightAria', { label: highlight.label }) },
        });
        if (highlight.id === activeId) {
          node.classList.add('pdf-viewer__hl--active');
        }
        rectStyle(node, page, rect, highlight.occurrence.space ?? 'user');
        node.addEventListener('click', () => options.onHighlightClick?.(highlight.id));
        overlay.append(node);
      }
    }
    const hit = searchHits[searchIndex];
    if (hit !== undefined && hit.page === currentPage) {
      for (const rect of hit.rects) {
        const node = el('span', { className: 'pdf-viewer__hl pdf-viewer__hl--search' });
        rectStyle(node, page, rect);
        overlay.append(node);
      }
    }
  }

  function renderToolbar(): void {
    pageIndicator.textContent = t('pdf.pageIndicator', { current: currentPage, total: numPages });
    prevButton.disabled = currentPage <= 1;
    nextButton.disabled = currentPage >= numPages;
  }

  function redrawCanvas(): void {
    const seq = ++renderSeq;
    // 直前の描画（別ページ・別文書向け）はもう不要なのでキャンセルする。連番ガードと併用のため、
    // キャンセルに伴う rejection（pdfjs の RenderingCancelledException）は下の catch で
    // seq 不一致として無視される
    currentRenderTask?.cancel();
    currentRenderTask = null;
    void (async () => {
      try {
        const page = await document.getPage(currentPage);
        const { promise, cancel } = renderPage(page, canvas, scale);
        if (seq === renderSeq) {
          currentRenderTask = { cancel };
        } else {
          // document.getPage を待つ間に、より新しい描画が始まっていた。
          // 開始してしまった描画タスクはすぐキャンセルする（currentRenderTask は上書きしない）
          cancel();
        }
        await promise;
        if (seq === renderSeq) {
          errorEl.hidden = true;
        }
      } catch (err) {
        if (seq === renderSeq) {
          errorEl.textContent = t('pdf.renderError', {
            reason: err instanceof Error ? err.message : String(err),
          });
          errorEl.hidden = false;
        }
      } finally {
        if (seq === renderSeq) {
          currentRenderTask = null;
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
      searchHits = searchPages(trimmed, pages);
      searchIndex = 0;
    }
    const hit = searchHits[searchIndex];
    if (hit === undefined) {
      searchStatus.textContent = t('pdf.searchNoHits');
      renderOverlay();
      return;
    }
    searchStatus.textContent = t('pdf.searchHits', { index: searchIndex + 1, total: searchHits.length });
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
    setDocument(nextDocument, nextPages) {
      document = nextDocument;
      pages = nextPages;
      numPages = nextDocument.numPages;
      currentPage = 1;
      // 文書切替で検索状態はリセット（旧文書のヒットは無意味）
      searchQuery = '';
      searchHits = [];
      searchIndex = 0;
      searchInput.value = '';
      searchStatus.textContent = '';
      // update() → redrawCanvas() が renderSeq を進めるため、旧文書の遅延描画はここで無効化される
      update();
    },
  };
}
