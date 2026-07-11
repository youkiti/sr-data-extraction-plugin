// PDF 参照ペイン（S12 裁定画面。docs/design-independent-dual-review.md §6.4）。
// 検証パネルの PDF ビューア（app/ui/pdfViewer）+ 文書切替タブ（verify__doc-tabs 相当）を流用しつつ、
// Evidence ハイライトの再特定は行わない簡略版（v1: PDF 表示 + ページ送り / ズーム / テキスト検索のみ。
// 裁定は盲検解除後の工程で、根拠探しは「本文を検索」で足りるとして実装コストを抑える）。
//
// study 切替のたびに作り直し、それ以外の再描画（セル裁定でストアが更新されるたび）では
// 同一インスタンス（canvas・ページ位置・ズーム・doc タブ選択）を再利用する
// （renderCachedVerificationPanel と同じ考え方。キャッシュキーは studyId）
import { DOCUMENT_ROLE_LABELS, type DocumentRecord } from '../../domain/document';
import type { AdjudicateWorking } from '../store';
import { el } from '../ui/dom';
import { createPdfViewer, type PdfViewerHandle } from '../ui/pdfViewer';

interface CachedPane {
  studyId: string;
  activeDocumentId: string | null;
  viewer: PdfViewerHandle | null;
  root: HTMLElement;
  tabsEl: HTMLElement;
  bodyEl: HTMLElement;
}

let cached: CachedPane | null = null;

function renderDocTabs(
  documents: readonly DocumentRecord[],
  activeDocumentId: string | null,
  onSelect: (documentId: string) => void,
): HTMLElement {
  if (documents.length < 2) {
    return el('div', {});
  }
  const tabs = documents.map((doc) => {
    const button = el(
      'button',
      {
        className: `adjudicate__doc-tab${doc.documentId === activeDocumentId ? ' adjudicate__doc-tab--active' : ''}`,
        attributes: { type: 'button' },
      },
      [
        el('span', { className: 'adjudicate__doc-role', text: DOCUMENT_ROLE_LABELS[doc.documentRole] }),
        el('span', { className: 'adjudicate__doc-filename', text: doc.filename }),
      ],
    );
    button.addEventListener('click', () => onSelect(doc.documentId));
    return button;
  });
  return el('div', { className: 'adjudicate__doc-tabs' }, tabs);
}

async function loadIntoPane(pane: CachedPane, working: AdjudicateWorking, documentId: string): Promise<void> {
  pane.bodyEl.replaceChildren(el('p', { className: 'adjudicate__pdf-loading', text: 'PDF を読み込んでいます…' }));
  const view = await working.loadPdfView(documentId);
  if (cached !== pane || pane.activeDocumentId !== documentId) {
    return; // 破棄済み・別文書へ切替済みなら結果を捨てる
  }
  if (view.pdf === null) {
    const retry = el('button', { text: '再試行', attributes: { type: 'button' } });
    retry.addEventListener('click', () => {
      void loadIntoPane(pane, working, documentId);
    });
    pane.bodyEl.replaceChildren(
      el('p', {
        className: 'adjudicate__pdf-error',
        attributes: { role: 'alert' },
        text: `PDF を読み込めませんでした: ${view.pdfError ?? ''}`,
      }),
      retry,
    );
    return;
  }
  pane.viewer = createPdfViewer({ document: view.pdf, pages: view.textPages });
  pane.bodyEl.replaceChildren(pane.viewer.root);
}

function selectDocument(pane: CachedPane, working: AdjudicateWorking, documentId: string): void {
  if (pane.activeDocumentId === documentId) {
    return;
  }
  pane.activeDocumentId = documentId;
  pane.tabsEl.replaceChildren(
    renderDocTabs(working.documents, pane.activeDocumentId, (id) => selectDocument(pane, working, id)),
  );
  void loadIntoPane(pane, working, documentId);
}

/**
 * study の PDF 参照ペインを返す（同じ studyId への再描画は同一インスタンスを再利用する）。
 * study が切り替わったら破棄して作り直す
 */
export function renderAdjudicatePdfPane(working: AdjudicateWorking): HTMLElement {
  if (cached === null || cached.studyId !== working.study.studyId) {
    const tabsEl = el('div', {});
    const bodyEl = el('div', { className: 'adjudicate__pdf-body' });
    const root = el('div', { className: 'adjudicate__pdf-pane' }, [tabsEl, bodyEl]);
    const firstDocumentId = working.documents[0]?.documentId ?? null;
    const pane: CachedPane = { studyId: working.study.studyId, activeDocumentId: firstDocumentId, viewer: null, root, tabsEl, bodyEl };
    cached = pane;
    pane.tabsEl.replaceChildren(
      renderDocTabs(working.documents, firstDocumentId, (id) => selectDocument(pane, working, id)),
    );
    if (firstDocumentId !== null) {
      void loadIntoPane(pane, working, firstDocumentId);
    } else {
      pane.bodyEl.replaceChildren(el('p', { text: 'この研究には文書がありません。' }));
    }
  }
  return cached.root;
}

/** テスト・study 一覧への離脱時の後始末 */
export function disposeAdjudicatePdfPaneCache(): void {
  cached = null;
}
