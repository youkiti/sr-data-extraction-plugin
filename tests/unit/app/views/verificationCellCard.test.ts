// flow 図（mermaid）の描画プレビュー（issue #109 PR5）のセルカード統合テスト。
// renderCell の従来挙動は verificationForm.test.ts / verificationFocusCard.test.ts /
// verificationPanel.test.ts が担うため、ここではプレビュートグルと保存時警告の分岐だけを
// 検証する。mermaid パッケージは jest では実体をロードできないため jest.mock で差し替え、
// ラッパー（mermaidPreview.ts）経由の実コードパスを通す
import {
  renderCell,
  type CellCardHandlers,
  type CellCardModel,
} from '../../../../src/app/views/verificationCellCard';
import { NOT_REPORTED_TOKEN } from '../../../../src/domain/annotation';
import type { Evidence } from '../../../../src/domain/evidence';
import type { SchemaField } from '../../../../src/domain/schemaField';
import type { VerificationCell } from '../../../../src/features/verification/cells';
import { cellKeyOf, emptyCellState } from '../../../../src/features/verification/cellState';

const mockInitialize = jest.fn();
const mockParse = jest.fn();
const mockRender = jest.fn();

jest.mock('mermaid', () => ({
  __esModule: true,
  default: { initialize: mockInitialize, parse: mockParse, render: mockRender },
}));

const FLOW_SOURCE = 'flowchart TD\n  A[Enrolled 100] --> B[Analyzed 90]';

function makeField(overrides: Partial<SchemaField> = {}): SchemaField {
  return {
    schemaVersion: 1,
    fieldId: 'f-flow',
    fieldIndex: 1,
    section: 'risk_of_bias_quadas3',
    fieldName: 'quadas3_flow_diagram',
    fieldLabel: 'QUADAS-3 フロー図（mermaid）',
    entityLevel: 'study',
    dataType: 'text',
    unit: null,
    allowedValues: null,
    required: false,
    extractionInstruction: 'mermaid flowchart TD ソースを構成する',
    example: null,
    aiGenerated: false,
    note: null,
    ...overrides,
  };
}

function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    evidenceId: 'ev-flow',
    runId: 'run-1',
    studyId: 'study-1',
    documentId: 'doc-1',
    fieldId: 'f-flow',
    entityKey: '-',
    value: FLOW_SOURCE,
    notReported: false,
    quote: 'Figure 1. Participant flow',
    page: 1,
    confidence: 'high',
    anchorStatus: 'exact',
    bboxPage: null,
    bbox: null,
    relocatedFrom: null,
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
    evidence: makeEvidence({ fieldId: field.fieldId }),
    state: emptyCellState(),
    ...overrides,
  };
}

function makeModel(overrides: Partial<CellCardModel> = {}): CellCardModel {
  return {
    focusedCellKey: null,
    editing: null,
    expandedDecidedKey: null,
    highlightInfo: new Map(),
    canSearchText: true,
    consistencyWarnings: new Map(),
    robAlgorithmInfo: new Map(),
    ...overrides,
  };
}

function makeHandlers(): jest.Mocked<CellCardHandlers> {
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
    onRelocateQuote: jest.fn(),
    onCollapseDecided: jest.fn(),
  };
}

function render(cell: VerificationCell, model: CellCardModel = makeModel()): HTMLElement {
  const node = renderCell(cell, model, makeHandlers());
  document.body.replaceChildren(node);
  return node;
}

/** details のプレビュートグルを開いて toggle イベントを発火する（jsdom はクリック開閉を模さない） */
function openToggle(root: HTMLElement): HTMLDetailsElement {
  const details = root.querySelector<HTMLDetailsElement>('.verify__mermaid-toggle') as HTMLDetailsElement;
  details.open = true;
  details.dispatchEvent(new Event('toggle'));
  return details;
}

/** 遅延ロード（dynamic import 相当）→ 描画 → then の非同期チェーンを全部流す */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('flow 図（mermaid）プレビュートグルの表示条件', () => {
  test('対象フィールド + AI 値あり: 既定で畳んだトグルと描画中プレースホルダを出す', () => {
    const root = render(makeCell());
    const details = root.querySelector<HTMLDetailsElement>('.verify__mermaid-toggle');
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
    expect(details?.querySelector('summary')?.textContent).toBe('図をプレビュー');
    expect(details?.querySelector('.verify__mermaid-preview')?.textContent).toBe(
      '図を描画しています…',
    );
  });

  test('非対象フィールドには出ない', () => {
    const root = render(
      makeCell({ field: makeField({ fieldId: 'f-total', fieldName: 'mortality_pct' }) }),
    );
    expect(root.querySelector('.verify__mermaid-toggle')).toBeNull();
  });

  test('表示値なし（AI 抽出なし + 未判定）には出ない', () => {
    const root = render(makeCell({ evidence: null }));
    expect(root.querySelector('.verify__mermaid-toggle')).toBeNull();
  });

  test('AI 値が未報告のときは出ない', () => {
    const root = render(makeCell({ evidence: makeEvidence({ notReported: true, value: null }) }));
    expect(root.querySelector('.verify__mermaid-toggle')).toBeNull();
  });

  test('判定確定値が未報告トークンのときは出ない', () => {
    const root = render(
      makeCell({
        evidence: null,
        state: { status: 'not_reported', value: NOT_REPORTED_TOKEN, stack: [] },
      }),
    );
    expect(root.querySelector('.verify__mermaid-toggle')).toBeNull();
  });

  test('独立入力モード: AI 値しか無いセルには出ず、人間の入力値には出る（AI 値非表示の原則）', () => {
    const withAiOnly = render(makeCell(), makeModel({ mode: 'independent' }));
    expect(withAiOnly.querySelector('.verify__mermaid-toggle')).toBeNull();

    const withHumanValue = render(
      makeCell({ state: { status: 'edit', value: FLOW_SOURCE, stack: [] } }),
      makeModel({ mode: 'independent' }),
    );
    expect(withHumanValue.querySelector('.verify__mermaid-toggle')).not.toBeNull();
  });
});

describe('flow 図（mermaid）プレビューの描画', () => {
  test('開くと表示値（判定確定値 > AI 値）で描画し、SVG に項目ラベルの aria-label を与える', async () => {
    mockRender.mockResolvedValue({ svg: '<svg><g>flow</g></svg>' });
    const decided = 'flowchart TD\n  X --> Y';
    const root = render(makeCell({ state: { status: 'edit', value: decided, stack: [] } }));
    openToggle(root);
    await flush();
    // 判定確定値が AI 値より優先される
    expect(mockRender).toHaveBeenCalledTimes(1);
    expect(mockRender.mock.calls[0]?.[1]).toBe(decided);
    const svg = root.querySelector('.verify__mermaid-preview svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('aria-label')).toBe('QUADAS-3 フロー図（mermaid）');
  });

  test('SVG 要素を含まない描画結果でも落ちない（防御）', async () => {
    mockRender.mockResolvedValue({ svg: '<div>svg なし</div>' });
    const root = render(makeCell());
    openToggle(root);
    await flush();
    expect(root.querySelector('.verify__mermaid-preview')?.textContent).toBe('svg なし');
  });

  test('描画は開いた 1 回だけ走る（再度の toggle・閉じた状態の toggle では走らない）', async () => {
    mockRender.mockResolvedValue({ svg: '<svg></svg>' });
    const root = render(makeCell());
    const details = root.querySelector<HTMLDetailsElement>('.verify__mermaid-toggle') as HTMLDetailsElement;
    // 閉じたままの toggle（open=false）は何もしない
    details.dispatchEvent(new Event('toggle'));
    expect(mockRender).not.toHaveBeenCalled();
    openToggle(root);
    details.dispatchEvent(new Event('toggle'));
    await flush();
    expect(mockRender).toHaveBeenCalledTimes(1);
  });

  test('構文エラー: エラーメッセージ表示へフォールバックする', async () => {
    mockRender.mockRejectedValue(new Error('No diagram type detected'));
    const root = render(makeCell({ evidence: makeEvidence({ value: 'not mermaid' }) }));
    openToggle(root);
    await flush();
    const error = root.querySelector('.verify__mermaid-error');
    expect(error?.textContent).toBe(
      'mermaid の構文エラーのため描画できません: No diagram type detected',
    );
  });
});

describe('flow 図（mermaid）の保存時構文チェック警告', () => {
  test('警告マップに載ったセルへ role=note の警告を出す', () => {
    const cell = makeCell();
    const root = render(
      cell,
      makeModel({ mermaidWarnings: new Map([[cell.cellKey, 'Parse error on line 2']]) }),
    );
    const warning = root.querySelector('.verify__mermaid-warning');
    expect(warning?.getAttribute('role')).toBe('note');
    expect(warning?.textContent).toBe(
      '⚠ 保存した値に mermaid の構文エラーがあります: Parse error on line 2',
    );
  });

  test('警告が無ければ出さない（警告マップ省略時も含む）', () => {
    expect(render(makeCell()).querySelector('.verify__mermaid-warning')).toBeNull();
    expect(
      render(makeCell(), makeModel({ mermaidWarnings: new Map() })).querySelector(
        '.verify__mermaid-warning',
      ),
    ).toBeNull();
  });
});
