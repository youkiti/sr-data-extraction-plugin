// 検証セルカード（S6 / S8 共通の判定カード。requirements.md §4.2）。
// verificationForm.ts（リストモード）と verificationFocusCard.ts（issue #38 フォーカスモードの
// 詳細ストリップ）の双方から使う純 render を切り出したモジュール。renderCell 自体の見た目・挙動は
// 変更せず、参照する状態・ハンドラを実際に使う分だけへ最小化した型（CellCardModel /
// CellCardHandlers）を公開する — VerificationFormModel / VerificationFormHandlers は
// フィールドを維持したまま構造的にこの部分型を満たすため、呼び出し側の変更は不要
import { NOT_REPORTED_TOKEN } from '../../domain/annotation';
import type { VerificationCell } from '../../features/verification/cells';
import type { CellStatus } from '../../features/verification/cellState';
import type { RobAlgorithmInfo } from '../../features/verification/robAlgorithm';
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
  /**
   * 検証パネルの入力モード（独立二重レビュー機能。design §5.2）。省略時は 'review'。
   * 'independent'（reviewer_independent）は Evidence quote・ハイライト・AI 値の表示・
   * accept / reject 操作を描画しない（AI 抽出を一切見せない盲検レビュー）
   */
  mode?: 'review' | 'independent';
  /**
   * 決定論的な数値整合性チェック（issue #65）の警告。cellKey → メッセージ一覧。
   * verificationPanel が judgment/state 変更のたびに collectConsistencyWarnings で再計算する
   */
  consistencyWarnings: ReadonlyMap<string, string[]>;
  /**
   * RoB 2 signaling question からのアルゴリズム提案（issue #61）。cellKey → 情報。
   * verificationPanel が judgment/state 変更のたびに collectRobAlgorithmInfo で再計算する。
   * rob_domain タブの judgement セル以外は該当エントリを持たない
   */
  robAlgorithmInfo: ReadonlyMap<string, RobAlgorithmInfo>;
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

/**
 * 決定論的な数値整合性チェック（issue #65）の警告一覧。LLM を使わない第 3 の独立検証系であり、
 * 判定操作は増やさない情報提示のみ。該当メッセージが無ければ null（描画しない）
 */
function renderConsistencyWarnings(cell: VerificationCell, model: CellCardModel): HTMLElement | null {
  const messages = model.consistencyWarnings.get(cell.cellKey);
  if (messages === undefined || messages.length === 0) {
    return null;
  }
  return el(
    'div',
    { className: 'verify__consistency-warnings', attributes: { role: 'note' } },
    messages.map((message) => el('p', { className: 'verify__consistency-warning', text: `⚠ ${message}` })),
  );
}

/**
 * RoB 2 signaling question からのアルゴリズム提案（issue #61）。判定操作は増やさない情報提示のみ:
 * 1. 提案チップ（suggestion があれば常に表示）
 * 2. 不一致警告（#65 の `.verify__consistency-warnings` と同じ見た目・パターン。mismatch のときだけ）
 * 3. AI 判定・未確認バッジ（aiUnconfirmed のときだけ。人間がまだ 1 度も判定していない AI 抽出値の明示）
 * 該当情報が 1 つも無ければ null（描画しない）
 */
function renderRobAlgorithmInfo(cell: VerificationCell, model: CellCardModel): HTMLElement | null {
  const info = model.robAlgorithmInfo.get(cell.cellKey);
  if (info === undefined) {
    return null;
  }
  const children: HTMLElement[] = [];
  if (info.suggestion !== null) {
    children.push(
      el('p', {
        className: 'verify__rob-suggestion',
        text: `アルゴリズム提案: ${info.suggestion}`,
      }),
    );
  }
  if (info.mismatch) {
    children.push(
      el(
        'div',
        { className: 'verify__rob-mismatch-warnings', attributes: { role: 'note' } },
        [
          el('p', {
            className: 'verify__rob-mismatch-warning',
            text:
              `⚠ アルゴリズム提案 (${info.suggestion}) と現在の判定 (${info.currentValue}) が` +
              '一致しません',
          }),
        ],
      ),
    );
  }
  if (info.aiUnconfirmed) {
    children.push(
      el('p', {
        className: 'verify__rob-unconfirmed',
        text: 'AI 判定・未確認（まだ人が確認していません）',
      }),
    );
  }
  if (children.length === 0) {
    return null;
  }
  return el('div', { className: 'verify__rob-algorithm' }, children);
}

/**
 * 独立入力モードで AI 値の代わりに出す抽出指示（design §5.2: 「フィールドのラベル +
 * extraction_instruction（何を抽出するかの定義はスキーマ由来であり AI 出力ではないため表示可）」）
 */
function renderExtractionInstruction(cell: VerificationCell): HTMLElement {
  return el('p', {
    className: 'verify__instruction',
    text: cell.field.extractionInstruction,
  });
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
  mode: 'review' | 'independent',
): HTMLElement {
  const input = el('input', {
    className: 'verify__edit-input',
    attributes: {
      type: 'text',
      'aria-label': `${cell.field.fieldLabel} の値`,
    },
  });
  // edit は現在値（未検証なら AI 値）から修正し、reject は白紙から手入力する（§4.2）。
  // 独立入力モードは AI 値を一切見せないため、確定値が無ければ空欄から始める（design §5.2）
  if (action === 'edit') {
    const aiValue = mode === 'independent' ? undefined : cell.evidence?.value;
    input.value = cell.state.value ?? aiValue ?? '';
  }
  // 独立入力モードは「AI 値の修正」ではなく「自分で値を入力する」ため文言を言い換える
  // （reject は独立入力モードでは到達しない操作。renderActions が棄却ボタンを出さない）
  const confirmButton = el('button', {
    className: 'verify__edit-confirm',
    text: mode === 'independent' ? '入力して確定' : action === 'edit' ? '修正して確定' : '棄却して確定',
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

/** 独立入力モードの「入力 (e)」ボタン（承認・棄却は AI 値が無いため出さない。design §5.2） */
function renderEditButton(cell: VerificationCell, handlers: CellCardHandlers, label: string): HTMLElement {
  const edit = el('button', {
    className: 'verify__action verify__action--edit',
    text: label,
    attributes: { type: 'button' },
  });
  edit.addEventListener('click', () => handlers.onStartEdit(cell.cellKey, 'edit'));
  return edit;
}

function renderNotReportedButton(cell: VerificationCell, handlers: CellCardHandlers): HTMLElement {
  const notReported = el('button', {
    className: 'verify__action verify__action--not-reported',
    text: '未報告 (n)',
    attributes: { type: 'button' },
  });
  notReported.addEventListener('click', () => handlers.onNotReported(cell.cellKey));
  return notReported;
}

function renderUndoButton(cell: VerificationCell, handlers: CellCardHandlers): HTMLElement {
  const undo = el('button', {
    className: 'verify__action verify__action--undo',
    text: '戻す (z)',
    attributes: { type: 'button' },
  });
  undo.disabled = cell.state.stack.length === 0;
  undo.addEventListener('click', () => handlers.onUndo(cell.cellKey));
  return undo;
}

function renderActions(
  cell: VerificationCell,
  handlers: CellCardHandlers,
  mode: 'review' | 'independent',
): HTMLElement {
  if (mode === 'independent') {
    // 独立入力モード（design §5.2）: 承認 / 棄却は AI 値が無いため出さない。
    // 「入力」「未報告」「戻す」の 3 操作のみ（キーボード a / x の無効化はパネル側で行う）
    return el('div', { className: 'verify__actions' }, [
      renderEditButton(cell, handlers, '入力 (e)'),
      renderNotReportedButton(cell, handlers),
      renderUndoButton(cell, handlers),
    ]);
  }
  const accept = el('button', {
    className: 'verify__action verify__action--accept',
    text: '承認 (a)',
    attributes: { type: 'button' },
  });
  accept.disabled = cell.evidence === null;
  accept.addEventListener('click', () => handlers.onAccept(cell.cellKey));

  const reject = el('button', {
    className: 'verify__action verify__action--reject',
    text: '棄却 (x)',
    attributes: { type: 'button' },
  });
  reject.addEventListener('click', () => handlers.onStartEdit(cell.cellKey, 'reject'));

  return el('div', { className: 'verify__actions' }, [
    accept,
    renderEditButton(cell, handlers, '修正 (e)'),
    reject,
    renderNotReportedButton(cell, handlers),
    renderUndoButton(cell, handlers),
  ]);
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
  const mode = model.mode ?? 'review';
  // 独立入力モード（design §5.2）: AI 値・quote・ハイライトは一切描画しない
  // （出所文書の分岐に依らず、mode で明示的にゲートする）。代わりにスキーマ由来の
  // extraction_instruction を出す（AI 出力ではないため表示してよい）
  const children: HTMLElement[] = [
    header,
    mode === 'independent' ? renderExtractionInstruction(cell) : renderAiSummary(cell),
  ];
  const consistencyWarnings = renderConsistencyWarnings(cell, model);
  if (consistencyWarnings !== null) {
    children.push(consistencyWarnings);
  }
  const robAlgorithmInfo = renderRobAlgorithmInfo(cell, model);
  if (robAlgorithmInfo !== null) {
    children.push(robAlgorithmInfo);
  }
  if (cell.state.status !== 'unverified') {
    children.push(
      el('p', {
        className: 'verify__current-value',
        text: `確定値: ${cell.state.value ?? '（空）'}`,
      }),
    );
  }
  const quote = mode === 'independent' ? null : renderQuote(cell, model, handlers);
  if (quote !== null) {
    children.push(quote);
  }
  if (model.editing !== null && model.editing.cellKey === cell.cellKey) {
    children.push(renderEditor(cell, model.editing.action, handlers, mode));
  } else {
    children.push(renderActions(cell, handlers, mode));
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
