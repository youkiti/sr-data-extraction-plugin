import {
  createVerificationPanel,
  disposeVerificationPanelCache,
  renderCachedVerificationPanel,
  type VerificationPanelOptions,
} from '../../../../src/app/views/verificationPanel';
import type { Decision } from '../../../../src/domain/decision';
import type { DocumentRecord } from '../../../../src/domain/document';
import type { Evidence } from '../../../../src/domain/evidence';
import type { SchemaField } from '../../../../src/domain/schemaField';
import type { TextLayerPage } from '../../../../src/domain/textLayer';
import { cellKeyOf } from '../../../../src/features/verification/cellState';
import type { VerificationData } from '../../../../src/features/verification/types';
import type {
  PdfViewerDocument,
  RenderablePdfPage,
} from '../../../../src/lib/pdf/renderPage';

function buildPage(page: number, text: string): TextLayerPage {
  return {
    page,
    text,
    width: 612,
    height: 792,
    items: [
      {
        charStart: 0,
        str: text,
        transform: [1, 0, 0, 1, 0, 700],
        width: text.length * 10,
        height: 10,
        hasEOL: false,
      },
    ],
  };
}

function makeDocumentRecord(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    documentId: 'doc-1',
    studyLabel: 'Smith 2020',
    driveFileId: 'drive-1',
    sourceFileId: 'src-1',
    filename: 'smith2020.pdf',
    pmid: null,
    doi: null,
    textRef: 'https://drive.google.com/file/d/txt-1/view',
    textStatus: 'ok',
    pageCount: 2,
    charCount: 1000,
    importedAt: 't0',
    importedBy: 'me@example.com',
    note: null,
    ...overrides,
  };
}

function makeField(overrides: Partial<SchemaField> = {}): SchemaField {
  return {
    schemaVersion: 1,
    fieldId: 'f-total',
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
    fieldId: 'f-total',
    entityKey: '-',
    value: '12',
    notReported: false,
    quote: 'mortality was 12 percent',
    page: 1,
    confidence: 'high',
    anchorStatus: 'exact',
    ...overrides,
  };
}

function makePdf(): PdfViewerDocument {
  const page: RenderablePdfPage = {
    getViewport: ({ scale }) => ({ width: 612 * scale, height: 792 * scale }),
    render: () => ({ promise: Promise.resolve() }),
  };
  return { numPages: 2, getPage: jest.fn().mockResolvedValue(page) };
}

const PAGES = [
  buildPage(1, 'intro mortality was 12 percent in total'),
  buildPage(2, 'again mortality was 12 percent and n=50 here'),
];

const FIELDS = [
  makeField(),
  makeField({ fieldId: 'f-country', fieldIndex: 2, fieldName: 'country', fieldLabel: '国' }),
  makeField({ fieldId: 'f-blank', fieldIndex: 3, fieldName: 'design', fieldLabel: 'デザイン' }),
  makeField({
    fieldId: 'f-arm-n',
    fieldIndex: 4,
    fieldName: 'arm_n',
    fieldLabel: '群の N',
    entityLevel: 'arm',
  }),
];

const EVIDENCE = [
  // 2 ページに出現する quote（複数一致の切替対象）
  makeEvidence(),
  // アンカー失敗（フォールバック UI）+ low confidence
  makeEvidence({
    evidenceId: 'ev-2',
    fieldId: 'f-country',
    value: 'Japan',
    quote: 'nowhere to be found',
    anchorStatus: 'failed',
    confidence: 'low',
  }),
  // arm レベル・page 2・low confidence
  makeEvidence({
    evidenceId: 'ev-3',
    fieldId: 'f-arm-n',
    entityKey: 'arm:1',
    value: '50',
    quote: 'n=50 here',
    page: 2,
    confidence: 'low',
  }),
];

const ME = 'me@example.com';

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    decidedAt: 't0',
    decidedBy: ME,
    documentId: 'doc-1',
    fieldId: 'f-country',
    entityKey: '-',
    annotator: ME,
    annotatorType: 'human_with_ai',
    schemaVersion: 1,
    action: 'accept',
    value: 'Japan',
    note: null,
    ...overrides,
  };
}

function makeData(overrides: Partial<VerificationData> = {}): VerificationData {
  return {
    document: makeDocumentRecord(),
    fields: FIELDS,
    evidence: EVIDENCE,
    decisions: [],
    annotator: ME,
    schemaVersion: 1,
    // 既定は確定済み（群構成ゲートの挙動は専用 describe で null にして検証する）
    armStructure: { version: 1, arms: [{ armKey: 'arm:1', armName: '介入群' }] },
    pdf: makePdf(),
    pdfError: null,
    textPages: PAGES,
    ...overrides,
  };
}

const renderPage = () => Promise.resolve({ width: 612, height: 792 });

function createPanel(overrides: Partial<VerificationData> = {}, options: Partial<VerificationPanelOptions> = {}) {
  const onDecision = jest.fn();
  const panel = createVerificationPanel({
    data: makeData(overrides),
    onDecision,
    now: () => 't-now',
    renderPage,
    ...options,
  });
  document.body.replaceChildren(panel.root);
  return { panel, onDecision };
}

function cellEl(root: HTMLElement, cellKey: string): HTMLElement | null {
  for (const node of root.querySelectorAll<HTMLElement>('.verify__cell')) {
    if (node.dataset['cellKey'] === cellKey) {
      return node;
    }
  }
  return null;
}

function chipOf(root: HTMLElement, cellKey: string): string | undefined {
  return cellEl(root, cellKey)?.querySelector('.verify__chip')?.textContent ?? undefined;
}

function pressKey(key: string, init: KeyboardEventInit = {}): void {
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
}

const KEY_TOTAL = cellKeyOf('f-total', '-');
const KEY_COUNTRY = cellKeyOf('f-country', '-');
const KEY_BLANK = cellKeyOf('f-blank', '-');
const KEY_ARM = cellKeyOf('f-arm-n', 'arm:1');

afterEach(() => {
  document.body.replaceChildren();
});

describe('createVerificationPanel: 構造', () => {
  test('2 ペイン + タブ + 先頭セルへの初期フォーカス。自分の判定だけが状態に反映される', () => {
    const { panel } = createPanel({
      decisions: [
        makeDecision(), // 自分の accept（f-country）
        makeDecision({ fieldId: 'f-total', annotator: 'other@example.com' }), // 他人の判定は無視
      ],
    });
    expect(panel.root.querySelector('.verify__pane--pdf .pdf-viewer')).not.toBeNull();
    expect(panel.root.querySelectorAll('.verify__tab')).toHaveLength(2); // study / arm
    expect(
      cellEl(panel.root, KEY_TOTAL)?.classList.contains('verify__cell--focused'),
    ).toBe(true);
    expect(chipOf(panel.root, KEY_COUNTRY)).toBe('承認');
    expect(chipOf(panel.root, KEY_TOTAL)).toBe('未検証');
    panel.dispose();
  });

  test('テキスト層なし文献はバナーを出す', () => {
    const { panel } = createPanel({
      document: makeDocumentRecord({ textStatus: 'no_text_layer' }),
      textPages: [],
    });
    expect(panel.root.querySelector('.verify__banner')?.textContent).toContain(
      'テキスト層がないためハイライト検証は使えません',
    );
    panel.dispose();
  });

  test('PDF が開けないときはエラー + 再取り込み導線を出し、フォームは使える', () => {
    const { panel, onDecision } = createPanel({ pdf: null, pdfError: 'ダウンロード失敗' });
    expect(panel.root.querySelector('.verify__pdf-error')?.textContent).toContain(
      'PDF を開けません: ダウンロード失敗',
    );
    expect(panel.root.querySelector('.verify__pdf-error a')?.getAttribute('href')).toBe(
      '#/documents',
    );
    // viewer なしでも判定は通る（syncViewer / onJump の null 分岐）
    cellEl(panel.root, KEY_TOTAL)
      ?.querySelector<HTMLButtonElement>('.verify__action--accept')
      ?.click();
    expect(onDecision).toHaveBeenCalledTimes(1);
    pressKey('f'); // viewer 不在の onJump
    panel.dispose();
  });

  test('PDF エラー理由が無ければ「原因不明」', () => {
    const { panel } = createPanel({ pdf: null });
    expect(panel.root.querySelector('.verify__pdf-error')?.textContent).toContain('原因不明');
    panel.dispose();
  });

  test('項目が無いデータでは空タブ（フォーカスなし）でキー操作も無害', () => {
    const { panel, onDecision } = createPanel({ fields: [], evidence: [], textPages: PAGES });
    expect(panel.root.querySelectorAll('.verify__tab')).toHaveLength(0);
    pressKey('j');
    pressKey('a');
    expect(onDecision).not.toHaveBeenCalled();
    panel.dispose();
  });
});

describe('判定操作', () => {
  test('承認ボタン: AI 値で accept を確定し、チップとハイライト色が更新される', () => {
    const { panel, onDecision } = createPanel();
    cellEl(panel.root, KEY_TOTAL)
      ?.querySelector<HTMLButtonElement>('.verify__action--accept')
      ?.click();
    expect(onDecision).toHaveBeenCalledWith({
      decidedAt: 't-now',
      decidedBy: ME,
      documentId: 'doc-1',
      fieldId: 'f-total',
      entityKey: '-',
      annotator: ME,
      annotatorType: 'human_with_ai',
      schemaVersion: 1,
      action: 'accept',
      value: '12',
      note: null,
    });
    expect(chipOf(panel.root, KEY_TOTAL)).toBe('承認');
    // ハイライトが verified （緑）へ変わる
    expect(
      panel.root.querySelector('.pdf-viewer__hl--verified'),
    ).not.toBeNull();
    panel.dispose();
  });

  test('AI が未報告と主張する値の承認は NR で確定する', () => {
    const { panel, onDecision } = createPanel({
      evidence: [
        makeEvidence({ notReported: true, value: null, quote: null, anchorStatus: null }),
      ],
    });
    cellEl(panel.root, KEY_TOTAL)
      ?.querySelector<HTMLButtonElement>('.verify__action--accept')
      ?.click();
    expect(onDecision).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'accept', value: 'NR' }),
    );
    panel.dispose();
  });

  test('キーボード: a / n / z（undo は取り消し値を積む）', () => {
    const { panel, onDecision } = createPanel();
    pressKey('z'); // 履歴なし → 無害
    expect(onDecision).not.toHaveBeenCalled();
    pressKey('a');
    expect(onDecision).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'accept', value: '12' }),
    );
    pressKey('n');
    expect(onDecision).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'not_reported', value: 'NR' }),
    );
    pressKey('z'); // not_reported を取り消し → accept の値へ戻す
    expect(onDecision).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'undo', value: '12' }),
    );
    expect(chipOf(panel.root, KEY_TOTAL)).toBe('承認');
    panel.dispose();
  });

  test('AI 抽出なしセルでは a が無害（評拠なしの accept 不可）', () => {
    const { panel, onDecision } = createPanel();
    pressKey('j');
    pressKey('j'); // f-blank（Evidence なし）へ
    expect(
      cellEl(panel.root, KEY_BLANK)?.classList.contains('verify__cell--focused'),
    ).toBe(true);
    pressKey('a');
    expect(onDecision).not.toHaveBeenCalled();
    panel.dispose();
  });

  test('e で編集を開始し、入力へフォーカス・Enter で確定（空入力は null）', () => {
    const { panel, onDecision } = createPanel();
    pressKey('e');
    const input = panel.root.querySelector<HTMLInputElement>('.verify__edit-input');
    expect(document.activeElement).toBe(input);
    expect(input?.value).toBe('12');
    // 編集中は判定キーが発火しない（入力ガード + editing ガード）
    input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    pressKey('a');
    expect(onDecision).not.toHaveBeenCalled();
    input!.value = '  15  ';
    input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onDecision).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'edit', value: '15' }),
    );
    expect(chipOf(panel.root, KEY_TOTAL)).toBe('修正');
    panel.dispose();
  });

  test('x で棄却入力を開き、空のまま確定すると value は null', () => {
    const { panel, onDecision } = createPanel();
    pressKey('x');
    const input = panel.root.querySelector<HTMLInputElement>('.verify__edit-input');
    expect(input?.value).toBe('');
    panel.root.querySelector<HTMLButtonElement>('.verify__edit-confirm')?.click();
    expect(onDecision).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'reject', value: null }),
    );
    panel.dispose();
  });

  test('編集の Escape キャンセルで判定ボタンへ戻る', () => {
    const { panel, onDecision } = createPanel();
    pressKey('e');
    panel.root
      .querySelector<HTMLInputElement>('.verify__edit-input')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(panel.root.querySelector('.verify__edit-input')).toBeNull();
    expect(onDecision).not.toHaveBeenCalled();
    panel.dispose();
  });
});

describe('フォーカス移動と双方向ジャンプ', () => {
  test('j / k / 矢印キーで項目を移動し、端でクランプする', () => {
    const { panel } = createPanel();
    pressKey('k'); // 先頭でクランプ
    expect(cellEl(panel.root, KEY_TOTAL)?.classList.contains('verify__cell--focused')).toBe(true);
    pressKey('j');
    expect(cellEl(panel.root, KEY_COUNTRY)?.classList.contains('verify__cell--focused')).toBe(
      true,
    );
    pressKey('ArrowDown');
    pressKey('ArrowDown'); // 末尾でクランプ
    expect(cellEl(panel.root, KEY_BLANK)?.classList.contains('verify__cell--focused')).toBe(true);
    pressKey('ArrowUp');
    expect(cellEl(panel.root, KEY_COUNTRY)?.classList.contains('verify__cell--focused')).toBe(
      true,
    );
    panel.dispose();
  });

  test('f で現在項目のハイライトへ PDF がスクロールする', () => {
    const { panel } = createPanel();
    const indicator = panel.root.querySelector('.pdf-viewer__page-indicator');
    // 複数一致の切替: 2 箇所目（page 2）へ
    const cycle = cellEl(panel.root, KEY_TOTAL)?.querySelector<HTMLButtonElement>(
      '.verify__quote-cycle',
    );
    expect(cycle?.textContent).toBe('他 1 箇所に一致（1 / 2）');
    cycle?.click();
    expect(indicator?.textContent).toBe('2 / 2 ページ');
    expect(
      cellEl(panel.root, KEY_TOTAL)?.querySelector('.verify__quote-cycle')?.textContent,
    ).toBe('他 1 箇所に一致（2 / 2）');
    // f で選択中の出現（page 2）へ
    panel.root.querySelector<HTMLButtonElement>('.pdf-viewer__prev')?.click();
    expect(indicator?.textContent).toBe('1 / 2 ページ');
    pressKey('f');
    expect(indicator?.textContent).toBe('2 / 2 ページ');
    panel.dispose();
  });

  test('ハイライトクリックで対応セルへフォーカス（同一タブは再構築なし）', () => {
    const { panel } = createPanel();
    pressKey('j'); // f-country へ
    const rect = panel.root.querySelector<HTMLButtonElement>('.pdf-viewer__hl');
    rect?.click(); // f-total のハイライト
    expect(cellEl(panel.root, KEY_TOTAL)?.classList.contains('verify__cell--focused')).toBe(true);
    // 同じセルの再クリックは何もしない（早期 return）
    panel.root.querySelector<HTMLButtonElement>('.pdf-viewer__hl')?.click();
    expect(cellEl(panel.root, KEY_TOTAL)?.classList.contains('verify__cell--focused')).toBe(true);
    panel.dispose();
  });

  test('別タブのハイライトクリックでタブが切り替わる（scrollIntoView があれば呼ぶ）', () => {
    const scrollIntoView = jest.fn();
    (HTMLElement.prototype as unknown as { scrollIntoView: unknown }).scrollIntoView =
      scrollIntoView;
    try {
      const { panel } = createPanel();
      // page 2 の arm ハイライトを表示してクリック
      panel.root.querySelector<HTMLButtonElement>('.pdf-viewer__next')?.click();
      const rects = panel.root.querySelectorAll<HTMLButtonElement>('.pdf-viewer__hl');
      const armRect = [...rects].find(
        (node) => node.getAttribute('aria-label') === '根拠: 群の N',
      );
      armRect?.click();
      expect(
        panel.root.querySelector('.verify__tab--active')?.textContent,
      ).toBe('群（arm）');
      expect(cellEl(panel.root, KEY_ARM)?.classList.contains('verify__cell--focused')).toBe(true);
      expect(scrollIntoView).toHaveBeenCalled();
      panel.dispose();
    } finally {
      delete (HTMLElement.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  test('セル DOM への直接フォーカス（focusin）でパネルのフォーカスが移る', () => {
    const { panel } = createPanel();
    cellEl(panel.root, KEY_COUNTRY)?.focus();
    expect(cellEl(panel.root, KEY_COUNTRY)?.classList.contains('verify__cell--focused')).toBe(
      true,
    );
    expect(cellEl(panel.root, KEY_TOTAL)?.classList.contains('verify__cell--focused')).toBe(false);
    panel.dispose();
  });

  test('インスタンスが無いタブへ切り替えるとフォーカスは無しになる', () => {
    const { panel, onDecision } = createPanel({
      evidence: [makeEvidence()], // arm の Evidence なし → arm タブは空
    });
    panel.root.querySelectorAll<HTMLButtonElement>('.verify__tab')[1]?.click();
    expect(panel.root.querySelector('.verify__empty')).not.toBeNull();
    pressKey('a'); // フォーカスなし → 無害
    expect(onDecision).not.toHaveBeenCalled();
    panel.dispose();
  });

  test('タブの手動切替は先頭セルへフォーカスし直す', () => {
    const { panel } = createPanel();
    const tabs = panel.root.querySelectorAll<HTMLButtonElement>('.verify__tab');
    tabs[1]?.click();
    expect(panel.root.querySelector('.verify__tab--active')?.textContent).toBe('群（arm）');
    expect(cellEl(panel.root, KEY_ARM)?.classList.contains('verify__cell--focused')).toBe(true);
    panel.dispose();
  });

  test('セルに対応しないハイライト（entity_key 不正）は無視される', () => {
    const { panel } = createPanel({
      evidence: [
        ...EVIDENCE,
        makeEvidence({
          evidenceId: 'ev-ghost',
          fieldId: 'f-ghost',
          entityKey: 'broken key',
          quote: 'intro',
          page: 1,
        }),
      ],
    });
    const ghost = [...panel.root.querySelectorAll<HTMLButtonElement>('.pdf-viewer__hl')].find(
      (node) => node.getAttribute('aria-label') === '根拠: f-ghost',
    );
    expect(ghost).toBeDefined();
    ghost?.click(); // tabOfCell が null → フォーカスは動かない
    expect(cellEl(panel.root, KEY_TOTAL)?.classList.contains('verify__cell--focused')).toBe(true);
    panel.dispose();
  });

  test('anchor failed の「本文内を検索」は quote をビューア検索へ投入する', () => {
    const { panel } = createPanel();
    cellEl(panel.root, KEY_COUNTRY)
      ?.querySelector<HTMLButtonElement>('.verify__quote-search')
      ?.click();
    expect(
      panel.root.querySelector<HTMLInputElement>('.pdf-viewer__search-input')?.value,
    ).toBe('nowhere to be found');
    expect(panel.root.querySelector('.pdf-viewer__search-status')?.textContent).toBe(
      '一致する本文が見つかりません',
    );
    panel.dispose();
  });

  test('ハイライト色: low confidence は橙、判定済みは緑', () => {
    const { panel } = createPanel({ decisions: [makeDecision({ fieldId: 'f-arm-n', entityKey: 'arm:1', value: '50' })] });
    panel.root.querySelector<HTMLButtonElement>('.pdf-viewer__next')?.click();
    // arm セルは判定済み → verified が優先される
    expect(panel.root.querySelector('.pdf-viewer__hl--verified')).not.toBeNull();
    panel.dispose();
  });

  test('未判定 + low confidence のハイライトは橙になる', () => {
    const { panel } = createPanel();
    panel.root.querySelector<HTMLButtonElement>('.pdf-viewer__next')?.click();
    expect(panel.root.querySelector('.pdf-viewer__hl--low')).not.toBeNull();
    panel.dispose();
  });
});

describe('キーボードガード', () => {
  test('修飾キー付き・入力フィールド・未知キーは無視する', () => {
    const { panel, onDecision } = createPanel();
    pressKey('a', { ctrlKey: true });
    pressKey('a', { metaKey: true });
    pressKey('a', { altKey: true });
    pressKey('a', { shiftKey: true });
    pressKey('q');
    const search = panel.root.querySelector<HTMLInputElement>('.pdf-viewer__search-input');
    search?.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(onDecision).not.toHaveBeenCalled();
    panel.dispose();
  });

  test('DOM から切り離された（別ルート表示中の）パネルは反応しない', () => {
    const { panel, onDecision } = createPanel();
    document.body.replaceChildren(); // 切り離し（dispose はしない）
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(onDecision).not.toHaveBeenCalled();
    panel.dispose();
  });

  test('dispose 後は反応しない', () => {
    const { panel, onDecision } = createPanel();
    panel.dispose();
    pressKey('a');
    expect(onDecision).not.toHaveBeenCalled();
  });

  test('フォーカス復元: フォーム内にフォーカスがあるときだけ再描画後に戻す', () => {
    const { panel, onDecision } = createPanel();
    cellEl(panel.root, KEY_TOTAL)?.focus();
    pressKey('a');
    expect(onDecision).toHaveBeenCalledTimes(1);
    expect((document.activeElement as HTMLElement | null)?.dataset['cellKey']).toBe(KEY_TOTAL);
    // フォーカスが外（body）にあるときは奪わない
    (document.activeElement as HTMLElement | null)?.blur();
    pressKey('n');
    expect(document.activeElement).toBe(document.body);
    panel.dispose();
  });

  test('now 未指定でも ISO 時刻で判定を作る', () => {
    const onDecision = jest.fn();
    const panel = createVerificationPanel({ data: makeData(), onDecision, renderPage });
    document.body.replaceChildren(panel.root);
    pressKey('a');
    const decision = onDecision.mock.calls[0]?.[0] as Decision;
    expect(decision.decidedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    panel.dispose();
  });
});

describe('群構成の確定ゲート（arm 未確定時。ui-states.md §3 `#/verify`）', () => {
  test('未確定: arm タブがディムされ、AI ドラフトを初期値にした編集カードが出る', () => {
    const { panel } = createPanel({ armStructure: null });
    const tabs = panel.root.querySelectorAll<HTMLButtonElement>('.verify__tab');
    expect(tabs[1]?.disabled).toBe(true);
    const input = panel.root.querySelector<HTMLInputElement>('.verify__arm-name');
    // arm 名フィールド（name / label）が無いスキーマは表示ラベルが初期値
    expect(input?.value).toBe('群 1');
    panel.dispose();
  });

  test('arm 名フィールドがあるスキーマは Evidence の値を初期値にする', () => {
    const nameField = makeField({
      fieldId: 'f-arm-name',
      fieldIndex: 5,
      fieldName: 'arm_name',
      fieldLabel: '群の名称',
      entityLevel: 'arm',
    });
    const { panel } = createPanel({
      armStructure: null,
      fields: [...FIELDS, nameField],
      evidence: [
        ...EVIDENCE,
        makeEvidence({
          evidenceId: 'ev-name',
          fieldId: 'f-arm-name',
          entityKey: 'arm:1',
          value: 'アスピリン群',
          quote: null,
          anchorStatus: null,
        }),
      ],
    });
    expect(panel.root.querySelector<HTMLInputElement>('.verify__arm-name')?.value).toBe(
      'アスピリン群',
    );
    panel.dispose();
  });

  test('確定フローの楽観反映: 名称編集 → 確定でタブが有効になり onArmConfirm が呼ばれる', () => {
    const onArmConfirm = jest.fn();
    const { panel } = createPanel({ armStructure: null }, { onArmConfirm });
    const input = panel.root.querySelector<HTMLInputElement>('.verify__arm-name');
    input!.value = '  介入群  ';
    input!.dispatchEvent(new Event('change'));
    panel.root.querySelector<HTMLButtonElement>('#verify-arm-confirm')?.click();
    expect(onArmConfirm).toHaveBeenCalledWith([{ armKey: 'arm:1', armName: '介入群' }]);
    // 楽観反映: カードが要約になり、arm タブが有効化される
    expect(panel.root.querySelector('.verify__arm-summary')?.textContent).toContain(
      '群構成: 1 群（version 1）',
    );
    expect(panel.root.querySelectorAll<HTMLButtonElement>('.verify__tab')[1]?.disabled).toBe(
      false,
    );
    panel.dispose();
  });

  test('行の追加は次の arm:n を採番し、名称が空のままの確定はエラー', () => {
    const onArmConfirm = jest.fn();
    const { panel } = createPanel({ armStructure: null }, { onArmConfirm });
    panel.root.querySelector<HTMLButtonElement>('.verify__arm-add')?.click();
    const keys = [...panel.root.querySelectorAll('.verify__arm-key')].map(
      (node) => node.textContent,
    );
    expect(keys).toEqual(['arm:1', 'arm:2']);
    panel.root.querySelector<HTMLButtonElement>('#verify-arm-confirm')?.click();
    expect(onArmConfirm).not.toHaveBeenCalled();
    expect(panel.root.querySelector('#verify-arm-error')?.textContent).toContain('名称が空の群');
    panel.dispose();
  });

  test('全行削除しての確定は「少なくとも 1 つ」エラー。存在しない行の名称変更は無害', () => {
    const onArmConfirm = jest.fn();
    const { panel } = createPanel(
      { armStructure: null, evidence: [makeEvidence()] }, // arm Evidence なし → ドラフト 0 行
      { onArmConfirm },
    );
    panel.root.querySelector<HTMLButtonElement>('#verify-arm-confirm')?.click();
    expect(onArmConfirm).not.toHaveBeenCalled();
    expect(panel.root.querySelector('#verify-arm-error')?.textContent).toContain(
      '少なくとも 1 つの群が必要です',
    );
    // ドラフト 0 行からの追加は arm:1 になる
    panel.root.querySelector<HTMLButtonElement>('.verify__arm-add')?.click();
    expect(panel.root.querySelector('.verify__arm-key')?.textContent).toBe('arm:1');
    panel.dispose();
  });

  test('非数値の arm キーは追加時の採番で数えない（arm:1 から振る）', () => {
    const { panel } = createPanel({
      armStructure: null,
      evidence: [
        makeEvidence({
          evidenceId: 'ev-named',
          fieldId: 'f-arm-n',
          entityKey: 'arm:intervention',
          quote: null,
          anchorStatus: null,
        }),
      ],
    });
    panel.root.querySelector<HTMLButtonElement>('.verify__arm-add')?.click();
    const keys = [...panel.root.querySelectorAll('.verify__arm-key')].map(
      (node) => node.textContent,
    );
    expect(keys).toEqual(['arm:intervention', 'arm:1']);
    panel.dispose();
  });

  test('outcome キーの arm 参照からもドラフトを集める（削除ボタンの行詰めも確認）', () => {
    const { panel } = createPanel({
      armStructure: null,
      evidence: [
        makeEvidence({
          evidenceId: 'ev-out',
          fieldId: 'f-arm-n',
          entityKey: 'outcome:mortality|arm:2|time:30d',
          quote: null,
          anchorStatus: null,
        }),
        ...EVIDENCE,
      ],
    });
    const keys = () =>
      [...panel.root.querySelectorAll('.verify__arm-key')].map((node) => node.textContent);
    expect(keys()).toEqual(['arm:1', 'arm:2']);
    panel.root.querySelector<HTMLButtonElement>('.verify__arm-remove')?.click();
    expect(keys()).toEqual(['arm:2']);
    panel.dispose();
  });

  test('未確定のロック中: arm セルへのハイライトクリックとキーボードのタブ内クランプ', () => {
    const { panel, onDecision } = createPanel({ armStructure: null });
    // page 2 の arm ハイライトをクリックしてもロック中タブへは移らない
    panel.root.querySelector<HTMLButtonElement>('.pdf-viewer__next')?.click();
    const armRect = [...panel.root.querySelectorAll<HTMLButtonElement>('.pdf-viewer__hl')].find(
      (node) => node.getAttribute('aria-label') === '根拠: 群の N',
    );
    armRect?.click();
    expect(panel.root.querySelector('.verify__tab--active')?.textContent).toBe('Study');
    // study タブの判定操作は通常どおり有効
    pressKey('a');
    expect(onDecision).toHaveBeenCalledTimes(1);
    panel.dispose();
  });

  test('study 項目なしスキーマは初期表示から確定案内になり、キー操作は無害', () => {
    const armOnly = [
      makeField({ fieldId: 'f-arm-n', fieldName: 'arm_n', fieldLabel: '群の N', entityLevel: 'arm' }),
    ];
    const { panel, onDecision } = createPanel({
      armStructure: null,
      fields: armOnly,
      evidence: [
        makeEvidence({ fieldId: 'f-arm-n', entityKey: 'arm:1', quote: 'n=50 here', page: 2 }),
      ],
    });
    expect(panel.root.querySelector('.verify__locked-note')?.textContent).toBe(
      'まず群構成を確定してください',
    );
    pressKey('j');
    pressKey('a');
    expect(onDecision).not.toHaveBeenCalled();
    // 確定するとセルが描画される
    const input = panel.root.querySelector<HTMLInputElement>('.verify__arm-name');
    input!.value = 'A 群';
    input!.dispatchEvent(new Event('change'));
    panel.root.querySelector<HTMLButtonElement>('#verify-arm-confirm')?.click();
    expect(panel.root.querySelector('.verify__locked-note')).toBeNull();
    expect(panel.root.querySelector('.verify__cell')).not.toBeNull();
    panel.dispose();
  });

  test('改訂 → キャンセルで確定内容へ戻る（onArmConfirm は呼ばれない）', () => {
    const onArmConfirm = jest.fn();
    const { panel } = createPanel({}, { onArmConfirm });
    panel.root.querySelector<HTMLButtonElement>('#verify-arm-revise')?.click();
    const input = panel.root.querySelector<HTMLInputElement>('.verify__arm-name');
    expect(input?.value).toBe('介入群');
    input!.value = '書き換え';
    input!.dispatchEvent(new Event('change'));
    panel.root.querySelector<HTMLButtonElement>('.verify__arm-cancel')?.click();
    expect(panel.root.querySelector('.verify__arm-summary')?.textContent).toContain('介入群');
    expect(onArmConfirm).not.toHaveBeenCalled();
  });

  test('改訂の確定は version をインクリメントして onArmConfirm を呼ぶ', () => {
    const onArmConfirm = jest.fn();
    const { panel } = createPanel({}, { onArmConfirm });
    panel.root.querySelector<HTMLButtonElement>('#verify-arm-revise')?.click();
    panel.root.querySelector<HTMLButtonElement>('#verify-arm-confirm')?.click();
    expect(onArmConfirm).toHaveBeenCalledWith([{ armKey: 'arm:1', armName: '介入群' }]);
    expect(panel.root.querySelector('.verify__arm-summary')?.textContent).toContain('version 2');
    panel.dispose();
  });

  test('群構成が不要なスキーマ（study のみ）ではカードを出さない', () => {
    const { panel } = createPanel({
      armStructure: null,
      fields: [makeField()],
      evidence: [makeEvidence()],
    });
    expect(panel.root.querySelector('#verify-arm-card')).toBeNull();
    panel.dispose();
  });
});

describe('renderCachedVerificationPanel', () => {
  afterEach(() => {
    disposeVerificationPanelCache();
  });

  test('同じ VerificationData 参照なら同一 DOM を返す（判定の楽観状態を維持）', () => {
    const data = makeData();
    const onDecision = jest.fn();
    const first = renderCachedVerificationPanel({ data, onDecision, now: () => 't', renderPage });
    document.body.replaceChildren(first);
    pressKey('a');
    const second = renderCachedVerificationPanel({ data, onDecision, now: () => 't', renderPage });
    expect(second).toBe(first);
    expect(chipOf(second, KEY_TOTAL)).toBe('承認');
  });

  test('データが差し替わったら作り直し、古いパネルを破棄する', () => {
    const onDecision = jest.fn();
    const first = renderCachedVerificationPanel({
      data: makeData(),
      onDecision,
      now: () => 't',
      renderPage,
    });
    const second = renderCachedVerificationPanel({
      data: makeData({ document: makeDocumentRecord({ documentId: 'doc-2' }) }),
      onDecision,
      now: () => 't',
      renderPage,
    });
    expect(second).not.toBe(first);
    // 破棄済みの古いパネルはキー入力に反応しない
    document.body.replaceChildren(first);
    pressKey('a');
    expect(onDecision).not.toHaveBeenCalled();
  });

  test('disposeVerificationPanelCache は空でも安全', () => {
    disposeVerificationPanelCache();
    disposeVerificationPanelCache();
  });
});
