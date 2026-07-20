// 検証フォーム（S6 / S8 共通の右ペイン。requirements.md §4.2）。
// render は純粋関数で、状態は verificationPanel が管理する。
// - entity タブ（study / arm / outcome_result）→ グループ（section / entity インスタンス）→ セル
// - セル: AI 値 + confidence / anchor_status + quote + 判定チップ + 判定操作
// - anchor_status = failed / ハイライト再特定不能: quote 全文 + 「本文内を検索」フォールバック
// - layoutMode（issue #38）: 'list' は本ファイルの従来どおりのグループ / 判定済みブロック描画、
//   'focus' はユニット単位のマトリクスカード（verificationFocusCard.renderVerificationFocusCard）
//   へ委譲する。タブ行・進捗バー・群構成カード・アウトカム追加フォーム・ロック中タブの案内は
//   モードに関わらず共通描画する
import type { EntityLevel } from '../../domain/schemaField';
import {
  splitDecidedCells,
  type DecidedEntry,
  type TabModel,
} from '../../features/verification/cells';
import { isArmDependentLevel } from '../../features/verification/armDraft';
import type { VerificationProgress } from '../../features/verification/progress';
import type { RobAlgorithmInfo } from '../../features/verification/robAlgorithm';
import { t, type MessageKey } from '../../lib/i18n';
import { el } from '../ui/dom';
import {
  renderCell,
  renderStatusChip,
  type CellHighlightInfo,
} from './verificationCellCard';
import {
  renderVerificationFocusCard,
  type VerificationFocusCardModel,
} from './verificationFocusCard';

export type { CellHighlightInfo } from './verificationCellCard';

/** 群構成確定カード（requirements.md §4.2 / ui-states.md §3 `#/verify`）の表示モデル */
export interface ArmCardModel {
  /** 編集中か（未確定のうちは常に編集中） */
  editing: boolean;
  /** 編集中は編集行、確定済み表示中は確定内容 */
  rows: readonly { armKey: string; armName: string }[];
  /** 確定済み version。null = 未確定 */
  confirmedVersion: number | null;
  error: string | null;
  /**
   * 検証パネルの入力モード（独立二重レビュー機能。design §5.2・§5.3）。省略時は 'review'。
   * 'independent' は初期行を AI ドラフトではなく空行にする案内文言へ差し替える
   * （行自体は armDraft が Evidence 非依存で自然に空を返すため、ここでは文言だけ変える）
   */
  mode?: 'review' | 'independent';
}

export interface OutcomeAddModel {
  outcomeKey: string;
  time: string;
  error: string | null;
}

/**
 * rob_domain タブの「estimate 別の評価を追加」フォーム（issue #109・ui-states.md #/verify）。
 * estimate セレクタ = その study の outcome_result インスタンス、ドメインセレクタ =
 * テンプレート行から得た全ドメイン（ツール非依存）。verificationPanel が組み立てる
 */
export interface RobEstimateAddModel {
  estimateOptions: readonly { key: string; label: string }[];
  domainOptions: readonly { id: string; label: string }[];
  selectedEstimate: string;
  selectedDomain: string;
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
  /** outcome_result タブで、人間が見落としアウトカムを追加するフォーム */
  outcomeAdd: OutcomeAddModel | null;
  /** rob_domain タブで、estimate 別 RoB オーバーライドを宣言するフォーム（issue #109） */
  robEstimateAdd: RobEstimateAddModel | null;
  /** true のとき arm / outcome_result タブをディムし、該当タブの本文を確定案内に差し替える */
  armLocked: boolean;
  /** 全 entity タブ横断の判定進捗（判定のたびに更新。「どこまでやったか」の可視化） */
  progress: VerificationProgress;
  /** レイアウトモード（issue #38）。既定は 'focus' */
  layoutMode: 'focus' | 'list';
  /**
   * フォーカスモード（layoutMode='focus'）時の描画素材。verificationPanel が現在フォーカス中の
   * セルからユニットを解決して組み立てる。cells が 0 件、または解決できないときは null
   * （このときは空メッセージのみを表示する）
   */
  focusCard: VerificationFocusCardModel | null;
  /**
   * 検証パネルの入力モード（独立二重レビュー機能。design §5.2）。省略時は 'review'。
   * セルカード（verificationCellCard.renderCell）の描画を差し替える
   */
  mode?: 'review' | 'independent';
  /**
   * 決定論的な数値整合性チェック（issue #65）の警告。cellKey → メッセージ一覧。
   * verificationPanel が現在タブの TabModel から collectConsistencyWarnings で再計算する
   * （判定・編集のたびに refreshForm 経由で作り直されるため古い警告が残らない）
   */
  consistencyWarnings: ReadonlyMap<string, string[]>;
  /**
   * RoB 2 signaling question からのアルゴリズム提案（issue #61）。cellKey → 情報。
   * verificationPanel が現在タブの TabModel から collectRobAlgorithmInfo で再計算する
   */
  robAlgorithmInfo: ReadonlyMap<string, RobAlgorithmInfo>;
  /** relocate-quote（issue #94）: 「AI で再特定」ボタンを出すか。verificationCellCard.CellCardModel 参照 */
  canRelocateQuote?: boolean;
  /** relocate-quote の実行状態（issue #94）。cellKey → 'running' / 'not_found' */
  relocateStatus?: ReadonlyMap<string, 'running' | 'not_found'>;
  /**
   * flow 図（mermaid）の保存時構文チェック警告（issue #109）。cellKey → 理由。
   * verificationPanel が編集保存時に parseMermaid で検査して載せる（保存はブロックしない）
   */
  mermaidWarnings?: ReadonlyMap<string, string>;
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
  /** 「AI で再特定」ボタン（issue #94） */
  onRelocateQuote(cellKey: string): void;
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
  onOutcomeKeyChange(value: string): void;
  onOutcomeTimeChange(value: string): void;
  onOutcomeAdd(): void;
  /** estimate 別 RoB 評価の宣言フォーム（issue #109） */
  onRobEstimateKeyChange(value: string): void;
  onRobEstimateDomainChange(value: string): void;
  onRobEstimateAdd(): void;
  /** レイアウトモード切替（`#verify-layout-toggle`）。永続化はサービス層の責務 */
  onToggleLayoutMode(mode: 'focus' | 'list'): void;
  /**
   * フォーカスモードのユニット送り（issue #82。ユニットヘッダの前後ボタン）。
   * verificationFocusCard.VerificationFocusCardHandlers へそのまま渡る
   */
  onMoveUnit(delta: number): void;
}

// 表示言語に追従させるため、ラベルは描画時に t() で解決する（キー対応表のみ固定。issue #93）
const TAB_LABEL_KEYS: Record<EntityLevel, MessageKey> = {
  study: 'verify.tabStudy',
  arm: 'verify.tabArm',
  outcome_result: 'verify.tabOutcome',
  rob_domain: 'verify.tabRob',
};

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
      text: t('verify.decidedValue', { value: cell.state.value ?? t('verify.valueEmpty') }),
    }),
  );
  const row = el(
    'button',
    {
      className: 'verify__cell verify__cell--decided',
      attributes: { type: 'button', title: t('verify.decidedRowTitle') },
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

/** 「判定済み N / M（残り R）」の定型文（R=0 は「すべて判定済み」） */
function progressText(decided: number, total: number): string {
  const remaining = Math.max(total - decided, 0);
  return t('verify.progressText', {
    decided,
    total,
    suffix:
      remaining > 0 ? t('verify.progressRemaining', { n: remaining }) : t('verify.progressComplete'),
  });
}

/**
 * 判定進捗バー。バーと主表示は「今見ているタブ」ぶんを数える（映っていないタブのセルまで
 * 残数に混ぜて混乱するのを避ける）。全 entity タブの合算は副表示で併記する。
 * 判定のたびに refreshForm で作り直され即時更新される（automation bias 対策 UI の一部）
 */
function renderProgress(progress: VerificationProgress, activeTab: EntityLevel): HTMLElement {
  const tab = progress.byTab.find((entry) => entry.tab === activeTab) ?? { decided: 0, total: 0 };
  const text = el('span', {
    className: 'verify__progress-text',
    text:
      tab.total === 0
        ? t('verify.progressEmptyTab')
        : `${t(TAB_LABEL_KEYS[activeTab])}: ${progressText(tab.decided, tab.total)}`,
  });
  const bar = el('progress', {
    className: 'verify__progress-bar',
    // max=0 は無効なので、総数 0 のときはバーを不定表示にしない（value/max とも 1）
    attributes: { value: String(tab.decided), max: String(Math.max(tab.total, 1)) },
  });
  const children: HTMLElement[] = [text, bar];
  // タブが 2 枚以上あるときだけ全体合算を併記する（1 枚ならタブ表示と同値で冗長）
  if (progress.byTab.length > 1) {
    children.push(
      el('span', {
        className: 'verify__progress-overall',
        text: t('verify.progressOverall', { progress: progressText(progress.decided, progress.total) }),
      }),
    );
  }
  return el(
    'div',
    {
      id: 'verify-progress',
      className: 'verify__progress',
      attributes: { role: 'status', 'aria-live': 'polite' },
    },
    children,
  );
}

function renderTabs(model: VerificationFormModel, handlers: VerificationFormHandlers): HTMLElement {
  const buttons = model.tabs.map((tab) => {
    const button = el('button', {
      className: 'verify__tab',
      text: t(TAB_LABEL_KEYS[tab]),
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

/**
 * フォーカス ⇄ リストのレイアウトモード切替（issue #38）。タブ行の隣に置く。
 * ボタンには切替先のラベルを出す（「フォーカス表示」中は「リスト表示に切替」）
 */
function renderLayoutToggle(
  model: VerificationFormModel,
  handlers: VerificationFormHandlers,
): HTMLElement {
  const isFocus = model.layoutMode === 'focus';
  const nextMode = isFocus ? 'list' : 'focus';
  const button = el('button', {
    id: 'verify-layout-toggle',
    className: 'verify__layout-toggle',
    text: isFocus ? t('verify.layoutToList') : t('verify.layoutToFocus'),
    attributes: {
      type: 'button',
      'aria-pressed': String(isFocus),
      title: isFocus ? t('verify.layoutToList') : t('verify.layoutToFocus'),
    },
  });
  button.addEventListener('click', () => handlers.onToggleLayoutMode(nextMode));
  return button;
}

function renderArmCardEditor(
  card: ArmCardModel,
  handlers: VerificationFormHandlers,
): HTMLElement[] {
  const rows = card.rows.map((arm, index) => {
    const input = el('input', {
      className: 'verify__arm-name',
      attributes: { type: 'text', 'aria-label': t('verify.armNameAria', { key: arm.armKey }) },
    });
    input.value = arm.armName;
    input.addEventListener('change', () => handlers.onArmNameChange(index, input.value));
    const removeButton = el('button', {
      className: 'verify__arm-remove',
      text: t('verify.armRemove'),
      attributes: { type: 'button', 'aria-label': t('verify.armRemoveAria', { key: arm.armKey }) },
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
    text: t('verify.armAdd'),
    attributes: { type: 'button' },
  });
  addButton.addEventListener('click', () => handlers.onArmAddRow());

  const confirmButton = el('button', {
    id: 'verify-arm-confirm',
    className: 'verify__arm-confirm',
    text: t('verify.armConfirm'),
    attributes: { type: 'button' },
  });
  confirmButton.addEventListener('click', () => handlers.onArmConfirm());

  const actions: HTMLElement[] = [addButton, confirmButton];
  if (card.confirmedVersion !== null) {
    const cancelButton = el('button', {
      className: 'verify__arm-cancel',
      text: t('common.cancel'),
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
        text: card.mode === 'independent' ? t('verify.armLeadIndependent') : t('verify.armLead'),
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
    text: t('verify.armRevise'),
    attributes: { type: 'button' },
  });
  reviseButton.addEventListener('click', () => handlers.onArmRevise());
  return [
    el('p', {
      className: 'verify__arm-summary',
      text: t('verify.armSummary', {
        count: card.rows.length,
        version: String(card.confirmedVersion),
        names: card.rows.map((arm) => arm.armName).join(' / '),
      }),
    }),
    el('div', { className: 'verify__arm-actions' }, [reviseButton]),
  ];
}

function renderArmCard(card: ArmCardModel, handlers: VerificationFormHandlers): HTMLElement {
  const children: HTMLElement[] = [el('h4', { className: 'verify__arm-heading', text: t('verify.armHeading') })];
  children.push(
    ...(card.editing ? renderArmCardEditor(card, handlers) : renderArmCardSummary(card, handlers)),
  );
  return el('section', { id: 'verify-arm-card', className: 'verify__arm-card' }, children);
}

function renderOutcomeAdd(
  model: OutcomeAddModel,
  handlers: VerificationFormHandlers,
): HTMLElement {
  const keyInput = el('input', {
    id: 'verify-outcome-key',
    className: 'verify__outcome-key',
    attributes: { type: 'text' },
  });
  keyInput.value = model.outcomeKey;
  keyInput.addEventListener('change', () => handlers.onOutcomeKeyChange(keyInput.value));

  const timeInput = el('input', {
    id: 'verify-outcome-time',
    className: 'verify__outcome-time',
    attributes: { type: 'text' },
  });
  timeInput.value = model.time;
  timeInput.addEventListener('change', () => handlers.onOutcomeTimeChange(timeInput.value));

  const addButton = el('button', {
    id: 'verify-outcome-add-button',
    className: 'verify__outcome-add-button',
    text: t('verify.outcomeAddTitle'),
    attributes: { type: 'button' },
  });
  addButton.addEventListener('click', () => handlers.onOutcomeAdd());

  const children: HTMLElement[] = [
    el('h4', { className: 'verify__outcome-heading', text: t('verify.outcomeAddTitle') }),
    el('div', { className: 'verify__outcome-fields' }, [
      el('label', { className: 'verify__outcome-field', attributes: { for: 'verify-outcome-key' } }, [
        t('verify.outcomeKeyLabel'),
        keyInput,
      ]),
      el('label', { className: 'verify__outcome-field', attributes: { for: 'verify-outcome-time' } }, [
        t('verify.outcomeTimeLabel'),
        timeInput,
      ]),
      addButton,
    ]),
  ];
  if (model.error !== null) {
    children.push(
      el('p', {
        id: 'verify-outcome-error',
        className: 'verify__outcome-error',
        attributes: { role: 'alert' },
        text: model.error,
      }),
    );
  }
  return el('section', { id: 'verify-outcome-add', className: 'verify__outcome-add' }, children);
}

/** 選択肢付き select を組み立てる（estimate 別 RoB 宣言フォームの 2 セレクタ共用） */
function renderRobEstimateSelect(
  id: string,
  className: string,
  options: readonly { value: string; label: string }[],
  selected: string,
  onChange: (value: string) => void,
): HTMLSelectElement {
  const select = el('select', { id, className });
  for (const option of options) {
    const optionEl = el('option', { text: option.label });
    optionEl.value = option.value;
    select.append(optionEl);
  }
  select.value = selected;
  select.addEventListener('change', () => onChange(select.value));
  return select;
}

/**
 * rob_domain タブの「estimate 別の評価を追加」フォーム（issue #109・ui-states.md #/verify）。
 * `#verify-outcome-add` と同型: 宣言は Decisions のインスタンス宣言イベントとして追記される
 */
function renderRobEstimateAdd(
  model: RobEstimateAddModel,
  handlers: VerificationFormHandlers,
): HTMLElement {
  const keySelect = renderRobEstimateSelect(
    'verify-rob-est-key',
    'verify__rob-est-key',
    model.estimateOptions.map((option) => ({ value: option.key, label: option.label })),
    model.selectedEstimate,
    (value) => handlers.onRobEstimateKeyChange(value),
  );
  const domainSelect = renderRobEstimateSelect(
    'verify-rob-est-domain',
    'verify__rob-est-domain',
    model.domainOptions.map((option) => ({
      value: option.id,
      label: `${option.id} (${option.label})`,
    })),
    model.selectedDomain,
    (value) => handlers.onRobEstimateDomainChange(value),
  );

  const addButton = el('button', {
    id: 'verify-rob-est-add-button',
    className: 'verify__rob-est-add-button',
    text: t('verify.robEstAddTitle'),
    attributes: { type: 'button' },
  });
  addButton.addEventListener('click', () => handlers.onRobEstimateAdd());

  const children: HTMLElement[] = [
    el('h4', { className: 'verify__rob-est-heading', text: t('verify.robEstAddTitle') }),
    el('div', { className: 'verify__rob-est-fields' }, [
      el('label', { className: 'verify__rob-est-field', attributes: { for: 'verify-rob-est-key' } }, [
        t('verify.robEstKeyLabel'),
        keySelect,
      ]),
      el(
        'label',
        { className: 'verify__rob-est-field', attributes: { for: 'verify-rob-est-domain' } },
        [t('verify.robEstDomainLabel'), domainSelect],
      ),
      addButton,
    ]),
  ];
  if (model.error !== null) {
    children.push(
      el('p', {
        id: 'verify-rob-est-error',
        className: 'verify__rob-est-error',
        attributes: { role: 'alert' },
        text: model.error,
      }),
    );
  }
  return el('section', { id: 'verify-rob-est-add', className: 'verify__rob-est-add' }, children);
}

/** ショートカット注記の文言（モードごとにキー割当が異なる。ui-flow.md §7） */
function shortcutNoteText(layoutMode: 'focus' | 'list'): string {
  return layoutMode === 'focus' ? t('verify.shortcutNoteFocus') : t('verify.shortcutNoteList');
}

/**
 * フォームのルート要素を組み立てる（`verify__form` 直下は呼び出しごとに分岐が異なるため、
 * 4 箇所の return を 1 箇所へ集約する）。整合性チェック警告ブロック
 * （`.verify__consistency-warnings`。verificationCellCard.renderCell が付与）・
 * RoB アルゴリズム不一致警告ブロック（`.verify__rob-mismatch-warnings`。同じく renderCell が付与。
 * issue #61）は、いずれもリストモードで同時に複数セルへ表示されうるため、id 重複を避けて
 * 最初の 1 件にだけ id を付ける（E2E から一意に特定するため。他は class のみで検索可能）
 */
function finalizeForm(children: HTMLElement[]): HTMLElement {
  const root = el('div', { className: 'verify__form' }, children);
  const firstWarningBlock = root.querySelector('.verify__consistency-warnings');
  if (firstWarningBlock !== null) {
    firstWarningBlock.id = 'verify-consistency-warning';
  }
  const firstRobWarningBlock = root.querySelector('.verify__rob-mismatch-warnings');
  if (firstRobWarningBlock !== null) {
    firstRobWarningBlock.id = 'verify-rob-algorithm-warning';
  }
  return root;
}

export function renderVerificationForm(
  model: VerificationFormModel,
  handlers: VerificationFormHandlers,
): HTMLElement {
  const children: HTMLElement[] = [
    el('div', { className: 'verify__form-header' }, [
      renderTabs(model, handlers),
      renderLayoutToggle(model, handlers),
    ]),
    renderProgress(model.progress, model.activeTab),
  ];
  if (model.armCard !== null) {
    children.push(renderArmCard(model.armCard, handlers));
  }
  if (model.outcomeAdd !== null) {
    children.push(renderOutcomeAdd(model.outcomeAdd, handlers));
  }
  if (model.robEstimateAdd !== null) {
    children.push(renderRobEstimateAdd(model.robEstimateAdd, handlers));
  }
  if (model.armLocked && isArmDependentLevel(model.activeTab)) {
    // study 項目のないスキーマではロック対象タブが初期表示になりうる。本文を確定案内に差し替える
    children.push(
      el('p', {
        className: 'verify__locked-note',
        text: t('verify.lockedNote'),
      }),
    );
    return finalizeForm(children);
  }
  if (model.tabModel.cells.length === 0) {
    children.push(
      el('p', {
        className: 'verify__empty',
        text: t('verify.emptyTab'),
      }),
    );
    children.push(el('p', { className: 'verify__shortcut-note', text: shortcutNoteText(model.layoutMode) }));
    return finalizeForm(children);
  }
  if (model.layoutMode === 'focus') {
    // フォーカスモード（issue #38）: ユニット単位のマトリクスカードへ委譲する。
    // focusCard は verificationPanel が現在フォーカス中のセルから解決するため、
    // cells.length > 0 の間は基本的に非 null（防御的に null を許容する）
    if (model.focusCard !== null) {
      children.push(renderVerificationFocusCard(model.focusCard, handlers));
    }
    children.push(el('p', { className: 'verify__shortcut-note', text: shortcutNoteText('focus') }));
    return finalizeForm(children);
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
        el('h4', { className: 'verify__group-heading', text: t('verify.decidedGroupHeading', { n: decided.length }) }),
        ...decided.map((entry) => renderDecidedRow(entry, model, handlers)),
      ]),
    );
  }
  children.push(
    el('p', {
      className: 'verify__shortcut-note',
      text: shortcutNoteText('list'),
    }),
  );
  return finalizeForm(children);
}
