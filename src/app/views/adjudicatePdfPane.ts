// PDF 参照ペイン（S12 裁定画面。docs/design-independent-dual-review.md §6.4）。
// 検証パネルの PDF ビューア（app/ui/pdfViewer）+ 文書切替タブ（verify__doc-tabs 相当）を流用する。
// v1（〜2026-07-11）は PDF 表示 + ページ送り / ズーム / テキスト検索のみの簡略版だったが、
// issue #63 で working.evidence（latestRunEvidenceByStudy で解決した study 最新 run の
// Evidence。S8/S9 は issue #80 で field 単位合成へ移行したが裁定は補助表示のため据え置き）
// を使った根拠ハイライトを追加した: 表示中文書の PDF が読み込まれたら
// features/verification/highlights.ts の buildDocumentHighlights（検証画面と同じ実装）で
// その文書ぶんの Evidence を矩形化し、セル一覧の「根拠を表示」ボタン（adjudicateView.ts）から
// focusAdjudicateEvidence 経由で該当文書へ切替 + ハイライトへジャンプできるようにする。
// AI の Evidence が無いセル（human_independent 由来 / not_reported 等）はハイライトなしで
// 従来どおり（ボタン自体を出さない。adjudicateView.ts 側の判定）。
//
// study 切替のたびに作り直し、それ以外の再描画（セル裁定でストアが更新されるたび）では
// 同一インスタンス（canvas・ページ位置・ズーム・doc タブ選択・ハイライト計算結果）を再利用する
// （renderCachedVerificationPanel と同じ考え方。キャッシュキーは studyId）
import type { DocumentRecord } from '../../domain/document';
import type { Evidence } from '../../domain/evidence';
import { indexEvidenceByCellKey } from '../../features/adjudication/cellMatch';
import {
  buildDocumentHighlights,
  type EvidenceHighlight,
  type HighlightOccurrence,
} from '../../features/verification/highlights';
import { getUiLanguage, t, type UiLanguage } from '../../lib/i18n';
import type { AdjudicateWorking } from '../store';
import { documentRoleLabel } from '../ui/documentRoleLabel';
import { el } from '../ui/dom';
import { createPdfViewer, type PdfViewerHandle, type ViewerHighlight } from '../ui/pdfViewer';

interface CachedPane {
  studyId: string;
  /**
   * ペイン生成時の表示言語（issue #93）。言語切替では studyId が変わらず、同一 study の
   * `#/adjudicate?study=` 再入場も syncAdjudicateRoute の同一 study ガードで再読込しないため、
   * studyId 比較だけではキャッシュ済みの左ペイン（読み込み中 / エラー文言・doc タブの role
   * ラベル等）が旧言語のまま残る。生成時言語をスタンプし、現在言語と異なれば作り直す
   */
  language: UiLanguage;
  activeDocumentId: string | null;
  viewer: PdfViewerHandle | null;
  root: HTMLElement;
  tabsEl: HTMLElement;
  bodyEl: HTMLElement;
  /** working.evidence を cellKey で引けるようにした索引（study 切替のたびに作り直す） */
  evidenceIndex: Map<string, Evidence>;
  /**
   * ロード中に focusAdjudicateEvidence が呼ばれた場合の保留ジャンプ（ロード解決後に
   * 1 回だけ適用する。verificationPanel の pendingJumpCellKey と同じ考え方）
   */
  pendingFocusCellKey: string | null;
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
        el('span', { className: 'adjudicate__doc-role', text: documentRoleLabel(doc.documentRole) }),
        el('span', { className: 'adjudicate__doc-filename', text: doc.filename }),
      ],
    );
    button.addEventListener('click', () => onSelect(doc.documentId));
    return button;
  });
  return el('div', { className: 'adjudicate__doc-tabs' }, tabs);
}

/**
 * Evidence ハイライトをビューア用の ViewerHighlight へ変換する（issue #63）。
 * 裁定はセル一覧側で判定チップ・値を別途表示しているため、PDF 上のハイライトは
 * 検証画面の verified/unverified/low の色分けを再現せず一律 'unverified'（黄）にする
 * （working.consensusDecisions を都度参照して色を出し分けると、キャッシュ済みペインの
 * 再描画のたびに再計算が要り複雑になる割に得るものが小さいため。ui-flow.md 相当の簡略化）
 */
function toViewerHighlights(
  working: AdjudicateWorking,
  docHighlights: readonly EvidenceHighlight[],
): ViewerHighlight[] {
  return docHighlights.map((highlight) => {
    const cell = working.cells.find((candidate) => candidate.cellKey === highlight.cellKey);
    return {
      id: highlight.cellKey,
      label: cell?.field.fieldLabel ?? highlight.cellKey,
      kind: 'unverified',
      occurrence: highlight.occurrences[highlight.selectedIndex] as HighlightOccurrence,
    };
  });
}

async function loadIntoPane(pane: CachedPane, working: AdjudicateWorking, documentId: string): Promise<void> {
  pane.bodyEl.replaceChildren(
    el('p', { className: 'adjudicate__pdf-loading', text: t('verify.pdfLoading') }),
  );
  const view = await working.loadPdfView(documentId);
  if (cached !== pane || pane.activeDocumentId !== documentId) {
    return; // 破棄済み・別文書へ切替済みなら結果を捨てる
  }
  if (view.pdf === null) {
    const retry = el('button', { text: t('common.retry'), attributes: { type: 'button' } });
    retry.addEventListener('click', () => {
      void loadIntoPane(pane, working, documentId);
    });
    pane.bodyEl.replaceChildren(
      el('p', {
        className: 'adjudicate__pdf-error',
        attributes: { role: 'alert' },
        text: t('adjudicate.pdfError', { reason: view.pdfError ?? '' }),
      }),
      retry,
    );
    return;
  }
  const docHighlights = buildDocumentHighlights(
    documentId,
    working.evidence.filter((item) => item.documentId === documentId),
    view.textPages,
  );
  pane.viewer = createPdfViewer({ document: view.pdf, pages: view.textPages });
  pane.viewer.setHighlights(toViewerHighlights(working, docHighlights), null);
  pane.bodyEl.replaceChildren(pane.viewer.root);

  // 保留ジャンプ（ロード中に focusAdjudicateEvidence が呼ばれていた場合）を 1 回だけ適用する
  if (pane.pendingFocusCellKey !== null) {
    const cellKey = pane.pendingFocusCellKey;
    pane.pendingFocusCellKey = null;
    pane.viewer.focusHighlight(cellKey);
  }
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
 * study の PDF 参照ペインを返す（同じ studyId + 同じ表示言語への再描画は同一インスタンスを
 * 再利用する）。study が切り替わった・表示言語が切り替わったら破棄して作り直す（issue #93）
 */
export function renderAdjudicatePdfPane(working: AdjudicateWorking): HTMLElement {
  if (
    cached === null ||
    cached.studyId !== working.study.studyId ||
    cached.language !== getUiLanguage()
  ) {
    const tabsEl = el('div', {});
    const bodyEl = el('div', { className: 'adjudicate__pdf-body' });
    const children: HTMLElement[] = [tabsEl];
    if (working.evidence.length === 0) {
      children.push(
        el('p', {
          className: 'adjudicate__no-evidence-note',
          text: t('adjudicate.noEvidenceNote'),
        }),
      );
    }
    children.push(bodyEl);
    const root = el('div', { className: 'adjudicate__pdf-pane' }, children);
    const firstDocumentId = working.documents[0]?.documentId ?? null;
    const pane: CachedPane = {
      studyId: working.study.studyId,
      language: getUiLanguage(),
      activeDocumentId: firstDocumentId,
      viewer: null,
      root,
      tabsEl,
      bodyEl,
      evidenceIndex: indexEvidenceByCellKey(working.evidence),
      pendingFocusCellKey: null,
    };
    cached = pane;
    pane.tabsEl.replaceChildren(
      renderDocTabs(working.documents, firstDocumentId, (id) => selectDocument(pane, working, id)),
    );
    if (firstDocumentId !== null) {
      void loadIntoPane(pane, working, firstDocumentId);
    } else {
      pane.bodyEl.replaceChildren(el('p', { text: t('adjudicate.noDocuments') }));
    }
  }
  return cached.root;
}

/**
 * セル選択（adjudicateView.ts の「根拠を表示」ボタン）に応じて、該当 Evidence の出所文書へ
 * 表示を切替え、ハイライトへジャンプする（issue #63。verificationPanel の
 * ensureActiveDocumentForCell + focusHighlightNowOrPending 相当の最小実装）。
 * 対応する study のペインが無い・Evidence が無い・出所文書が study 配下に無い場合は no-op
 */
export function focusAdjudicateEvidence(working: AdjudicateWorking, cellKey: string): void {
  if (cached === null || cached.studyId !== working.study.studyId) {
    return;
  }
  const pane = cached;
  const evidence = pane.evidenceIndex.get(cellKey);
  if (evidence === undefined) {
    return;
  }
  if (!working.documents.some((doc) => doc.documentId === evidence.documentId)) {
    return; // 出所文書が study 配下に無い（データ不整合への防御）
  }
  if (evidence.documentId !== pane.activeDocumentId) {
    pane.pendingFocusCellKey = cellKey;
    selectDocument(pane, working, evidence.documentId);
    return;
  }
  if (pane.viewer !== null) {
    pane.viewer.focusHighlight(cellKey);
  } else {
    pane.pendingFocusCellKey = cellKey;
  }
}

/** テスト・study 一覧への離脱時の後始末 */
export function disposeAdjudicatePdfPaneCache(): void {
  cached = null;
}
