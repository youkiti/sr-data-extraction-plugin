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
    highlightInfo: new Map<string, CellHighlightInfo>(),
    canSearchText: true,
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

  test('判定チップと確定値: 未検証はチップのみ、判定済みは確定値も出す', () => {
    const accepted: CellState = {
      status: 'accept',
      value: '120',
      stack: [],
    };
    const rejected: CellState = { status: 'reject', value: null, stack: [] };
    const { root } = render(
      makeModel([
        makeCell(),
        makeCell({ field: makeField({ fieldId: 'f-2' }), state: accepted }),
        makeCell({ field: makeField({ fieldId: 'f-3' }), state: rejected }),
      ]),
    );
    const chips = root.querySelectorAll('.verify__chip');
    expect(chips[0]?.textContent).toBe('未検証');
    expect(chips[1]?.textContent).toBe('承認');
    expect(chips[2]?.textContent).toBe('棄却');
    const values = root.querySelectorAll('.verify__current-value');
    expect(values).toHaveLength(2);
    expect(values[0]?.textContent).toBe('確定値: 120');
    expect(values[1]?.textContent).toBe('確定値: （空）');
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

  test('履歴があるセルの undo は有効でハンドラを呼ぶ', () => {
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
    const { root, handlers } = render(makeModel([cell]));
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
