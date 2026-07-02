// 検証パネル（S8 の 2 ペイン UI 基盤。S6 パイロットへ埋め込み、S8 単独画面でも再利用する）。
// - 左ペイン: pdfViewer（根拠ハイライト + クリックで対応項目へフォーカス）
// - 右ペイン: verificationForm（判定チップ / 判定操作 / anchor failed フォールバック）
// - 判定はパネル内へ楽観反映し、永続化は onDecision コールバック（サービス層）へ委譲する
// - キーボードショートカット（ui-flow.md §7）はパネルが DOM に接続されている間だけ反応し、
//   入力フィールドにフォーカスがある間は発火しない（判定誤爆の防止。ui-states.md §4）
//
// ストア再描画（route render）とライフサイクルの整合は renderCachedVerificationPanel が取る:
// 同じ VerificationData 参照なら同一インスタンス（DOM / PDF canvas / 判定の楽観状態）を返し、
// データが差し替わったときだけ作り直す
import { NOT_REPORTED_TOKEN } from '../../domain/annotation';
import type { Decision, DecisionAction } from '../../domain/decision';
import type { Evidence } from '../../domain/evidence';
import type { EntityLevel } from '../../domain/schemaField';
import { availableTabs, buildTabModel, type TabModel, type VerificationCell } from '../../features/verification/cells';
import { cellKeyOf, deriveCellStates, undoRevertValue } from '../../features/verification/cellState';
import {
  buildDocumentHighlights,
  type EvidenceHighlight,
  type HighlightOccurrence,
} from '../../features/verification/highlights';
import type { VerificationData } from '../../features/verification/types';
import type { renderPdfPageToCanvas } from '../../lib/pdf/renderPage';
import { nowIso8601 } from '../../utils/iso8601';
import { el } from '../ui/dom';
import { createPdfViewer, type PdfViewerHandle, type ViewerHighlight } from '../ui/pdfViewer';
import {
  renderVerificationForm,
  type CellHighlightInfo,
  type VerificationFormHandlers,
  type VerificationFormModel,
} from './verificationForm';

export interface VerificationPanelOptions {
  data: VerificationData;
  /** 判定 1 操作ごとに呼ばれる（永続化 + オフラインキュー退避はサービス層の責務） */
  onDecision: (decision: Decision) => void;
  now?: () => string;
  /** テスト差し替え用（pdfViewer へ渡す） */
  renderPage?: typeof renderPdfPageToCanvas;
}

export interface VerificationPanelHandle {
  root: HTMLElement;
  dispose(): void;
}

export function createVerificationPanel(
  options: VerificationPanelOptions,
): VerificationPanelHandle {
  const { data } = options;
  const now = options.now ?? nowIso8601;

  // --- パネル内状態 -------------------------------------------------------
  // 判定は自分の annotator 行への操作だけを畳み込む（他 annotator の判定は状態に影響しない）
  const ownDecisions: Decision[] = data.decisions.filter(
    (decision) => decision.annotator === data.annotator,
  );
  const highlights = buildDocumentHighlights(data.evidence, data.textPages);
  const highlightByCell = new Map(highlights.map((h) => [h.cellKey, h]));
  const evidenceByCell = new Map<string, Evidence>(
    data.evidence.map((item) => [cellKeyOf(item.fieldId, item.entityKey), item]),
  );
  const fieldLabelById = new Map(data.fields.map((field) => [field.fieldId, field.fieldLabel]));
  /** 複数一致の表示中出現（cellKey → occurrences の index）。未設定は selectedIndex */
  const matchSelection = new Map<string, number>();

  const tabs = availableTabs(data.fields);
  let activeTab: EntityLevel = tabs[0] ?? 'study';
  let focusedCellKey: string | null = null;
  let editing: { cellKey: string; action: 'edit' | 'reject' } | null = null;

  const currentTabModel = (): TabModel =>
    buildTabModel(activeTab, data.fields, data.evidence, ownDecisions);

  // --- 左ペイン（PDF ビューア） -------------------------------------------
  let viewer: PdfViewerHandle | null = null;
  const leftPane = el('div', { className: 'verify__pane verify__pane--pdf' });
  if (data.pdf !== null) {
    viewer = createPdfViewer({
      document: data.pdf,
      pages: data.textPages,
      onHighlightClick: (id) => focusCell(id, { jump: false, domFocus: true }),
      renderPage: options.renderPage,
    });
    leftPane.append(viewer.root);
  } else {
    // ui-states.md §6: 原本が開けないときは再取り込み導線を出す（フォーム側の検証は続行可能）
    const link = el('a', { text: '文献取り込み画面を開く', attributes: { href: '#/documents' } });
    leftPane.append(
      el('div', { className: 'verify__pdf-error', attributes: { role: 'alert' } }, [
        el('p', { text: `PDF を開けません: ${data.pdfError ?? '原因不明'}` }),
        link,
      ]),
    );
  }

  // --- 右ペイン（フォーム） -----------------------------------------------
  const formPane = el('div', { className: 'verify__pane verify__pane--form' });

  const children: HTMLElement[] = [];
  if (data.document.textStatus === 'no_text_layer') {
    children.push(
      el('p', {
        className: 'verify__banner',
        text: 'この PDF はテキスト層がないためハイライト検証は使えません（quote 全文とページヒントで検証してください）',
      }),
    );
  }
  children.push(el('div', { className: 'verify__panes' }, [leftPane, formPane]));
  const root = el('div', { className: 'verify' }, children);

  function highlightInfo(): Map<string, CellHighlightInfo> {
    const info = new Map<string, CellHighlightInfo>();
    for (const highlight of highlights) {
      info.set(highlight.cellKey, {
        matchCount: highlight.occurrences.length,
        matchIndex: matchSelection.get(highlight.cellKey) ?? highlight.selectedIndex,
      });
    }
    return info;
  }

  function viewerHighlights(): ViewerHighlight[] {
    const states = deriveCellStates(ownDecisions);
    return highlights.map((highlight) => {
      const [fieldId] = JSON.parse(highlight.cellKey) as [string, string];
      const status = states.get(highlight.cellKey)?.status ?? 'unverified';
      // ハイライトは evidence 由来のため対応する Evidence が必ず存在する
      const confidence = (evidenceByCell.get(highlight.cellKey) as Evidence).confidence;
      const index = matchSelection.get(highlight.cellKey) ?? highlight.selectedIndex;
      return {
        id: highlight.cellKey,
        label: fieldLabelById.get(fieldId) ?? fieldId,
        // 色分け: 検証済み = 緑 / low confidence = 橙 / 未検証 = 黄（requirements.md §5-4）
        kind:
          status !== 'unverified' ? 'verified' : confidence === 'low' ? 'low' : 'unverified',
        // index は occurrences 長の剰余で更新されるため必ず範囲内（0 件は除外済み）
        occurrence: highlight.occurrences[index] as HighlightOccurrence,
      };
    });
  }

  function syncViewer(): void {
    viewer?.setHighlights(viewerHighlights(), focusedCellKey);
  }

  /** セルの DOM を引く。呼び出し側は描画済みの現在タブの cellKey のみ渡す（不変条件） */
  function findCellElement(cellKey: string): HTMLElement {
    return [...formPane.querySelectorAll<HTMLElement>('.verify__cell')].find(
      (node) => node.dataset['cellKey'] === cellKey,
    ) as HTMLElement;
  }

  function applyFocusClasses(): void {
    for (const node of formPane.querySelectorAll<HTMLElement>('.verify__cell')) {
      node.classList.toggle('verify__cell--focused', node.dataset['cellKey'] === focusedCellKey);
    }
  }

  /**
   * 現在タブのセルを引く。フォームのハンドラとキーボード操作は現在タブに存在する
   * cellKey しか渡さない（selectTab / focusCell がフォーカスを常にタブ内へ再設定する不変条件）
   */
  function findCell(cellKey: string): VerificationCell {
    return currentTabModel().cells.find((cell) => cell.cellKey === cellKey) as VerificationCell;
  }

  /** cellKey がどのタブに属するか（ビューアクリック時のタブ切替に使う） */
  function tabOfCell(cellKey: string): EntityLevel | null {
    for (const tab of tabs) {
      const model = buildTabModel(tab, data.fields, data.evidence, ownDecisions);
      if (model.cells.some((cell) => cell.cellKey === cellKey)) {
        return tab;
      }
    }
    return null;
  }

  const handlers: VerificationFormHandlers = {
    onSelectTab(tab) {
      activeTab = tab;
      focusedCellKey = currentTabModel().cells[0]?.cellKey ?? null;
      editing = null;
      refreshForm();
      syncViewer();
    },
    onFocusCell(cellKey) {
      focusCell(cellKey, { jump: true, domFocus: false });
    },
    onAccept(cellKey) {
      const cell = findCell(cellKey);
      if (cell.evidence === null) {
        return;
      }
      commit(cell, 'accept', cell.evidence.notReported ? NOT_REPORTED_TOKEN : cell.evidence.value);
    },
    onStartEdit(cellKey, action) {
      editing = { cellKey, action };
      focusedCellKey = cellKey;
      refreshForm();
      // 値入力へ即フォーカス（e キーの操作感。ui-flow.md §7）
      formPane.querySelector<HTMLInputElement>('.verify__edit-input')?.focus();
    },
    onConfirmEdit(cellKey, action, value) {
      const cell = findCell(cellKey);
      editing = null;
      const trimmed = value.trim();
      commit(cell, action, trimmed === '' ? null : trimmed);
    },
    onCancelEdit() {
      editing = null;
      refreshForm();
    },
    onNotReported(cellKey) {
      commit(findCell(cellKey), 'not_reported', NOT_REPORTED_TOKEN);
    },
    onUndo(cellKey) {
      const cell = findCell(cellKey);
      if (cell.state.stack.length === 0) {
        return;
      }
      commit(cell, 'undo', undoRevertValue(cell.state));
    },
    onJump(cellKey) {
      viewer?.focusHighlight(cellKey);
    },
    onSearchQuote(quote) {
      viewer?.search(quote);
    },
    onCycleMatch(cellKey) {
      // 切替ボタンは matchCount > 1 のセルにしか出ないため、対応するハイライトが必ず存在する
      const highlight = highlightByCell.get(cellKey) as EvidenceHighlight;
      const current = matchSelection.get(cellKey) ?? highlight.selectedIndex;
      matchSelection.set(cellKey, (current + 1) % highlight.occurrences.length);
      refreshForm();
      syncViewer();
      viewer?.focusHighlight(cellKey);
    },
  };

  function refreshForm(): void {
    const doc = root.ownerDocument;
    const hadFocus = root.contains(doc.activeElement);
    const model: VerificationFormModel = {
      tabs,
      activeTab,
      tabModel: currentTabModel(),
      focusedCellKey,
      editing,
      highlightInfo: highlightInfo(),
      canSearchText: data.textPages.some((page) => page.text !== ''),
    };
    formPane.replaceChildren(renderVerificationForm(model, handlers));
    if (hadFocus && focusedCellKey !== null && editing === null) {
      findCellElement(focusedCellKey).focus();
    }
  }

  /**
   * セルへフォーカスを移す。同一タブ内はフォーム再構築なしのクラス切替に留める
   * （focusin → 再構築だと直後の click がキャンセルされるため）
   */
  function focusCell(
    cellKey: string,
    behavior: { jump: boolean; domFocus: boolean },
  ): void {
    if (cellKey === focusedCellKey) {
      return;
    }
    const tab = tabOfCell(cellKey);
    if (tab === null) {
      return;
    }
    focusedCellKey = cellKey;
    if (tab !== activeTab) {
      activeTab = tab;
      editing = null;
      refreshForm();
    } else {
      applyFocusClasses();
    }
    syncViewer();
    if (behavior.jump) {
      // 項目フォーカス → 該当ハイライトへスクロール + 強調（requirements.md §4.2）
      viewer?.focusHighlight(cellKey);
    }
    if (behavior.domFocus) {
      const element = findCellElement(cellKey);
      element.scrollIntoView?.({ block: 'nearest' });
      element.focus();
    }
  }

  function commit(cell: VerificationCell, action: DecisionAction, value: string | null): void {
    const decision: Decision = {
      decidedAt: now(),
      decidedBy: data.annotator,
      documentId: data.document.documentId,
      fieldId: cell.field.fieldId,
      entityKey: cell.entityKey,
      annotator: data.annotator,
      annotatorType: 'human_with_ai',
      schemaVersion: data.schemaVersion,
      action,
      value,
      note: null,
    };
    ownDecisions.push(decision);
    focusedCellKey = cell.cellKey;
    refreshForm();
    syncViewer();
    options.onDecision(decision);
  }

  function moveFocus(delta: number): void {
    const cells = currentTabModel().cells;
    if (cells.length === 0) {
      return;
    }
    // フォーカス未設定（findIndex = -1）は delta によらず先頭へ寄せる（clamp で吸収）
    const index = cells.findIndex((cell) => cell.cellKey === focusedCellKey);
    const next = Math.min(Math.max(index + delta, 0), cells.length - 1);
    const cell = cells[next] as VerificationCell;
    focusCell(cell.cellKey, { jump: true, domFocus: true });
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (!root.isConnected || editing !== null) {
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
      return;
    }
    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement
    ) {
      return;
    }
    switch (event.key) {
      case 'j':
      case 'ArrowDown':
        event.preventDefault();
        moveFocus(1);
        return;
      case 'k':
      case 'ArrowUp':
        event.preventDefault();
        moveFocus(-1);
        return;
      default:
        break;
    }
    if (focusedCellKey === null) {
      return;
    }
    switch (event.key) {
      case 'a':
        event.preventDefault();
        handlers.onAccept(focusedCellKey);
        break;
      case 'e':
        event.preventDefault();
        handlers.onStartEdit(focusedCellKey, 'edit');
        break;
      case 'x':
        event.preventDefault();
        handlers.onStartEdit(focusedCellKey, 'reject');
        break;
      case 'n':
        event.preventDefault();
        handlers.onNotReported(focusedCellKey);
        break;
      case 'z':
        event.preventDefault();
        handlers.onUndo(focusedCellKey);
        break;
      case 'f':
        event.preventDefault();
        handlers.onJump(focusedCellKey);
        break;
      default:
        break;
    }
  }

  const ownerDoc = root.ownerDocument;
  ownerDoc.addEventListener('keydown', handleKeydown);

  focusedCellKey = currentTabModel().cells[0]?.cellKey ?? null;
  refreshForm();
  syncViewer();

  return {
    root,
    dispose() {
      ownerDoc.removeEventListener('keydown', handleKeydown);
    },
  };
}

// ---------------------------------------------------------------------------
// ストア再描画との整合（view は純粋関数のまま、パネルの生存期間だけここで管理する）
// ---------------------------------------------------------------------------

let cachedPanel: { data: VerificationData; handle: VerificationPanelHandle } | null = null;

/**
 * 同じ VerificationData 参照に対しては同一パネル（DOM / 判定の楽観状態）を返す。
 * データが差し替わったら古いパネルを破棄して作り直す
 */
export function renderCachedVerificationPanel(options: VerificationPanelOptions): HTMLElement {
  if (cachedPanel !== null && cachedPanel.data === options.data) {
    return cachedPanel.handle.root;
  }
  cachedPanel?.handle.dispose();
  cachedPanel = { data: options.data, handle: createVerificationPanel(options) };
  return cachedPanel.handle.root;
}

/** テスト・プロジェクト切替時の後始末 */
export function disposeVerificationPanelCache(): void {
  cachedPanel?.handle.dispose();
  cachedPanel = null;
}
