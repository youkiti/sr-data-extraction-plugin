// 検証フォーム（S6 / S8 共通の右ペイン。requirements.md §4.2）。
// render は純粋関数で、状態は verificationPanel が管理する。
// - entity タブ（study / arm / outcome_result）→ グループ（section / entity インスタンス）→ セル
// - セル: AI 値 + confidence / anchor_status + quote + 判定チップ + 判定操作
// - anchor_status = failed / ハイライト再特定不能: quote 全文 + 「本文内を検索」フォールバック
import type { EntityLevel } from '../../domain/schemaField';
import { NOT_REPORTED_TOKEN } from '../../domain/annotation';
import type { TabModel, VerificationCell } from '../../features/verification/cells';
import type { CellStatus } from '../../features/verification/cellState';
import { el } from '../ui/dom';

/** セルに対応するハイライトの表示情報（0 件 = ハイライトなし → フォールバック UI） */
export interface CellHighlightInfo {
  matchCount: number;
  matchIndex: number;
}

export interface VerificationFormModel {
  tabs: EntityLevel[];
  activeTab: EntityLevel;
  tabModel: TabModel;
  focusedCellKey: string | null;
  /** 値入力中のセル（edit = AI 値の修正 / reject = 棄却して手入力） */
  editing: { cellKey: string; action: 'edit' | 'reject' } | null;
  highlightInfo: ReadonlyMap<string, CellHighlightInfo>;
  /** テキスト層があるとき true（false なら「本文内を検索」を出さない。ui-states.md §3） */
  canSearchText: boolean;
}

export interface VerificationFormHandlers {
  onSelectTab(tab: EntityLevel): void;
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
}

const TAB_LABELS: Record<EntityLevel, string> = {
  study: 'Study',
  arm: '群（arm）',
  outcome_result: 'アウトカム',
  rob_domain: 'RoB',
};

const STATUS_LABELS: Record<CellStatus, string> = {
  unverified: '未検証',
  accept: '承認',
  edit: '修正',
  reject: '棄却',
  not_reported: '未報告',
};

function renderStatusChip(status: CellStatus): HTMLElement {
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
  model: VerificationFormModel,
  handlers: VerificationFormHandlers,
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
  handlers: VerificationFormHandlers,
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

function renderActions(cell: VerificationCell, handlers: VerificationFormHandlers): HTMLElement {
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

function renderCell(
  cell: VerificationCell,
  model: VerificationFormModel,
  handlers: VerificationFormHandlers,
): HTMLElement {
  const header = el('div', { className: 'verify__cell-header' }, [
    el('span', { className: 'verify__cell-label', text: cell.field.fieldLabel }),
    el('code', { className: 'verify__cell-name', text: cell.field.fieldName }),
    renderStatusChip(cell.state.status),
  ]);
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

function renderTabs(model: VerificationFormModel, handlers: VerificationFormHandlers): HTMLElement {
  const buttons = model.tabs.map((tab) => {
    const button = el('button', {
      className: 'verify__tab',
      text: TAB_LABELS[tab],
      attributes: { type: 'button', role: 'tab', 'aria-selected': String(tab === model.activeTab) },
    });
    if (tab === model.activeTab) {
      button.classList.add('verify__tab--active');
    }
    button.addEventListener('click', () => handlers.onSelectTab(tab));
    return button;
  });
  return el('div', { className: 'verify__tabs', attributes: { role: 'tablist' } }, buttons);
}

export function renderVerificationForm(
  model: VerificationFormModel,
  handlers: VerificationFormHandlers,
): HTMLElement {
  const children: HTMLElement[] = [renderTabs(model, handlers)];
  if (model.tabModel.cells.length === 0) {
    children.push(
      el('p', {
        className: 'verify__empty',
        text: 'このタブに表示できる項目がありません（AI 抽出にインスタンスがありません）',
      }),
    );
  }
  for (const group of model.tabModel.groups) {
    children.push(
      el('section', { className: 'verify__group' }, [
        el('h4', { className: 'verify__group-heading', text: group.heading }),
        ...group.cells.map((cell) => renderCell(cell, model, handlers)),
      ]),
    );
  }
  children.push(
    el('p', {
      className: 'verify__shortcut-note',
      text: 'ショートカット: a 承認 / e 修正 / x 棄却 / n 未報告 / z 戻す / j・k 項目移動 / f ハイライトへ',
    }),
  );
  return el('div', { className: 'verify__form' }, children);
}
