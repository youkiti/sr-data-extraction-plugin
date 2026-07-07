import {
  renderVerificationForm,
  type CellHighlightInfo,
  type VerificationFormHandlers,
  type VerificationFormModel,
} from '../../../../src/app/views/verificationForm';
import type { Evidence } from '../../../../src/domain/evidence';
import type { SchemaField } from '../../../../src/domain/schemaField';
import type { TabModel, VerificationCell } from '../../../../src/features/verification/cells';
import { cellKeyOf, emptyCellState, type CellState } from '../../../../src/features/verification/cellState';

function makeField(overrides: Partial<SchemaField> = {}): SchemaField {
  return {
    schemaVersion: 1,
    fieldId: 'f-1',
    fieldIndex: 1,
    section: 'methods',
    fieldName: 'sample_size_total',
    fieldLabel: '総サンプルサイズ',
    entityLevel: 'study',
    dataType: 'integer',
    unit: null,
    allowedValues: null,
    required: true,
    extractionInstruction: '総 N を抽出',
    example: null,
    aiGenerated: false,
    note: null,
    ...overrides,
  };
}

function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    evidenceId: 'ev-1',
    runId: 'run-1',
    documentId: 'doc-1',
    fieldId: 'f-1',
    entityKey: '-',
    value: '120',
    notReported: false,
    quote: 'a total of 120 patients',
    page: 1,
    confidence: 'high',
    anchorStatus: 'exact',
    ...overrides,
  };
}

function makeCell(overrides: Partial<VerificationCell> = {}): VerificationCell {
  const field = overrides.field ?? makeField();
  const entityKey = overrides.entityKey ?? '-';
  return {
    cellKey: cellKeyOf(field.fieldId, entityKey),
    field,
    entityKey,
    evidence: makeEvidence(),
    state: emptyCellState(),
    ...overrides,
  };
}

function makeHandlers(): jest.Mocked<VerificationFormHandlers> {
  return {
    onSelectTab: jest.fn(),
    onFocusCell: jest.fn(),
    onAccept: jest.fn(),
    onStartEdit: jest.fn(),
    onConfirmEdit: jest.fn(),
    onCancelEdit: jest.fn(),
    onNotReported: jest.fn(),
    onUndo: jest.fn(),
    onJump: jest.fn(),
    onSearchQuote: jest.fn(),
    onCycleMatch: jest.fn(),
    onExpandDecided: jest.fn(),
    onCollapseDecided: jest.fn(),
    onArmNameChange: jest.fn(),
    onArmAddRow: jest.fn(),
    onArmRemoveRow: jest.fn(),
    onArmConfirm: jest.fn(),
    onArmRevise: jest.fn(),
    onArmCancelRevise: jest.fn(),
  };
}

function makeModel(
  cells: VerificationCell[],
  overrides: Partial<VerificationFormModel> = {},
): VerificationFormModel {
  const tabModel: TabModel = {
    groups: cells.length === 0 ? [] : [{ heading: 'methods', cells }],
    cells,
  };
  return {
    tabs: ['study', 'arm'],
    activeTab: 'study',
    tabModel,
    focusedCellKey: null,
    editing: null,
    recentDecidedKey: null,
    expandedDecidedKey: null,
    highlightInfo: new Map<string, CellHighlightInfo>(),
    canSearchText: true,
    armCard: null,
    armLocked: false,
    progress: { decided: 0, total: cells.length },
    ...overrides,
  };
}

function render(model: VerificationFormModel, handlers = makeHandlers()) {
  const root = renderVerificationForm(model, handlers);
  document.body.replaceChildren(root);
  return { root, handlers };
}

describe('renderVerificationForm', () => {
  test('タブ・グループ・ショートカット注記を描画する', () => {
    const { root, handlers } = render(makeModel([makeCell()]));
    const tabs = root.querySelectorAll<HTMLButtonElement>('.verify__tab');
    expect(tabs).toHaveLength(2);
    expect(tabs[0]?.classList.contains('verify__tab--active')).toBe(true);
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
    expect(tabs[1]?.getAttribute('aria-selected')).toBe('false');
    tabs[1]?.click();
    expect(handlers.onSelectTab).toHaveBeenCalledWith('arm');
    expect(root.querySelector('.verify__group-heading')?.textContent).toBe('methods');
    expect(root.querySelector('.verify__shortcut-note')).not.toBeNull();
  });

  test('セルが無いタブは空メッセージを出す', () => {
    const { root } = render(makeModel([]));
    expect(root.querySelector('.verify__empty')?.textContent).toContain(
      'このタブに表示できる項目がありません',
    );
  });

  test('判定進捗バーを描画する（判定済み / 総数 + 残り）', () => {
    const { root } = render(
      makeModel([makeCell()], { progress: { decided: 3, total: 10 } }),
    );
    const progress = root.querySelector('#verify-progress');
    expect(progress?.getAttribute('role')).toBe('status');
    expect(progress?.getAttribute('aria-live')).toBe('polite');
    expect(root.querySelector('.verify__progress-text')?.textContent).toBe(
      '判定済み 3 / 10（残り 7）',
    );
    const bar = root.querySelector<HTMLProgressElement>('.verify__progress-bar');
    expect(bar?.getAttribute('value')).toBe('3');
    expect(bar?.getAttribute('max')).toBe('10');
  });

  test('全件判定済みは「すべて判定済み」、総数 0 は対象なしを出す', () => {
    const done = render(makeModel([makeCell()], { progress: { decided: 5, total: 5 } }));
    expect(done.root.querySelector('.verify__progress-text')?.textContent).toBe(
      '判定済み 5 / 5（すべて判定済み）',
    );
    // 総数 0 でも progress の max は 1 に落として不定表示を避ける
    const none = render(makeModel([], { progress: { decided: 0, total: 0 } }));
    expect(none.root.querySelector('.verify__progress-text')?.textContent).toBe(
      '判定対象の項目がありません',
    );
    expect(none.root.querySelector<HTMLProgressElement>('.verify__progress-bar')?.getAttribute('max')).toBe('1');
  });

  test('AI 抽出なしセルは注記を出し、承認を無効化する', () => {
    const { root } = render(makeModel([makeCell({ evidence: null })]));
    expect(root.querySelector('.verify__ai--none')?.textContent).toContain('AI 抽出なし');
    expect(root.querySelector<HTMLButtonElement>('.verify__action--accept')?.disabled).toBe(true);
    expect(root.querySelector('.verify__quote')).toBeNull();
  });

  test('AI 値・confidence・anchor_status のバッジを表示する', () => {
    const { root } = render(makeModel([makeCell()]));
    expect(root.querySelector('.verify__ai-value')?.textContent).toBe('120');
    expect(root.querySelector('.verify__badge--confidence-high')?.textContent).toBe(
      'confidence: high',
    );
    expect(root.querySelector('.verify__badge--anchor-exact')?.textContent).toBe('anchor: exact');
  });

  test('not_reported な AI 値は「未報告（NR）」、値なしは「（値なし）」', () => {
    const { root } = render(
      makeModel([
        makeCell({ evidence: makeEvidence({ notReported: true, value: null }) }),
        makeCell({
          field: makeField({ fieldId: 'f-2' }),
          evidence: makeEvidence({
            fieldId: 'f-2',
            value: null,
            confidence: null,
            anchorStatus: null,
          }),
        }),
      ]),
    );
    const values = root.querySelectorAll('.verify__ai-value');
    expect(values[0]?.textContent).toBe('未報告（NR）');
    expect(values[1]?.textContent).toBe('（値なし）');
    expect(root.querySelectorAll('.verify__badge')).toHaveLength(2); // f-2 はバッジなし
  });

  test('アンカー済み quote はジャンプボタン、複数一致なら切替ボタンを出す', () => {
    const cell = makeCell();
    const info = new Map([[cell.cellKey, { matchCount: 3, matchIndex: 1 }]]);
    const { root, handlers } = render(makeModel([cell], { highlightInfo: info }));
    root.querySelector<HTMLButtonElement>('.verify__quote-jump')?.click();
    expect(handlers.onJump).toHaveBeenCalledWith(cell.cellKey);
    const cycle = root.querySelector<HTMLButtonElement>('.verify__quote-cycle');
    expect(cycle?.textContent).toBe('他 2 箇所に一致（2 / 3）');
    cycle?.click();
    expect(handlers.onCycleMatch).toHaveBeenCalledWith(cell.cellKey);
  });

  test('一致 1 件のみなら切替ボタンは出さない', () => {
    const cell = makeCell();
    const info = new Map([[cell.cellKey, { matchCount: 1, matchIndex: 0 }]]);
    const { root } = render(makeModel([cell], { highlightInfo: info }));
    expect(root.querySelector('.verify__quote-jump')).not.toBeNull();
    expect(root.querySelector('.verify__quote-cycle')).toBeNull();
  });

  test('アンカー不能な quote は全文 + 「本文内を検索」を出す（anchor failed のフォールバック）', () => {
    const cell = makeCell({ evidence: makeEvidence({ anchorStatus: 'failed' }) });
    const { root, handlers } = render(makeModel([cell]));
    expect(root.querySelector('.verify__quote-text')?.textContent).toBe('a total of 120 patients');
    expect(root.querySelector('.verify__quote-unanchored')).not.toBeNull();
    root.querySelector<HTMLButtonElement>('.verify__quote-search')?.click();
    expect(handlers.onSearchQuote).toHaveBeenCalledWith('a total of 120 patients');
  });

  test('ハイライト 0 件（matchCount = 0）もフォールバック扱いになる', () => {
    const cell = makeCell();
    const info = new Map([[cell.cellKey, { matchCount: 0, matchIndex: 0 }]]);
    const { root } = render(makeModel([cell], { highlightInfo: info }));
    expect(root.querySelector('.verify__quote-unanchored')).not.toBeNull();
  });

  test('テキスト層なし（canSearchText = false）では検索ボタンを出さない（ui-states.md §3）', () => {
    const cell = makeCell({ evidence: makeEvidence({ anchorStatus: 'failed' }) });
    const { root } = render(makeModel([cell], { canSearchText: false }));
    expect(root.querySelector('.verify__quote-search')).toBeNull();
  });

  test('quote が無い Evidence は quote ブロックを出さない', () => {
    const { root } = render(makeModel([makeCell({ evidence: makeEvidence({ quote: null }) })]));
    expect(root.querySelector('.verify__quote')).toBeNull();
  });

  test('判定チップと確定値: 未検証はチップのみ、直近判定セルは元の位置に確定値付きで残る', () => {
    const accepted: CellState = {
      status: 'accept',
      value: '120',
      stack: [],
    };
    const acceptedCell = makeCell({ field: makeField({ fieldId: 'f-2' }), state: accepted });
    const { root } = render(
      makeModel([makeCell(), acceptedCell], { recentDecidedKey: acceptedCell.cellKey }),
    );
    const chips = root.querySelectorAll('.verify__chip');
    expect(chips[0]?.textContent).toBe('未検証');
    expect(chips[1]?.textContent).toBe('承認');
    const values = root.querySelectorAll('.verify__current-value');
    expect(values).toHaveLength(1);
    expect(values[0]?.textContent).toBe('確定値: 120');
    // 直近判定の 1 件は判定済みブロックへ送らない
    expect(root.querySelector('.verify__group--decided')).toBeNull();
  });

  test('判定操作ボタンがハンドラを呼ぶ（undo は履歴が空なら無効）', () => {
    const cell = makeCell();
    const { root, handlers } = render(makeModel([cell]));
    root.querySelector<HTMLButtonElement>('.verify__action--accept')?.click();
    expect(handlers.onAccept).toHaveBeenCalledWith(cell.cellKey);
    root.querySelector<HTMLButtonElement>('.verify__action--edit')?.click();
    expect(handlers.onStartEdit).toHaveBeenCalledWith(cell.cellKey, 'edit');
    root.querySelector<HTMLButtonElement>('.verify__action--reject')?.click();
    expect(handlers.onStartEdit).toHaveBeenCalledWith(cell.cellKey, 'reject');
    root.querySelector<HTMLButtonElement>('.verify__action--not-reported')?.click();
    expect(handlers.onNotReported).toHaveBeenCalledWith(cell.cellKey);
    const undo = root.querySelector<HTMLButtonElement>('.verify__action--undo');
    expect(undo?.disabled).toBe(true);
  });

  test('履歴があるセル（直近判定）の undo は有効でハンドラを呼ぶ', () => {
    const cell = makeCell({
      state: {
        status: 'accept',
        value: '120',
        stack: [
          {
            decidedAt: 't1',
            decidedBy: 'me',
            documentId: 'doc-1',
            fieldId: 'f-1',
            entityKey: '-',
            annotator: 'me',
            annotatorType: 'human_with_ai',
            schemaVersion: 1,
            action: 'accept',
            value: '120',
            note: null,
          },
        ],
      },
    });
    const { root, handlers } = render(makeModel([cell], { recentDecidedKey: cell.cellKey }));
    const undo = root.querySelector<HTMLButtonElement>('.verify__action--undo');
    expect(undo?.disabled).toBe(false);
    undo?.click();
    expect(handlers.onUndo).toHaveBeenCalledWith(cell.cellKey);
  });

  test('編集中セルはエディタを出す: edit は現在値（無ければ AI 値）を初期値にする', () => {
    const cell = makeCell();
    const { root, handlers } = render(
      makeModel([cell], { editing: { cellKey: cell.cellKey, action: 'edit' } }),
    );
    const input = root.querySelector<HTMLInputElement>('.verify__edit-input');
    expect(input?.value).toBe('120'); // state.value が null → AI 値
    expect(root.querySelector('.verify__actions')).toBeNull();
    input!.value = '150';
    root.querySelector<HTMLButtonElement>('.verify__edit-confirm')?.click();
    expect(handlers.onConfirmEdit).toHaveBeenCalledWith(cell.cellKey, 'edit', '150');
  });

  test('edit の初期値は確定値を優先し、AI 値も無ければ空', () => {
    const withState = makeCell({
      state: { status: 'edit', value: '99', stack: [] },
    });
    const noValues = makeCell({
      field: makeField({ fieldId: 'f-2' }),
      evidence: makeEvidence({ fieldId: 'f-2', value: null }),
    });
    const first = render(
      makeModel([withState], { editing: { cellKey: withState.cellKey, action: 'edit' } }),
    );
    expect(first.root.querySelector<HTMLInputElement>('.verify__edit-input')?.value).toBe('99');
    const second = render(
      makeModel([noValues], { editing: { cellKey: noValues.cellKey, action: 'edit' } }),
    );
    expect(second.root.querySelector<HTMLInputElement>('.verify__edit-input')?.value).toBe('');
  });

  test('reject のエディタは白紙から手入力し、Enter で確定・Escape でキャンセルする', () => {
    const cell = makeCell();
    const { root, handlers } = render(
      makeModel([cell], { editing: { cellKey: cell.cellKey, action: 'reject' } }),
    );
    const input = root.querySelector<HTMLInputElement>('.verify__edit-input');
    expect(input?.value).toBe('');
    expect(root.querySelector('.verify__edit-confirm')?.textContent).toBe('棄却して確定');
    input!.value = '手入力値';
    input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(handlers.onConfirmEdit).toHaveBeenCalledWith(cell.cellKey, 'reject', '手入力値');
    input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(handlers.onCancelEdit).toHaveBeenCalledTimes(1);
    input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' })); // 他キーは無視
    expect(handlers.onCancelEdit).toHaveBeenCalledTimes(1);
    root.querySelector<HTMLButtonElement>('.verify__edit-cancel')?.click();
    expect(handlers.onCancelEdit).toHaveBeenCalledTimes(2);
  });

  test('別セル編集中でも他セルには判定ボタンを出す', () => {
    const editingCell = makeCell();
    const other = makeCell({ field: makeField({ fieldId: 'f-2' }) });
    const { root } = render(
      makeModel([editingCell, other], {
        editing: { cellKey: editingCell.cellKey, action: 'edit' },
      }),
    );
    expect(root.querySelectorAll('.verify__editor')).toHaveLength(1);
    expect(root.querySelectorAll('.verify__actions')).toHaveLength(1);
  });

  test('フォーカス中セルに --focused を付け、focusin で onFocusCell を呼ぶ（重複は呼ばない）', () => {
    const cell = makeCell();
    const other = makeCell({ field: makeField({ fieldId: 'f-2' }) });
    const { root, handlers } = render(
      makeModel([cell, other], { focusedCellKey: cell.cellKey }),
    );
    const cellEls = root.querySelectorAll<HTMLElement>('.verify__cell');
    expect(cellEls[0]?.classList.contains('verify__cell--focused')).toBe(true);
    expect(cellEls[1]?.classList.contains('verify__cell--focused')).toBe(false);
    cellEls[1]?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(handlers.onFocusCell).toHaveBeenCalledWith(other.cellKey);
    cellEls[0]?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(handlers.onFocusCell).toHaveBeenCalledTimes(1);
  });
});

describe('renderVerificationForm: 判定済みブロック（未判定を上・判定済みを下部へ）', () => {
  const accepted: CellState = { status: 'accept', value: '120', stack: [] };

  function makeDecidedModel(overrides: Partial<VerificationFormModel> = {}): {
    unverified: VerificationCell;
    decided: VerificationCell;
    model: VerificationFormModel;
  } {
    const decided = makeCell({ field: makeField({ fieldId: 'f-2' }), state: accepted });
    const unverified = makeCell();
    return { unverified, decided, model: makeModel([unverified, decided], overrides) };
  }

  test('判定済みセルはコンパクト行として下部ブロックへ移り、未判定が先頭に残る', () => {
    const { root, handlers } = render(makeDecidedModel().model);
    const decidedSection = root.querySelector('.verify__group--decided');
    expect(decidedSection?.querySelector('.verify__group-heading')?.textContent).toBe(
      '判定済み（1）',
    );
    const row = decidedSection?.querySelector<HTMLButtonElement>('.verify__cell--decided');
    expect(row?.textContent).toContain('総サンプルサイズ');
    expect(row?.textContent).toContain('methods'); // グループ見出しを文脈として併記
    expect(row?.querySelector('.verify__decided-value')?.textContent).toBe('確定値: 120');
    // コンパクト行には判定操作ボタンを出さない
    expect(row?.querySelector('.verify__actions')).toBeNull();
    // 先頭（上のグループ）は未判定セルだけ
    const firstGroup = root.querySelector('.verify__group:not(.verify__group--decided)');
    expect(firstGroup?.querySelectorAll('.verify__cell')).toHaveLength(1);
    // クリックで展開ハンドラを呼ぶ
    row?.click();
    const { decided } = makeDecidedModel();
    expect(handlers.onExpandDecided).toHaveBeenCalledWith(decided.cellKey);
  });

  test('確定値が null のコンパクト行は「（空）」、フォーカス中は --focused が付く', () => {
    const rejected = makeCell({
      field: makeField({ fieldId: 'f-2' }),
      state: { status: 'reject', value: null, stack: [] },
    });
    const { root } = render(
      makeModel([makeCell(), rejected], { focusedCellKey: rejected.cellKey }),
    );
    const row = root.querySelector<HTMLButtonElement>('.verify__cell--decided');
    expect(row?.querySelector('.verify__decided-value')?.textContent).toBe('確定値: （空）');
    expect(row?.classList.contains('verify__cell--focused')).toBe(true);
  });

  test('グループ見出しが空のコンパクト行は見出しを併記しない', () => {
    const decided = makeCell({ field: makeField({ fieldId: 'f-2', section: '' }), state: accepted });
    const unverified = makeCell();
    const model = makeModel([unverified], {});
    model.tabModel = {
      groups: [
        { heading: 'methods', cells: [unverified] },
        { heading: '', cells: [decided] },
      ],
      cells: [unverified, decided],
    };
    const { root } = render(model);
    expect(root.querySelector('.verify__cell--decided .verify__decided-heading')).toBeNull();
  });

  test('展開中の判定済みセルは通常カード + たたむボタンで描画される', () => {
    const { decided, model } = makeDecidedModel();
    model.expandedDecidedKey = decided.cellKey;
    const { root, handlers } = render(model);
    const section = root.querySelector('.verify__group--decided');
    expect(section?.querySelector('.verify__cell--decided')).toBeNull();
    expect(section?.querySelector('.verify__actions')).not.toBeNull();
    expect(section?.querySelector('.verify__current-value')?.textContent).toBe('確定値: 120');
    const collapse = section?.querySelector<HTMLButtonElement>('.verify__decided-collapse');
    expect(collapse?.textContent).toBe('たたむ');
    collapse?.click();
    expect(handlers.onCollapseDecided).toHaveBeenCalled();
  });

  test('値入力中の判定済みセルは展開されエディタを出す（キーボード e / x 経由）', () => {
    const { decided, model } = makeDecidedModel();
    model.editing = { cellKey: decided.cellKey, action: 'edit' };
    const { root } = render(model);
    expect(root.querySelector('.verify__group--decided .verify__edit-input')).not.toBeNull();
  });

  test('未判定セルしか無いグループが空になったら丸ごと消える（全件判定済み）', () => {
    const decided = makeCell({ state: accepted });
    const { root } = render(makeModel([decided]));
    expect(root.querySelector('.verify__group:not(.verify__group--decided)')).toBeNull();
    expect(root.querySelector('.verify__group--decided')).not.toBeNull();
  });
});

describe('renderVerificationForm: 群構成確定カード（ui-states.md §3 `#/verify`）', () => {
  const editingCard = {
    editing: true,
    rows: [
      { armKey: 'arm:1', armName: '介入群' },
      { armKey: 'arm:2', armName: '' },
    ],
    confirmedVersion: null,
    error: null,
  };

  test('arm 未確定: study 以外のタブをディムし、編集カード + 確定案内を出す', () => {
    const { root, handlers } = render(
      makeModel([makeCell()], { armCard: editingCard, armLocked: true }),
    );
    const tabs = root.querySelectorAll<HTMLButtonElement>('.verify__tab');
    expect(tabs[0]?.disabled).toBe(false);
    expect(tabs[1]?.disabled).toBe(true);
    expect(tabs[1]?.getAttribute('aria-disabled')).toBe('true');
    expect(tabs[1]?.classList.contains('verify__tab--locked')).toBe(true);
    tabs[1]?.click();
    expect(handlers.onSelectTab).not.toHaveBeenCalled();

    const card = root.querySelector('#verify-arm-card');
    expect(card).not.toBeNull();
    expect(card?.querySelector('.verify__arm-lead')?.textContent).toContain(
      'まず群構成を確定してください',
    );
    const inputs = card?.querySelectorAll<HTMLInputElement>('.verify__arm-name');
    expect(inputs).toHaveLength(2);
    expect(inputs?.[0]?.value).toBe('介入群');
    // 未確定のうちはキャンセルボタンなし
    expect(card?.querySelector('.verify__arm-cancel')).toBeNull();
  });

  test('編集カードの操作がハンドラを呼ぶ（名称変更・追加・削除・確定）', () => {
    const { root, handlers } = render(
      makeModel([makeCell()], { armCard: editingCard, armLocked: true }),
    );
    const input = root.querySelector<HTMLInputElement>('.verify__arm-name');
    input!.value = '対照群';
    input!.dispatchEvent(new Event('change'));
    expect(handlers.onArmNameChange).toHaveBeenCalledWith(0, '対照群');
    root.querySelector<HTMLButtonElement>('.verify__arm-add')?.click();
    expect(handlers.onArmAddRow).toHaveBeenCalled();
    root.querySelectorAll<HTMLButtonElement>('.verify__arm-remove')[1]?.click();
    expect(handlers.onArmRemoveRow).toHaveBeenCalledWith(1);
    root.querySelector<HTMLButtonElement>('#verify-arm-confirm')?.click();
    expect(handlers.onArmConfirm).toHaveBeenCalled();
  });

  test('エラーは #verify-arm-error（role=alert）に出す', () => {
    const { root } = render(
      makeModel([makeCell()], {
        armCard: { ...editingCard, error: '名称が空の群があります' },
        armLocked: true,
      }),
    );
    const error = root.querySelector('#verify-arm-error');
    expect(error?.getAttribute('role')).toBe('alert');
    expect(error?.textContent).toContain('名称が空の群があります');
  });

  test('確定済み: 要約 + 改訂ボタン。タブはディムされない', () => {
    const confirmedCard = {
      editing: false,
      rows: [
        { armKey: 'arm:1', armName: '介入群' },
        { armKey: 'arm:2', armName: '対照群' },
      ],
      confirmedVersion: 2,
      error: null,
    };
    const { root, handlers } = render(
      makeModel([makeCell()], { armCard: confirmedCard, armLocked: false }),
    );
    expect(root.querySelector('.verify__arm-summary')?.textContent).toBe(
      '群構成: 2 群（version 2）— 介入群 / 対照群',
    );
    const tabs = root.querySelectorAll<HTMLButtonElement>('.verify__tab');
    expect(tabs[1]?.disabled).toBe(false);
    root.querySelector<HTMLButtonElement>('#verify-arm-revise')?.click();
    expect(handlers.onArmRevise).toHaveBeenCalled();
  });

  test('改訂中（確定済みあり）はキャンセルボタンを出す', () => {
    const { root, handlers } = render(
      makeModel([makeCell()], {
        armCard: { ...editingCard, confirmedVersion: 1 },
        armLocked: false,
      }),
    );
    root.querySelector<HTMLButtonElement>('.verify__arm-cancel')?.click();
    expect(handlers.onArmCancelRevise).toHaveBeenCalled();
  });

  test('arm 未確定でも rob_domain タブはディムしない（群構成に依存しない）', () => {
    const { root, handlers } = render(
      makeModel([makeCell()], {
        tabs: ['study', 'arm', 'rob_domain'],
        armCard: editingCard,
        armLocked: true,
      }),
    );
    const tabs = root.querySelectorAll<HTMLButtonElement>('.verify__tab');
    expect(tabs[1]?.disabled).toBe(true); // arm はディム
    expect(tabs[2]?.disabled).toBe(false); // RoB は操作可
    expect(tabs[2]?.classList.contains('verify__tab--locked')).toBe(false);
    tabs[2]?.click();
    expect(handlers.onSelectTab).toHaveBeenCalledWith('rob_domain');
  });

  test('arm 未確定で rob_domain タブが表示中でも本文は確定案内に差し替えない', () => {
    const robCell = makeCell({
      field: makeField({ fieldId: 'f-rob', section: 'risk_of_bias', entityLevel: 'rob_domain' }),
      entityKey: 'rob:d1_randomization',
    });
    const { root } = render(
      makeModel([robCell], {
        tabs: ['arm', 'rob_domain'],
        activeTab: 'rob_domain',
        armCard: editingCard,
        armLocked: true,
      }),
    );
    expect(root.querySelector('.verify__locked-note')).toBeNull();
    expect(root.querySelector('.verify__cell')).not.toBeNull();
  });

  test('ロック中にロック対象タブが表示中なら本文を確定案内に差し替える（study 項目なしスキーマ）', () => {
    const armCell = makeCell({
      field: makeField({ fieldId: 'f-arm', entityLevel: 'arm' }),
      entityKey: 'arm:1',
    });
    const { root } = render(
      makeModel([armCell], {
        tabs: ['arm', 'outcome_result'],
        activeTab: 'arm',
        armCard: editingCard,
        armLocked: true,
      }),
    );
    expect(root.querySelector('.verify__locked-note')?.textContent).toBe(
      'まず群構成を確定してください',
    );
    expect(root.querySelector('.verify__cell')).toBeNull();
    expect(root.querySelector('.verify__shortcut-note')).toBeNull();
  });
});
