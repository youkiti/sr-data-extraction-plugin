// 検証フォーム（S6 / S8 共通の右ペイン。requirements.md §4.2）。
// render は純粋関数で、状態は verificationPanel が管理する。
// - entity タブ（study / arm / outcome_result）→ グループ（section / entity インスタンス）→ セル
// - セル: AI 値 + confidence / anchor_status + quote + 判定チップ + 判定操作
// - anchor_status = failed / ハイライト再特定不能: quote 全文 + 「本文内を検索」フォールバック
import type { EntityLevel } from '../../domain/schemaField';
import { NOT_REPORTED_TOKEN } from '../../domain/annotation';
import {
  splitDecidedCells,
  type DecidedEntry,
  type TabModel,
  type VerificationCell,
} from '../../features/verification/cells';
import type { CellStatus } from '../../features/verification/cellState';
import { isArmDependentLevel } from '../../features/verification/armDraft';
import type { VerificationProgress } from '../../features/verification/progress';
import { el } from '../ui/dom';

/** セルに対応するハイライトの表示情報（0 件 = ハイライトなし → フォールバック UI） */
export interface CellHighlightInfo {
  matchCount: number;
  matchIndex: number;
}

/** 群構成確定カード（requirements.md §4.2 / ui-states.md §3 `#/verify`）の表示モデル */
export interface ArmCardModel {
  /** 編集中か（未確定のうちは常に編集中） */
  editing: boolean;
  /** 編集中は編集行、確定済み表示中は確定内容 */
  rows: readonly { armKey: string; armName: string }[];
  /** 確定済み version。null = 未確定 */
  confirmedVersion: number | null;
  error: string | null;
}

export interface VerificationFormModel {
  tabs: EntityLevel[];
  activeTab: EntityLevel;
  tabModel: TabModel;
  focusedCellKey: string | null;
  /** 値入力中のセル（edit = AI 値の修正 / reject = 棄却して手入力） */
  editing: { cellKey: string; action: 'edit' | 'reject' } | null;
  /** 直近判定の 1 件（判定済みブロックへ送らず元の位置に残す。見直し・戻す (z) 用） */
  recentDecidedKey: string | null;
  /** 判定済みブロック内で展開表示中のセル。null = すべてコンパクト表示 */
  expandedDecidedKey: string | null;
  highlightInfo: ReadonlyMap<string, CellHighlightInfo>;
  /** テキスト層があるとき true（false なら「本文内を検索」を出さない。ui-states.md §3） */
  canSearchText: boolean;
  /** 群構成確定カード。null = 群構成が不要なスキーマ（arm / outcome_result 項目なし） */
  armCard: ArmCardModel | null;
  /** true のとき arm / outcome_result タブをディムし、該当タブの本文を確定案内に差し替える */
  armLocked: boolean;
  /** 全 entity タブ横断の判定進捗（判定のたびに更新。「どこまでやったか」の可視化） */
  progress: VerificationProgress;
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
  /** 判定済みブロックのコンパクト行クリック → 展開（フォーカスも移す） */
  onExpandDecided(cellKey: string): void;
  /** 展開中カードの「たたむ」 */
  onCollapseDecided(): void;
  /** 群構成カード: 名称の編集確定（change 単位） */
  onArmNameChange(index: number, name: string): void;
  onArmAddRow(): void;
  onArmRemoveRow(index: number): void;
  /** 「群構成を確定」（検証 → ArmStructures へ新 version 追記） */
  onArmConfirm(): void;
  /** 確定済みカードの「改訂」 */
  onArmRevise(): void;
  /** 改訂のキャンセル（確定済みがあるときだけ出る） */
  onArmCancelRevise(): void;
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

/**
 * 判定済みブロックの 1 行。コンパクト表示（チップ + ラベル + 確定値の 1 行）が既定で、
 * クリックで展開（expandedDecidedKey）→ 通常カード + たたむボタンに切り替わる
 */
function renderDecidedRow(
  entry: DecidedEntry,
  model: VerificationFormModel,
  handlers: VerificationFormHandlers,
): HTMLElement {
  const { cell } = entry;
  // 展開中 or 値入力中（キーボード e / x で編集を始めた場合）は通常カードで描画する
  if (cell.cellKey === model.expandedDecidedKey || cell.cellKey === model.editing?.cellKey) {
    return renderCell(cell, model, handlers);
  }
  const children: HTMLElement[] = [
    renderStatusChip(cell.state.status),
    el('span', { className: 'verify__cell-label', text: cell.field.fieldLabel }),
  ];
  if (entry.heading !== '') {
    children.push(el('span', { className: 'verify__decided-heading', text: entry.heading }));
  }
  children.push(
    el('span', {
      className: 'verify__decided-value',
      text: `確定値: ${cell.state.value ?? '（空）'}`,
    }),
  );
  const row = el(
    'button',
    {
      className: 'verify__cell verify__cell--decided',
      attributes: { type: 'button', title: 'クリックで詳細を表示' },
    },
    children,
  );
  row.dataset['cellKey'] = cell.cellKey;
  if (cell.cellKey === model.focusedCellKey) {
    row.classList.add('verify__cell--focused');
  }
  row.addEventListener('click', () => handlers.onExpandDecided(cell.cellKey));
  return row;
}

/**
 * 判定進捗バー（全 entity タブ横断）。判定のたびに refreshForm で作り直され、
 * 「判定済み N / 総数 M」と充填バーが即時に更新される（automation bias 対策 UI の一部）
 */
function renderProgress(progress: VerificationProgress): HTMLElement {
  const { decided, total } = progress;
  const remaining = Math.max(total - decided, 0);
  const text = el('span', {
    className: 'verify__progress-text',
    text:
      total === 0
        ? '判定対象の項目がありません'
        : `判定済み ${decided} / ${total}${remaining > 0 ? `（残り ${remaining}）` : '（すべて判定済み）'}`,
  });
  const bar = el('progress', {
    className: 'verify__progress-bar',
    // max=0 は無効なので、総数 0 のときはバーを不定表示にしない（value/max とも 1）
    attributes: { value: String(decided), max: String(Math.max(total, 1)) },
  });
  return el(
    'div',
    {
      id: 'verify-progress',
      className: 'verify__progress',
      attributes: { role: 'status', 'aria-live': 'polite' },
    },
    [text, bar],
  );
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
    if (model.armLocked && isArmDependentLevel(tab)) {
      // arm 未確定のうちは arm / outcome_result タブだけをディム（ui-states.md §3。
      // rob_domain は群構成に依存しないためロックしない）
      button.disabled = true;
      button.classList.add('verify__tab--locked');
      button.setAttribute('aria-disabled', 'true');
    } else {
      button.addEventListener('click', () => handlers.onSelectTab(tab));
    }
    return button;
  });
  return el('div', { className: 'verify__tabs', attributes: { role: 'tablist' } }, buttons);
}

function renderArmCardEditor(
  card: ArmCardModel,
  handlers: VerificationFormHandlers,
): HTMLElement[] {
  const rows = card.rows.map((arm, index) => {
    const input = el('input', {
      className: 'verify__arm-name',
      attributes: { type: 'text', 'aria-label': `群 ${arm.armKey} の名称` },
    });
    input.value = arm.armName;
    input.addEventListener('change', () => handlers.onArmNameChange(index, input.value));
    const removeButton = el('button', {
      className: 'verify__arm-remove',
      text: '削除',
      attributes: { type: 'button', 'aria-label': `群 ${arm.armKey} を削除` },
    });
    removeButton.addEventListener('click', () => handlers.onArmRemoveRow(index));
    return el('li', { className: 'verify__arm-row' }, [
      el('code', { className: 'verify__arm-key', text: arm.armKey }),
      input,
      removeButton,
    ]);
  });

  const addButton = el('button', {
    className: 'verify__arm-add',
    text: '群を追加',
    attributes: { type: 'button' },
  });
  addButton.addEventListener('click', () => handlers.onArmAddRow());

  const confirmButton = el('button', {
    id: 'verify-arm-confirm',
    className: 'verify__arm-confirm',
    text: '群構成を確定',
    attributes: { type: 'button' },
  });
  confirmButton.addEventListener('click', () => handlers.onArmConfirm());

  const actions: HTMLElement[] = [addButton, confirmButton];
  if (card.confirmedVersion !== null) {
    const cancelButton = el('button', {
      className: 'verify__arm-cancel',
      text: 'キャンセル',
      attributes: { type: 'button' },
    });
    cancelButton.addEventListener('click', () => handlers.onArmCancelRevise());
    actions.push(cancelButton);
  }

  const children: HTMLElement[] = [];
  if (card.confirmedVersion === null) {
    children.push(
      el('p', {
        className: 'verify__arm-lead',
        text: 'まず群構成を確定してください（AI ドラフトを初期値に、群の名称・数を確定します）',
      }),
    );
  }
  children.push(el('ul', { className: 'verify__arm-rows' }, rows));
  if (card.error !== null) {
    children.push(
      el('p', {
        id: 'verify-arm-error',
        className: 'verify__arm-error',
        attributes: { role: 'alert' },
        text: card.error,
      }),
    );
  }
  children.push(el('div', { className: 'verify__arm-actions' }, actions));
  return children;
}

function renderArmCardSummary(
  card: ArmCardModel,
  handlers: VerificationFormHandlers,
): HTMLElement[] {
  const reviseButton = el('button', {
    id: 'verify-arm-revise',
    className: 'verify__arm-revise',
    text: '改訂',
    attributes: { type: 'button' },
  });
  reviseButton.addEventListener('click', () => handlers.onArmRevise());
  return [
    el('p', {
      className: 'verify__arm-summary',
      text: `群構成: ${card.rows.length} 群（version ${card.confirmedVersion}）— ${card.rows
        .map((arm) => arm.armName)
        .join(' / ')}`,
    }),
    el('div', { className: 'verify__arm-actions' }, [reviseButton]),
  ];
}

function renderArmCard(card: ArmCardModel, handlers: VerificationFormHandlers): HTMLElement {
  const children: HTMLElement[] = [el('h4', { className: 'verify__arm-heading', text: '群構成' })];
  children.push(
    ...(card.editing ? renderArmCardEditor(card, handlers) : renderArmCardSummary(card, handlers)),
  );
  return el('section', { id: 'verify-arm-card', className: 'verify__arm-card' }, children);
}

export function renderVerificationForm(
  model: VerificationFormModel,
  handlers: VerificationFormHandlers,
): HTMLElement {
  const children: HTMLElement[] = [renderTabs(model, handlers), renderProgress(model.progress)];
  if (model.armCard !== null) {
    children.push(renderArmCard(model.armCard, handlers));
  }
  if (model.armLocked && isArmDependentLevel(model.activeTab)) {
    // study 項目のないスキーマではロック対象タブが初期表示になりうる。本文を確定案内に差し替える
    children.push(
      el('p', {
        className: 'verify__locked-note',
        text: 'まず群構成を確定してください',
      }),
    );
    return el('div', { className: 'verify__form' }, children);
  }
  if (model.tabModel.cells.length === 0) {
    children.push(
      el('p', {
        className: 'verify__empty',
        text: 'このタブに表示できる項目がありません（AI 抽出にインスタンスがありません）',
      }),
    );
  }
  // 未判定（+ 直近判定 1 件）を上に、判定済みを下部ブロックへ送る。
  // 一番上が常に「今判断すべき変数」になる（ui-states.md §3 `#/verify`）
  const { activeGroups, decided } = splitDecidedCells(
    model.tabModel.groups,
    model.recentDecidedKey,
  );
  for (const group of activeGroups) {
    children.push(
      el('section', { className: 'verify__group' }, [
        el('h4', { className: 'verify__group-heading', text: group.heading }),
        ...group.cells.map((cell) => renderCell(cell, model, handlers)),
      ]),
    );
  }
  if (decided.length > 0) {
    children.push(
      el('section', { className: 'verify__group verify__group--decided' }, [
        el('h4', { className: 'verify__group-heading', text: `判定済み（${decided.length}）` }),
        ...decided.map((entry) => renderDecidedRow(entry, model, handlers)),
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
