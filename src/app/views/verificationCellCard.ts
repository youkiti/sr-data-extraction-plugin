// 検証セルカード（S6 / S8 共通の判定カード。requirements.md §4.2）。
// verificationForm.ts（リストモード）と verificationFocusCard.ts（issue #38 フォーカスモードの
// 詳細ストリップ）の双方から使う純 render を切り出したモジュール。renderCell 自体の見た目・挙動は
// 変更せず、参照する状態・ハンドラを実際に使う分だけへ最小化した型（CellCardModel /
// CellCardHandlers）を公開する — VerificationFormModel / VerificationFormHandlers は
// フィールドを維持したまま構造的にこの部分型を満たすため、呼び出し側の変更は不要
import { NOT_REPORTED_TOKEN } from '../../domain/annotation';
import type { VerificationCell } from '../../features/verification/cells';
import type { CellStatus } from '../../features/verification/cellState';
import { el } from '../ui/dom';

/** セルに対応するハイライトの表示情報（0 件 = ハイライトなし → フォールバック UI） */
export interface CellHighlightInfo {
  matchCount: number;
  matchIndex: number;
}

/** renderCell が実際に参照する最小の状態 */
export interface CellCardModel {
  focusedCellKey: string | null;
  /** 値入力中のセル（edit = AI 値の修正 / reject = 棄却して手入力） */
  editing: { cellKey: string; action: 'edit' | 'reject' } | null;
  /** 判定済みブロック内で展開表示中のセル。null = 展開なし（フォーカスモードの詳細ストリップは常に null） */
  expandedDecidedKey: string | null;
  highlightInfo: ReadonlyMap<string, CellHighlightInfo>;
  /** テキスト層があるとき true（false なら「本文内を検索」を出さない） */
  canSearchText: boolean;
}

/** renderCell が実際に呼び出す最小のハンドラ集合 */
export interface CellCardHandlers {
  onFocusCell(cellKey: string): void;
  onAccept(cellKey: string): void;
  onStartEdit(cellKey: string, action: 'edit' | 'reject'): void;
  onConfirmEdit(cellKey: string, action: 'edit' | 'reject', value: string): void;
  onCancelEdit(): void;
  onNotReported(cellKey: string): void;
  onUndo(cellKey: string): void;
  /** 現在項目のハイライトへ PDF をスクロール（f） */
  onJump(cellKey: string): void;
  /** quote を PDF.js テキスト検索へ投入（anchor failed のフォールバック） */
  onSearchQuote(quote: string): void;
  /** 「他 n 箇所に一致」の切替 */
  onCycleMatch(cellKey: string): void;
  /** 判定済みブロックの展開カードの「たたむ」（フォーカスモードの詳細ストリップでは発火しない） */
  onCollapseDecided(): void;
}

const STATUS_LABELS: Record<CellStatus, string> = {
  unverified: '未検証',
  accept: '承認',
  edit: '修正',
  reject: '棄却',
  not_reported: '未報告',
};

export function renderStatusChip(status: CellStatus): HTMLElement {
  return el('span', {
    className: `verify__chip verify__chip--${status}`,
    text: STATUS_LABELS[status],
  });
}

function renderAiSummary(cell: VerificationCell): HTMLElement {
  const { evidence } = cell;
  if (evidence === null) {
    return el('p', { className: 'verify__ai verify__ai--none', text: 'AI 抽出なし（手入力のみ）' });
  }
  const parts: HTMLElement[] = [
    el('span', {
      className: 'verify__ai-value',
      text: evidence.notReported ? `未報告（${NOT_REPORTED_TOKEN}）` : (evidence.value ?? '（値なし）'),
    }),
  ];
  if (evidence.confidence !== null) {
    parts.push(
      el('span', {
        className: `verify__badge verify__badge--confidence-${evidence.confidence}`,
        text: `confidence: ${evidence.confidence}`,
      }),
    );
  }
  if (evidence.anchorStatus !== null) {
    parts.push(
      el('span', {
        className: `verify__badge verify__badge--anchor-${evidence.anchorStatus}`,
        text: `anchor: ${evidence.anchorStatus}`,
      }),
    );
  }
  return el('p', { className: 'verify__ai' }, [el('span', { text: 'AI: ' }), ...parts]);
}

function renderQuote(
  cell: VerificationCell,
  model: CellCardModel,
  handlers: CellCardHandlers,
): HTMLElement | null {
  const { evidence } = cell;
  if (evidence === null || evidence.quote === null) {
    return null;
  }
  const info = model.highlightInfo.get(cell.cellKey);
  const anchored = info !== undefined && info.matchCount > 0;
  const children: Array<HTMLElement | string> = [
    el('blockquote', { className: 'verify__quote-text', text: evidence.quote }),
  ];
  if (anchored) {
    const jumpButton = el('button', {
      className: 'verify__quote-jump',
      text: 'ハイライトへ移動',
      attributes: { type: 'button' },
    });
    jumpButton.addEventListener('click', () => handlers.onJump(cell.cellKey));
    children.push(jumpButton);
    if (info.matchCount > 1) {
      const cycleButton = el('button', {
        className: 'verify__quote-cycle',
        text: `他 ${info.matchCount - 1} 箇所に一致（${info.matchIndex + 1} / ${info.matchCount}）`,
        attributes: { type: 'button' },
      });
      cycleButton.addEventListener('click', () => handlers.onCycleMatch(cell.cellKey));
      children.push(cycleButton);
    }
  } else {
    children.push(
      el('span', { className: 'verify__quote-unanchored', text: 'ハイライト位置を特定できません' }),
    );
    if (model.canSearchText) {
      const quoteText = evidence.quote;
      const searchButton = el('button', {
        className: 'verify__quote-search',
        text: '本文内を検索',
        attributes: { type: 'button' },
      });
      searchButton.addEventListener('click', () => handlers.onSearchQuote(quoteText));
      children.push(searchButton);
    }
  }
  return el('div', { className: 'verify__quote' }, children);
}

function renderEditor(
  cell: VerificationCell,
  action: 'edit' | 'reject',
  handlers: CellCardHandlers,
): HTMLElement {
  const input = el('input', {
    className: 'verify__edit-input',
    attributes: {
      type: 'text',
      'aria-label': `${cell.field.fieldLabel} の値`,
    },
  });
  // edit は現在値（未検証なら AI 値）から修正し、reject は白紙から手入力する（§4.2）
  if (action === 'edit') {
    input.value = cell.state.value ?? cell.evidence?.value ?? '';
  }
  const confirmButton = el('button', {
    className: 'verify__edit-confirm',
    text: action === 'edit' ? '修正して確定' : '棄却して確定',
    attributes: { type: 'button' },
  });
  confirmButton.addEventListener('click', () =>
    handlers.onConfirmEdit(cell.cellKey, action, input.value),
  );
  const cancelButton = el('button', {
    className: 'verify__edit-cancel',
    text: 'キャンセル',
    attributes: { type: 'button' },
  });
  cancelButton.addEventListener('click', () => handlers.onCancelEdit());
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      handlers.onConfirmEdit(cell.cellKey, action, input.value);
    } else if (event.key === 'Escape') {
      handlers.onCancelEdit();
    }
  });
  return el('div', { className: 'verify__editor' }, [input, confirmButton, cancelButton]);
}

function renderActions(cell: VerificationCell, handlers: CellCardHandlers): HTMLElement {
  const accept = el('button', {
    className: 'verify__action verify__action--accept',
    text: '承認 (a)',
    attributes: { type: 'button' },
  });
  accept.disabled = cell.evidence === null;
  accept.addEventListener('click', () => handlers.onAccept(cell.cellKey));

  const edit = el('button', {
    className: 'verify__action verify__action--edit',
    text: '修正 (e)',
    attributes: { type: 'button' },
  });
  edit.addEventListener('click', () => handlers.onStartEdit(cell.cellKey, 'edit'));

  const reject = el('button', {
    className: 'verify__action verify__action--reject',
    text: '棄却 (x)',
    attributes: { type: 'button' },
  });
  reject.addEventListener('click', () => handlers.onStartEdit(cell.cellKey, 'reject'));

  const notReported = el('button', {
    className: 'verify__action verify__action--not-reported',
    text: '未報告 (n)',
    attributes: { type: 'button' },
  });
  notReported.addEventListener('click', () => handlers.onNotReported(cell.cellKey));

  const undo = el('button', {
    className: 'verify__action verify__action--undo',
    text: '戻す (z)',
    attributes: { type: 'button' },
  });
  undo.disabled = cell.state.stack.length === 0;
  undo.addEventListener('click', () => handlers.onUndo(cell.cellKey));

  return el('div', { className: 'verify__actions' }, [accept, edit, reject, notReported, undo]);
}

/**
 * セル 1 件ぶんのカード（ヘッダ + AI 値 + 確定値 + quote + 判定操作 or 編集フォーム）。
 * リストモードの通常カード・判定済みブロックの展開カード・フォーカスモードの詳細ストリップの
 * いずれからも同じ見た目・挙動で使う（issue #38: コピペ複製せず共有する）
 */
export function renderCell(
  cell: VerificationCell,
  model: CellCardModel,
  handlers: CellCardHandlers,
): HTMLElement {
  const headerChildren: HTMLElement[] = [
    el('span', { className: 'verify__cell-label', text: cell.field.fieldLabel }),
    el('code', { className: 'verify__cell-name', text: cell.field.fieldName }),
    renderStatusChip(cell.state.status),
  ];
  if (cell.cellKey === model.expandedDecidedKey) {
    // 判定済みブロック内の展開カードにだけ「たたむ」を出す
    const collapseButton = el('button', {
      className: 'verify__decided-collapse',
      text: 'たたむ',
      attributes: { type: 'button' },
    });
    collapseButton.addEventListener('click', () => handlers.onCollapseDecided());
    headerChildren.push(collapseButton);
  }
  const header = el('div', { className: 'verify__cell-header' }, headerChildren);
  const children: HTMLElement[] = [header, renderAiSummary(cell)];
  if (cell.state.status !== 'unverified') {
    children.push(
      el('p', {
        className: 'verify__current-value',
        text: `確定値: ${cell.state.value ?? '（空）'}`,
      }),
    );
  }
  const quote = renderQuote(cell, model, handlers);
  if (quote !== null) {
    children.push(quote);
  }
  if (model.editing !== null && model.editing.cellKey === cell.cellKey) {
    children.push(renderEditor(cell, model.editing.action, handlers));
  } else {
    children.push(renderActions(cell, handlers));
  }
  const node = el('div', { className: 'verify__cell', attributes: { tabindex: '-1' } }, children);
  node.dataset['cellKey'] = cell.cellKey;
  if (cell.cellKey === model.focusedCellKey) {
    node.classList.add('verify__cell--focused');
  }
  node.addEventListener('focusin', () => {
    if (cell.cellKey !== model.focusedCellKey) {
      handlers.onFocusCell(cell.cellKey);
    }
  });
  return node;
}
