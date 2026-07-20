import {
  renderVerificationForm,
  type CellHighlightInfo,
  type VerificationFormHandlers,
  type VerificationFormModel,
} from '../../../../src/app/views/verificationForm';
import type { VerificationFocusCardModel } from '../../../../src/app/views/verificationFocusCard';
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
    studyId: 'study-1',
    documentId: 'doc-1',
    fieldId: 'f-1',
    entityKey: '-',
    value: '120',
    notReported: false,
    quote: 'a total of 120 patients',
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
    onRelocateQuote: jest.fn(),
    onExpandDecided: jest.fn(),
    onCollapseDecided: jest.fn(),
    onArmNameChange: jest.fn(),
    onArmAddRow: jest.fn(),
    onArmRemoveRow: jest.fn(),
    onArmConfirm: jest.fn(),
    onArmRevise: jest.fn(),
    onArmCancelRevise: jest.fn(),
    onOutcomeKeyChange: jest.fn(),
    onOutcomeTimeChange: jest.fn(),
    onOutcomeAdd: jest.fn(),
    onRobEstimateKeyChange: jest.fn(),
    onRobEstimateDomainChange: jest.fn(),
    onRobEstimateAdd: jest.fn(),
    onToggleLayoutMode: jest.fn(),
    onMoveUnit: jest.fn(),
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
    outcomeAdd: null,
    robEstimateAdd: null,
    armLocked: false,
    progress: {
      decided: 0,
      total: cells.length,
      byTab: [{ tab: 'study', decided: 0, total: cells.length }],
    },
    layoutMode: 'list',
    focusCard: null,
    consistencyWarnings: new Map<string, string[]>(),
    robAlgorithmInfo: new Map(),
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

  test('進捗バーは現在タブぶんを数え、全体合算を副表示に併記する', () => {
    const { root } = render(
      makeModel([makeCell()], {
        activeTab: 'study',
        // Study タブは 3 / 6、全体（Study + アウトカム）は 3 / 10
        progress: {
          decided: 3,
          total: 10,
          byTab: [
            { tab: 'study', decided: 3, total: 6 },
            { tab: 'outcome_result', decided: 0, total: 4 },
          ],
        },
      }),
    );
    const progress = root.querySelector('#verify-progress');
    expect(progress?.getAttribute('role')).toBe('status');
    expect(progress?.getAttribute('aria-live')).toBe('polite');
    // 主表示 = 現在タブ（Study）ぶん。「残り24が謎」の混乱を避ける
    expect(root.querySelector('.verify__progress-text')?.textContent).toBe(
      'Study: 判定済み 3 / 6（残り 3）',
    );
    // 副表示 = 全 entity タブ合算
    expect(root.querySelector('.verify__progress-overall')?.textContent).toBe(
      '全体: 判定済み 3 / 10（残り 7）',
    );
    // バーは現在タブぶん
    const bar = root.querySelector<HTMLProgressElement>('.verify__progress-bar');
    expect(bar?.getAttribute('value')).toBe('3');
    expect(bar?.getAttribute('max')).toBe('6');
  });

  test('タブが 1 枚だけなら全体合算の副表示は出さない', () => {
    const { root } = render(
      makeModel([makeCell()], {
        activeTab: 'study',
        progress: { decided: 5, total: 5, byTab: [{ tab: 'study', decided: 5, total: 5 }] },
      }),
    );
    // 全件判定済みは「すべて判定済み」
    expect(root.querySelector('.verify__progress-text')?.textContent).toBe(
      'Study: 判定済み 5 / 5（すべて判定済み）',
    );
    // タブが 1 枚なので副表示は冗長 → 出さない
    expect(root.querySelector('.verify__progress-overall')).toBeNull();
  });

  test('現在タブにセルが無いときは「このタブに判定対象の項目がありません」', () => {
    // 総数 0 でも progress の max は 1 に落として不定表示を避ける
    const none = render(makeModel([], { progress: { decided: 0, total: 0, byTab: [] } }));
    expect(none.root.querySelector('.verify__progress-text')?.textContent).toBe(
      'このタブに判定対象の項目がありません',
    );
    expect(none.root.querySelector<HTMLProgressElement>('.verify__progress-bar')?.getAttribute('max')).toBe('1');
  });

  test('AI 抽出なしセルは注記を出し、承認を無効化する', () => {
    const { root } = render(makeModel([makeCell({ evidence: null })]));
    expect(root.querySelector('.verify__ai--none')?.textContent).toContain('AI 抽出なし');
    expect(root.querySelector<HTMLButtonElement>('.verify__action--accept')?.disabled).toBe(true);
    expect(root.querySelector('.verify__quote')).toBeNull();
  });

  test('with_ai レビューのセルカードには抽出指示の折りたたみを追加し、既定は畳んだ状態（issue #81）', () => {
    const { root } = render(makeModel([makeCell()]));
    const details = root.querySelector<HTMLDetailsElement>('.verify__instruction-toggle');
    expect(details).not.toBeNull();
    expect(details?.tagName).toBe('DETAILS');
    expect(details?.open).toBe(false);
    expect(details?.querySelector('summary')?.textContent).toBe('指示を表示');
    expect(details?.querySelector('.verify__instruction')?.textContent).toBe('総 N を抽出');
  });

  test('独立入力モードは抽出指示を常時表示するため、折りたたみは出さない（issue #81。表示自体は不変更）', () => {
    const { root } = render(makeModel([makeCell()], { mode: 'independent' }));
    expect(root.querySelector('.verify__instruction-toggle')).toBeNull();
    expect(root.querySelector('.verify__instruction')?.textContent).toBe('総 N を抽出');
  });

  test('独立入力モード（mode: independent）は quote / AI 値 / 承認・棄却を出さず、抽出指示を代わりに出す（design §5.2）', () => {
    const cell = makeCell(); // evidence あり（quote / AI 値つき）でもモードゲートで隠れることを確認する
    const { root } = render(makeModel([cell], { mode: 'independent' }));
    expect(root.querySelector('.verify__quote')).toBeNull();
    expect(root.querySelector('.verify__ai')).toBeNull();
    expect(root.querySelector('.verify__ai--none')).toBeNull();
    expect(root.querySelector('.verify__instruction')?.textContent).toBe('総 N を抽出');
    expect(root.querySelector('.verify__action--accept')).toBeNull();
    expect(root.querySelector('.verify__action--reject')).toBeNull();
    const actions = [...root.querySelectorAll<HTMLButtonElement>('.verify__action')];
    expect(actions.map((button) => button.textContent)).toEqual(['入力 (e)', '未報告 (n)', '戻す (z)']);
  });

  test('独立入力モードの入力エディタは AI 値を初期値にせず空欄から始まり、確定ボタンは「入力して確定」', () => {
    const cell = makeCell();
    const { root, handlers } = render(
      makeModel([cell], { mode: 'independent', editing: { cellKey: cell.cellKey, action: 'edit' } }),
    );
    const input = root.querySelector<HTMLInputElement>('.verify__edit-input');
    expect(input?.value).toBe(''); // AI 値 '120' を流用しない
    expect(root.querySelector('.verify__edit-confirm')?.textContent).toBe('入力して確定');
    input!.value = '99';
    root.querySelector<HTMLButtonElement>('.verify__edit-confirm')?.click();
    expect(handlers.onConfirmEdit).toHaveBeenCalledWith(cell.cellKey, 'edit', '99');
  });

  test('独立入力モードの群構成カードは AI ドラフトではなく自分で確定する案内文言になる（design §5.3）', () => {
    const { root } = render(
      makeModel([makeCell()], {
        mode: 'independent',
        armCard: {
          editing: true,
          rows: [],
          confirmedVersion: null,
          error: null,
          mode: 'independent',
        },
        armLocked: true,
      }),
    );
    expect(root.querySelector('.verify__arm-lead')?.textContent).toBe(
      'まず群構成を確定してください（群を追加して名称・数を自分で確定します）',
    );
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

  test('整合性チェック警告（issue #65）: 該当セルに警告一覧を表示し、複数セルにまたがる場合は最初の 1 件だけに id を付ける', () => {
    const cellA = makeCell({ field: makeField({ fieldId: 'f-a', fieldName: 'outcome_events' }) });
    const cellB = makeCell({ field: makeField({ fieldId: 'f-b', fieldName: 'outcome_total' }) });
    const message = 'イベント数 (12) が解析対象数 (10) を超えています';
    const warnings = new Map<string, string[]>([
      [cellA.cellKey, [message]],
      [cellB.cellKey, [message]],
    ]);
    const { root } = render(makeModel([cellA, cellB], { consistencyWarnings: warnings }));
    const blocks = root.querySelectorAll('.verify__consistency-warnings');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.getAttribute('role')).toBe('note');
    expect(blocks[0]?.textContent).toContain(message);
    expect(blocks[0]?.id).toBe('verify-consistency-warning');
    expect(blocks[1]?.id).toBe('');
    expect(root.querySelectorAll('#verify-consistency-warning')).toHaveLength(1);
  });

  test('整合性チェック警告が無いセルには警告ブロックを描画しない', () => {
    const { root } = render(makeModel([makeCell()]));
    expect(root.querySelector('.verify__consistency-warnings')).toBeNull();
  });

  test('RoB 2 アルゴリズム提案（issue #61）: 提案チップを表示する', () => {
    const cell = makeCell({ field: makeField({ fieldId: 'f-judgement', fieldName: 'rob2_judgement' }) });
    const info = new Map([
      [cell.cellKey, { cellKey: cell.cellKey, suggestion: 'some_concerns' as const, currentValue: 'some_concerns' as const, mismatch: false, aiUnconfirmed: false }],
    ]);
    const { root } = render(makeModel([cell], { robAlgorithmInfo: info }));
    expect(root.querySelector('.verify__rob-suggestion')?.textContent).toBe('アルゴリズム提案: some_concerns');
    expect(root.querySelector('.verify__rob-mismatch-warnings')).toBeNull();
    expect(root.querySelector('.verify__rob-unconfirmed')).toBeNull();
  });

  test('RoB 2 アルゴリズム提案が現在値と食い違う場合は警告バッジを表示し、最初の 1 件だけに id を付ける（#65 と同じパターン）', () => {
    const cellA = makeCell({ field: makeField({ fieldId: 'f-a', fieldName: 'rob2_judgement' }) });
    const cellB = makeCell({
      field: makeField({ fieldId: 'f-b', fieldName: 'rob2_judgement' }),
      entityKey: 'rob:d2_deviations',
    });
    const info = new Map([
      [cellA.cellKey, { cellKey: cellA.cellKey, suggestion: 'high' as const, currentValue: 'low' as const, mismatch: true, aiUnconfirmed: false }],
      [cellB.cellKey, { cellKey: cellB.cellKey, suggestion: 'high' as const, currentValue: 'low' as const, mismatch: true, aiUnconfirmed: false }],
    ]);
    const { root } = render(makeModel([cellA, cellB], { robAlgorithmInfo: info }));
    const blocks = root.querySelectorAll('.verify__rob-mismatch-warnings');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.getAttribute('role')).toBe('note');
    expect(blocks[0]?.textContent).toContain('アルゴリズム提案 (high) と現在の判定 (low) が一致しません');
    expect(blocks[0]?.id).toBe('verify-rob-algorithm-warning');
    expect(blocks[1]?.id).toBe('');
    expect(root.querySelectorAll('#verify-rob-algorithm-warning')).toHaveLength(1);
  });

  test('RoB 2 判定・未確認バッジ（issue #61 オーナー追加要件）: AI 値があり判定 0 件のときだけ表示する', () => {
    const cell = makeCell({ field: makeField({ fieldId: 'f-judgement', fieldName: 'rob2_judgement' }) });
    const info = new Map([
      [cell.cellKey, { cellKey: cell.cellKey, suggestion: null, currentValue: 'low' as const, mismatch: false, aiUnconfirmed: true }],
    ]);
    const { root } = render(makeModel([cell], { robAlgorithmInfo: info }));
    expect(root.querySelector('.verify__rob-unconfirmed')?.textContent).toBe(
      'AI 判定・未確認（まだ人が確認していません）',
    );
  });

  test('RoB 2 アルゴリズム情報が無いセル（rob_domain 以外・情報未計算）には何も描画しない', () => {
    const { root } = render(makeModel([makeCell()]));
    expect(root.querySelector('.verify__rob-algorithm')).toBeNull();
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

  test('「AI で再特定」（issue #94）: canRelocateQuote = true かつ anchor_status = failed のときだけ出す', () => {
    const cell = makeCell({ evidence: makeEvidence({ anchorStatus: 'failed' }) });
    const { root, handlers } = render(makeModel([cell], { canRelocateQuote: true }));
    const button = root.querySelector<HTMLButtonElement>('.verify__quote-relocate');
    expect(button).not.toBeNull();
    expect(button?.textContent).toBe('AI で再特定');
    expect(button?.disabled).toBe(false);
    button?.click();
    expect(handlers.onRelocateQuote).toHaveBeenCalledWith(cell.cellKey);
  });

  test('canRelocateQuote = false（options.onRelocateQuote 未注入）では出さない', () => {
    const cell = makeCell({ evidence: makeEvidence({ anchorStatus: 'failed' }) });
    const { root } = render(makeModel([cell], { canRelocateQuote: false }));
    expect(root.querySelector('.verify__quote-relocate')).toBeNull();
  });

  test('anchor_status が failed 以外（normalized 等）では canRelocateQuote = true でも出さない', () => {
    // unanchored 分岐（highlightInfo 0 件）自体はテスト対象外のケースだが、
    // 万一 failed 以外で unanchored 表示になっても「AI で再特定」は failed 限定にする
    const cell = makeCell({ evidence: makeEvidence({ anchorStatus: 'normalized' }) });
    const info = new Map([[cell.cellKey, { matchCount: 0, matchIndex: 0 }]]);
    const { root } = render(makeModel([cell], { canRelocateQuote: true, highlightInfo: info }));
    expect(root.querySelector('.verify__quote-relocate')).toBeNull();
  });

  test('relocateStatus = running では「AI で再特定中…」を disabled で出す', () => {
    const cell = makeCell({ evidence: makeEvidence({ anchorStatus: 'failed' }) });
    const status = new Map<string, 'running' | 'not_found'>([[cell.cellKey, 'running']]);
    const { root } = render(makeModel([cell], { canRelocateQuote: true, relocateStatus: status }));
    const button = root.querySelector<HTMLButtonElement>('.verify__quote-relocate');
    expect(button?.textContent).toBe('AI で再特定中…');
    expect(button?.disabled).toBe(true);
  });

  test('relocateStatus = not_found では案内メッセージを出し、ボタンは再度有効', () => {
    const cell = makeCell({ evidence: makeEvidence({ anchorStatus: 'failed' }) });
    const status = new Map<string, 'running' | 'not_found'>([[cell.cellKey, 'not_found']]);
    const { root } = render(makeModel([cell], { canRelocateQuote: true, relocateStatus: status }));
    const button = root.querySelector<HTMLButtonElement>('.verify__quote-relocate');
    expect(button?.textContent).toBe('AI で再特定');
    expect(button?.disabled).toBe(false);
    expect(root.querySelector('.verify__quote-relocate-not-found')?.textContent).toBe(
      'AI でも見つかりませんでした。本文内検索をお試しください',
    );
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
            studyId: 'study-1',
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

describe('renderVerificationForm: アウトカム追加フォーム', () => {
  test('outcome_result タブで入力欄・追加ボタンを描画し、変更と追加をハンドラへ渡す', () => {
    const { root, handlers } = render(
      makeModel([], {
        tabs: ['outcome_result'],
        activeTab: 'outcome_result',
        outcomeAdd: { outcomeKey: 'outcome_3', time: '30d', error: null },
        progress: {
          decided: 0,
          total: 0,
          byTab: [{ tab: 'outcome_result', decided: 0, total: 0 }],
        },
      }),
    );
    const card = root.querySelector('#verify-outcome-add');
    expect(card).not.toBeNull();
    const key = root.querySelector<HTMLInputElement>('#verify-outcome-key');
    const time = root.querySelector<HTMLInputElement>('#verify-outcome-time');
    expect(key?.value).toBe('outcome_3');
    expect(time?.value).toBe('30d');
    key!.value = 'mortality';
    key!.dispatchEvent(new Event('change'));
    expect(handlers.onOutcomeKeyChange).toHaveBeenCalledWith('mortality');
    time!.value = '12w';
    time!.dispatchEvent(new Event('change'));
    expect(handlers.onOutcomeTimeChange).toHaveBeenCalledWith('12w');
    root.querySelector<HTMLButtonElement>('#verify-outcome-add-button')?.click();
    expect(handlers.onOutcomeAdd).toHaveBeenCalled();
  });

  test('アウトカム追加エラーは role=alert で出す', () => {
    const { root } = render(
      makeModel([], {
        tabs: ['outcome_result'],
        activeTab: 'outcome_result',
        outcomeAdd: {
          outcomeKey: 'outcome_1',
          time: '',
          error: 'entity_key outcome:outcome_1|arm:1 は既に存在します',
        },
      }),
    );
    const error = root.querySelector('#verify-outcome-error');
    expect(error?.getAttribute('role')).toBe('alert');
    expect(error?.textContent).toContain('既に存在します');
  });
});

describe('renderVerificationForm: estimate 別 RoB 評価の宣言フォーム（issue #109）', () => {
  const robEstimateAdd = {
    estimateOptions: [
      { key: 'outcome:mortality|arm:1', label: 'mortality / 群 1' },
      { key: 'outcome:pain|arm:1|time:8w', label: 'pain / 群 1 / 8w' },
    ],
    domainOptions: [
      { id: 'd1_randomization', label: 'randomization process' },
      { id: 'overall', label: 'overall risk of bias' },
    ],
    selectedEstimate: 'outcome:pain|arm:1|time:8w',
    selectedDomain: 'd1_randomization',
    error: null,
  };

  test('rob_domain タブでセレクタ・追加ボタンを描画し、変更と追加をハンドラへ渡す', () => {
    const { root, handlers } = render(
      makeModel([], {
        tabs: ['rob_domain'],
        activeTab: 'rob_domain',
        robEstimateAdd,
        progress: { decided: 0, total: 0, byTab: [{ tab: 'rob_domain', decided: 0, total: 0 }] },
      }),
    );
    const card = root.querySelector('#verify-rob-est-add');
    expect(card).not.toBeNull();
    const key = root.querySelector<HTMLSelectElement>('#verify-rob-est-key');
    const domain = root.querySelector<HTMLSelectElement>('#verify-rob-est-domain');
    expect([...(key?.options ?? [])].map((option) => option.textContent)).toEqual([
      'mortality / 群 1',
      'pain / 群 1 / 8w',
    ]);
    expect(key?.value).toBe('outcome:pain|arm:1|time:8w');
    expect([...(domain?.options ?? [])].map((option) => option.textContent)).toEqual([
      'd1_randomization (randomization process)',
      'overall (overall risk of bias)',
    ]);
    expect(domain?.value).toBe('d1_randomization');
    key!.value = 'outcome:mortality|arm:1';
    key!.dispatchEvent(new Event('change'));
    expect(handlers.onRobEstimateKeyChange).toHaveBeenCalledWith('outcome:mortality|arm:1');
    domain!.value = 'overall';
    domain!.dispatchEvent(new Event('change'));
    expect(handlers.onRobEstimateDomainChange).toHaveBeenCalledWith('overall');
    root.querySelector<HTMLButtonElement>('#verify-rob-est-add-button')?.click();
    expect(handlers.onRobEstimateAdd).toHaveBeenCalled();
  });

  test('宣言エラーは role=alert で出す', () => {
    const { root } = render(
      makeModel([], {
        tabs: ['rob_domain'],
        activeTab: 'rob_domain',
        robEstimateAdd: {
          ...robEstimateAdd,
          error: 'entity_key rob:d1_randomization|outcome:mortality|arm:1 は既に宣言されています',
        },
      }),
    );
    const error = root.querySelector('#verify-rob-est-error');
    expect(error?.getAttribute('role')).toBe('alert');
    expect(error?.textContent).toContain('既に宣言されています');
  });
});

describe('renderVerificationForm: レイアウトモード（issue #38）', () => {
  function makeFocusCard(): VerificationFocusCardModel {
    const cell = makeCell();
    return {
      unit: {
        unitKey: 'study|methods',
        heading: 'methods',
        columns: [{ entityKey: '-', label: 'Study' }],
        rows: [{ field: cell.field, cells: [cell] }],
        summary: null,
      },
      unitIndex: 1,
      totalUnits: 1,
      remainingUnits: 1,
      focusedCellKey: cell.cellKey,
      editing: null,
      highlightInfo: new Map(),
      canSearchText: true,
      recentCell: null,
      consistencyWarnings: new Map<string, string[]>(),
      robAlgorithmInfo: new Map(),
    };
  }

  test('トグルボタンは現在のモードに応じて切替先ラベル・aria-pressed を出し、ハンドラを呼ぶ', () => {
    const { root, handlers } = render(makeModel([makeCell()], { layoutMode: 'focus', focusCard: makeFocusCard() }));
    const toggle = root.querySelector<HTMLButtonElement>('#verify-layout-toggle');
    expect(toggle?.textContent).toBe('リスト表示に切替');
    expect(toggle?.getAttribute('aria-pressed')).toBe('true');
    toggle?.click();
    expect(handlers.onToggleLayoutMode).toHaveBeenCalledWith('list');
  });

  test('リストモードのトグルは「フォーカス表示に切替」を出す', () => {
    const { root, handlers } = render(makeModel([makeCell()], { layoutMode: 'list' }));
    const toggle = root.querySelector<HTMLButtonElement>('#verify-layout-toggle');
    expect(toggle?.textContent).toBe('フォーカス表示に切替');
    expect(toggle?.getAttribute('aria-pressed')).toBe('false');
    toggle?.click();
    expect(handlers.onToggleLayoutMode).toHaveBeenCalledWith('focus');
  });

  test('focus モードは focusCard をフォーカスカードへ委譲し、リストモードの群・判定済みブロックは出さない', () => {
    const { root } = render(makeModel([makeCell()], { layoutMode: 'focus', focusCard: makeFocusCard() }));
    expect(root.querySelector('#verify-focus-card')).not.toBeNull();
    expect(root.querySelector('.verify__group')).toBeNull();
    expect(root.querySelector('.verify__group--decided')).toBeNull();
  });

  test('focusCard が null（防御）のときはフォーカスカードを描画せずショートカット注記のみ出す', () => {
    const { root } = render(makeModel([makeCell()], { layoutMode: 'focus', focusCard: null }));
    expect(root.querySelector('#verify-focus-card')).toBeNull();
    expect(root.querySelector('.verify__shortcut-note')).not.toBeNull();
  });

  test('focus モードでセルが 0 件のタブは空メッセージのみ（フォーカスカードを組まない）', () => {
    const { root } = render(makeModel([], { layoutMode: 'focus', focusCard: null }));
    expect(root.querySelector('.verify__empty')).not.toBeNull();
    expect(root.querySelector('#verify-focus-card')).toBeNull();
  });
});
