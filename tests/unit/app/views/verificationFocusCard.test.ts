import type { Evidence } from '../../../../src/domain/evidence';
import type { SchemaField } from '../../../../src/domain/schemaField';
import { cellKeyOf, emptyCellState, type CellState } from '../../../../src/features/verification/cellState';
import type { VerificationCell } from '../../../../src/features/verification/cells';
import type { FocusUnit } from '../../../../src/features/verification/focusUnits';
import {
  renderVerificationFocusCard,
  type VerificationFocusCardHandlers,
  type VerificationFocusCardModel,
} from '../../../../src/app/views/verificationFocusCard';

function makeField(overrides: Partial<SchemaField> = {}): SchemaField {
  return {
    schemaVersion: 1,
    fieldId: 'f-mean',
    fieldIndex: 1,
    section: 'outcomes',
    fieldName: 'outcome_mean',
    fieldLabel: '平均値',
    entityLevel: 'outcome_result',
    dataType: 'float',
    unit: null,
    allowedValues: null,
    required: true,
    extractionInstruction: '平均値を抽出',
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
    studyId: 'study-1',
    documentId: 'doc-1',
    fieldId: 'f-mean',
    entityKey: 'outcome:pain|arm:1',
    value: '5.2',
    notReported: false,
    quote: 'mean pain score of 5.2',
    page: 1,
    confidence: 'high',
    anchorStatus: 'exact',
    bboxPage: null,
    bbox: null,
    ...overrides,
  };
}

function makeCell(overrides: Partial<VerificationCell> = {}): VerificationCell {
  const field = overrides.field ?? makeField();
  const entityKey = overrides.entityKey ?? 'outcome:pain|arm:1';
  return {
    cellKey: cellKeyOf(field.fieldId, entityKey),
    field,
    entityKey,
    evidence: makeEvidence({ fieldId: field.fieldId, entityKey }),
    state: emptyCellState(),
    ...overrides,
  };
}

function makeUnit(overrides: Partial<FocusUnit> = {}): FocusUnit {
  const cell = makeCell();
  return {
    unitKey: 'outcome:pain',
    heading: 'pain',
    columns: [{ entityKey: 'outcome:pain|arm:1', label: '介入群' }],
    rows: [{ field: cell.field, cells: [cell] }],
    summary: null,
    ...overrides,
  };
}

function makeHandlers(): jest.Mocked<VerificationFocusCardHandlers> {
  return {
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
    onCollapseDecided: jest.fn(),
    onMoveUnit: jest.fn(),
  };
}

function makeModel(overrides: Partial<VerificationFocusCardModel> = {}): VerificationFocusCardModel {
  const unit = overrides.unit ?? makeUnit();
  return {
    unit,
    unitIndex: 1,
    totalUnits: 3,
    remainingUnits: 2,
    focusedCellKey: unit.rows[0]?.cells[0]?.cellKey ?? null,
    editing: null,
    highlightInfo: new Map(),
    canSearchText: true,
    recentCell: null,
    consistencyWarnings: new Map<string, string[]>(),
    robAlgorithmInfo: new Map(),
    ...overrides,
  };
}

function render(model: VerificationFocusCardModel, handlers = makeHandlers()) {
  const root = renderVerificationFocusCard(model, handlers);
  document.body.replaceChildren(root);
  return { root, handlers };
}

describe('renderVerificationFocusCard', () => {
  test('ユニットヘッダに位置（n / m・残り r）と見出しを表示する', () => {
    const { root } = render(makeModel({ unitIndex: 2, totalUnits: 5, remainingUnits: 3 }));
    expect(root.querySelector('#verify-focus-position')?.textContent).toBe('ユニット 2 / 5（残り 3）');
    expect(root.querySelector('.focus-card__heading')?.textContent).toBe('pain');
  });

  test('ユニットヘッダの前後移動ボタンは onMoveUnit(±1) を呼び、aria-label / title に Shift+J/K のヒントを持つ（issue #82）', () => {
    const { root, handlers } = render(makeModel({ unitIndex: 2, totalUnits: 3, remainingUnits: 1 }));
    const prev = root.querySelector<HTMLButtonElement>('.focus-card__nav--prev');
    const next = root.querySelector<HTMLButtonElement>('.focus-card__nav--next');
    expect(prev?.disabled).toBe(false);
    expect(next?.disabled).toBe(false);
    expect(prev?.getAttribute('aria-label')).toBe('前のユニットへ移動（Shift+K）');
    expect(prev?.getAttribute('title')).toBe('前のユニットへ移動（Shift+K）');
    expect(next?.getAttribute('aria-label')).toBe('次のユニットへ移動（Shift+J）');
    expect(next?.getAttribute('title')).toBe('次のユニットへ移動（Shift+J）');
    prev?.click();
    expect(handlers.onMoveUnit).toHaveBeenCalledWith(-1);
    next?.click();
    expect(handlers.onMoveUnit).toHaveBeenCalledWith(1);
  });

  test('先頭ユニットは前ボタンが disabled、末尾ユニットは次ボタンが disabled（折り返さないキーボード挙動と一致。issue #82）', () => {
    const first = render(makeModel({ unitIndex: 1, totalUnits: 3, remainingUnits: 2 }));
    expect(first.root.querySelector<HTMLButtonElement>('.focus-card__nav--prev')?.disabled).toBe(true);
    expect(first.root.querySelector<HTMLButtonElement>('.focus-card__nav--next')?.disabled).toBe(false);

    const last = render(makeModel({ unitIndex: 3, totalUnits: 3, remainingUnits: 0 }));
    expect(last.root.querySelector<HTMLButtonElement>('.focus-card__nav--prev')?.disabled).toBe(false);
    expect(last.root.querySelector<HTMLButtonElement>('.focus-card__nav--next')?.disabled).toBe(true);

    const only = render(makeModel({ unitIndex: 1, totalUnits: 1, remainingUnits: 0 }));
    expect(only.root.querySelector<HTMLButtonElement>('.focus-card__nav--prev')?.disabled).toBe(true);
    expect(only.root.querySelector<HTMLButtonElement>('.focus-card__nav--next')?.disabled).toBe(true);
  });

  test('詳細ストリップにも抽出指示の折りたたみが自動的に反映される（issue #81。verificationCellCard.renderCell を共有するため）', () => {
    const { root } = render(makeModel());
    const detail = root.querySelector('#verify-focus-detail');
    const details = detail?.querySelector<HTMLDetailsElement>('.verify__instruction-toggle');
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
    expect(details?.querySelector('summary')?.textContent).toBe('指示を表示');
    expect(details?.querySelector('.verify__instruction')?.textContent).toBe('平均値を抽出');
  });

  test('マトリクスは列ヘッダ・行ヘッダ・値 + 判定チップのボタンを描画する', () => {
    const { root, handlers } = render(makeModel());
    const table = root.querySelector('#verify-focus-matrix');
    expect(table).not.toBeNull();
    const colHeaders = [...table!.querySelectorAll('thead th')].map((node) => node.textContent);
    expect(colHeaders).toEqual(['項目', '介入群']);
    const rowHeader = table!.querySelector('tbody th');
    expect(rowHeader?.textContent).toBe('平均値');
    const button = table!.querySelector<HTMLButtonElement>('.focus-card__matrix-btn');
    expect(button?.querySelector('.focus-card__matrix-value')?.textContent).toBe('5.2');
    expect(button?.querySelector('.verify__chip')?.textContent).toBe('未検証');
    expect(button?.getAttribute('aria-label')).toBe('平均値 × 介入群: 5.2');
    button?.click();
    expect(handlers.onFocusCell).toHaveBeenCalledWith(cellKeyOf('f-mean', 'outcome:pain|arm:1'));
  });

  test('整合性チェック警告（issue #65）: マトリクスボタンに ⚠ バッジ + aria-label / title へ警告文を追加する', () => {
    const cell = makeCell();
    const unit = makeUnit();
    const message = 'イベント数 (12) が解析対象数 (10) を超えています';
    const warnings = new Map<string, string[]>([[cell.cellKey, [message]]]);
    const { root } = render(makeModel({ unit, consistencyWarnings: warnings }));
    const button = root.querySelector<HTMLButtonElement>('.focus-card__matrix-btn');
    expect(button?.querySelector('.verify__consistency-badge')).not.toBeNull();
    expect(button?.querySelector('.verify__consistency-badge')?.getAttribute('aria-hidden')).toBe('true');
    expect(button?.getAttribute('aria-label')).toBe(
      `平均値 × 介入群: 5.2（整合性チェック警告: ${message}）`,
    );
    expect(button?.getAttribute('title')).toBe(message);
  });

  test('整合性チェック警告が無いセルにはバッジを出さず、aria-label も従来どおり', () => {
    const { root } = render(makeModel());
    const button = root.querySelector<HTMLButtonElement>('.focus-card__matrix-btn');
    expect(button?.querySelector('.verify__consistency-badge')).toBeNull();
    expect(button?.getAttribute('aria-label')).toBe('平均値 × 介入群: 5.2');
    expect(button?.hasAttribute('title')).toBe(false);
  });

  test('詳細ストリップにも整合性チェック警告一覧を渡す（verificationCellCard.renderCell 経由）', () => {
    const cell = makeCell();
    const unit = makeUnit();
    const message = '標準誤差 (1.2) が標準偏差 (1.0) 以上です';
    const warnings = new Map<string, string[]>([[cell.cellKey, [message]]]);
    const { root } = render(makeModel({ unit, focusedCellKey: cell.cellKey, consistencyWarnings: warnings }));
    const detail = root.querySelector('#verify-focus-detail');
    expect(detail?.querySelector('.verify__consistency-warnings')?.textContent).toContain(message);
  });

  test('RoB 2 アルゴリズム提案との不一致（issue #61）: マトリクスボタンに専用バッジ + aria-label / title を追加する', () => {
    const cell = makeCell();
    const unit = makeUnit();
    const robInfo = new Map([
      [cell.cellKey, { cellKey: cell.cellKey, suggestion: 'high' as const, currentValue: 'low' as const, mismatch: true, aiUnconfirmed: false }],
    ]);
    const { root } = render(makeModel({ unit, robAlgorithmInfo: robInfo }));
    const button = root.querySelector<HTMLButtonElement>('.focus-card__matrix-btn');
    expect(button?.querySelector('.verify__rob-badge')).not.toBeNull();
    expect(button?.getAttribute('aria-label')).toBe(
      '平均値 × 介入群: 5.2（RoB アルゴリズム提案との不一致: アルゴリズム提案 (high) と現在の判定 (low) が一致しません）',
    );
    expect(button?.getAttribute('title')).toBe('アルゴリズム提案 (high) と現在の判定 (low) が一致しません');
  });

  test('RoB 2 アルゴリズム提案と現在値が一致する（mismatch=false）ときはバッジを出さない', () => {
    const cell = makeCell();
    const unit = makeUnit();
    const robInfo = new Map([
      [cell.cellKey, { cellKey: cell.cellKey, suggestion: 'low' as const, currentValue: 'low' as const, mismatch: false, aiUnconfirmed: false }],
    ]);
    const { root } = render(makeModel({ unit, robAlgorithmInfo: robInfo }));
    const button = root.querySelector<HTMLButtonElement>('.focus-card__matrix-btn');
    expect(button?.querySelector('.verify__rob-badge')).toBeNull();
    expect(button?.getAttribute('aria-label')).toBe('平均値 × 介入群: 5.2');
  });

  test('整合性チェック違反と RoB 不一致が同一セルで重なる場合は両方のバッジを併記し、title を連結する', () => {
    const cell = makeCell();
    const unit = makeUnit();
    const consistencyMessage = 'イベント数 (12) が解析対象数 (10) を超えています';
    const consistencyWarnings = new Map<string, string[]>([[cell.cellKey, [consistencyMessage]]]);
    const robInfo = new Map([
      [cell.cellKey, { cellKey: cell.cellKey, suggestion: 'high' as const, currentValue: 'low' as const, mismatch: true, aiUnconfirmed: false }],
    ]);
    const { root } = render(makeModel({ unit, consistencyWarnings, robAlgorithmInfo: robInfo }));
    const button = root.querySelector<HTMLButtonElement>('.focus-card__matrix-btn');
    expect(button?.querySelector('.verify__consistency-badge')).not.toBeNull();
    expect(button?.querySelector('.verify__rob-badge')).not.toBeNull();
    expect(button?.getAttribute('title')).toBe(
      `${consistencyMessage}\nアルゴリズム提案 (high) と現在の判定 (low) が一致しません`,
    );
  });

  test('フォーカス中セルのマトリクスボタンに強調クラスが付く', () => {
    const unit = makeUnit();
    const cellKey = unit.rows[0]!.cells[0]!.cellKey;
    const { root } = render(makeModel({ unit, focusedCellKey: cellKey }));
    const button = root.querySelector<HTMLButtonElement>('.focus-card__matrix-btn');
    expect(button?.classList.contains('focus-card__matrix-btn--focused')).toBe(true);
  });

  test('判定確定値があれば AI 値より優先して表示する', () => {
    const cell = makeCell({ state: { status: 'edit', value: '9.9', stack: [] } });
    const unit = makeUnit({ rows: [{ field: cell.field, cells: [cell] }] });
    const { root } = render(makeModel({ unit, focusedCellKey: cell.cellKey }));
    expect(root.querySelector('.focus-card__matrix-value')?.textContent).toBe('9.9');
  });

  test('未報告（NR）値は日本語ラベルで表示する', () => {
    const cell = makeCell({ evidence: makeEvidence({ notReported: true, value: null }) });
    const unit = makeUnit({ rows: [{ field: cell.field, cells: [cell] }] });
    const { root } = render(makeModel({ unit, focusedCellKey: cell.cellKey }));
    expect(root.querySelector('.focus-card__matrix-value')?.textContent).toBe('未報告（NR）');
  });

  test('AI 抽出も判定もない値は「—」', () => {
    const cell = makeCell({ evidence: null });
    const unit = makeUnit({ rows: [{ field: cell.field, cells: [cell] }] });
    const { root } = render(makeModel({ unit, focusedCellKey: cell.cellKey }));
    expect(root.querySelector('.focus-card__matrix-value')?.textContent).toBe('—');
  });

  test('null セル（不存在）は「—」のプレーン表示でボタンにしない', () => {
    const cell = makeCell();
    const unit = makeUnit({
      columns: [
        { entityKey: 'outcome:pain|arm:1', label: '介入群' },
        { entityKey: 'outcome:pain|arm:2', label: '対照群' },
      ],
      rows: [{ field: cell.field, cells: [cell, null] }],
    });
    const { root } = render(makeModel({ unit }));
    const emptyCell = root.querySelector('.focus-card__matrix-cell--empty');
    expect(emptyCell?.textContent).toBe('—');
    expect(emptyCell?.querySelector('button')).toBeNull();
  });

  test('unit.summary が非 null のときだけ要約行を表示する', () => {
    const withSummary = render(makeModel({ unit: makeUnit({ summary: '5.2 ± 1.1 (n=20) vs 4.0 ± 1.0 (n=20)' }) }));
    expect(withSummary.root.querySelector('.focus-card__summary')?.textContent).toBe(
      '要約: 5.2 ± 1.1 (n=20) vs 4.0 ± 1.0 (n=20)',
    );
    const withoutSummary = render(makeModel());
    expect(withoutSummary.root.querySelector('.focus-card__summary')).toBeNull();
  });

  test('詳細ストリップはフォーカス中セルを既存のセルカードで描画し、判定操作が動く', () => {
    const { root, handlers } = render(makeModel());
    const detail = root.querySelector('#verify-focus-detail');
    expect(detail?.querySelector('.verify__cell')).not.toBeNull();
    detail?.querySelector<HTMLButtonElement>('.verify__action--accept')?.click();
    expect(handlers.onAccept).toHaveBeenCalledWith(cellKeyOf('f-mean', 'outcome:pain|arm:1'));
  });

  test('詳細ストリップは判定済みブロックを持たないため「たたむ」ボタンを出さない（expandedDecidedKey は常に null）', () => {
    const { root } = render(makeModel());
    expect(root.querySelector('#verify-focus-detail .verify__decided-collapse')).toBeNull();
  });

  test('focusedCellKey が null のときは案内文を出す', () => {
    const { root } = render(makeModel({ focusedCellKey: null }));
    expect(root.querySelector('#verify-focus-detail')?.textContent).toBe('マトリクスからセルを選択してください');
  });

  test('focusedCellKey が unit 内のどのセルとも一致しないときも案内文を出す', () => {
    const { root } = render(makeModel({ focusedCellKey: 'nope' }));
    expect(root.querySelector('#verify-focus-detail')?.textContent).toBe('マトリクスからセルを選択してください');
  });

  test('直近判定が無ければバーを出さない', () => {
    const { root } = render(makeModel({ recentCell: null }));
    expect(root.querySelector('#verify-focus-recent')).toBeNull();
  });

  test('直近判定バーはチップ・ラベル・値・戻すボタンを表示し、onUndo は直近判定セルへ効く', () => {
    const accepted: CellState = {
      status: 'accept',
      value: '5.2',
      stack: [
        {
          decidedAt: 't1',
          decidedBy: 'me',
          studyId: 'study-1',
          fieldId: 'f-mean',
          entityKey: 'outcome:pain|arm:1',
          annotator: 'me',
          annotatorType: 'human_with_ai',
          schemaVersion: 1,
          action: 'accept',
          value: '5.2',
          note: null,
        },
      ],
    };
    const recentCell = makeCell({
      field: makeField({ fieldId: 'f-other' }),
      entityKey: 'outcome:pain|arm:2',
      state: accepted,
    });
    const { root, handlers } = render(makeModel({ recentCell }));
    const bar = root.querySelector('#verify-focus-recent');
    expect(bar?.getAttribute('role')).toBe('status');
    expect(bar?.querySelector('.verify__chip')?.textContent).toBe('承認');
    expect(bar?.querySelector('.focus-card__recent-label')?.textContent).toBe('平均値');
    expect(bar?.querySelector('.focus-card__recent-value')?.textContent).toBe('= 5.2');
    const undoButton = bar?.querySelector<HTMLButtonElement>('.focus-card__recent-undo');
    expect(undoButton?.disabled).toBe(false);
    undoButton?.click();
    // フォーカス中セル（f-mean）ではなく直近判定セル（f-other）へ undo が効く
    expect(handlers.onUndo).toHaveBeenCalledWith(recentCell.cellKey);
  });

  test('直近判定セルの履歴が空なら戻すボタンは無効', () => {
    const recentCell = makeCell({ state: { status: 'accept', value: '5.2', stack: [] } });
    const { root } = render(makeModel({ recentCell }));
    expect(
      root.querySelector<HTMLButtonElement>('.focus-card__recent-undo')?.disabled,
    ).toBe(true);
  });
});
