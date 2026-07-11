import {
  createVerificationPanel,
  disposeVerificationPanelCache,
  firstCellKeyOfUnit,
  locateCellInUnit,
  renderCachedVerificationPanel,
  stepUnitPosition,
  type VerificationPanelOptions,
} from '../../../../src/app/views/verificationPanel';
import type { Decision } from '../../../../src/domain/decision';
import type { DocumentRecord } from '../../../../src/domain/document';
import type { Evidence } from '../../../../src/domain/evidence';
import type { SchemaField } from '../../../../src/domain/schemaField';
import type { StudyRecord } from '../../../../src/domain/study';
import type { TextLayerPage } from '../../../../src/domain/textLayer';
import { cellKeyOf, emptyCellState } from '../../../../src/features/verification/cellState';
import type { VerificationCell } from '../../../../src/features/verification/cells';
import type { FocusUnit } from '../../../../src/features/verification/focusUnits';
import * as highlightsModule from '../../../../src/features/verification/highlights';
import type {
  LoadedPdfView,
  VerificationData,
  VerificationDocumentView,
} from '../../../../src/features/verification/types';
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
    rotation: 0,
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

/** テキスト層のないページ（scan 文書。text/items は空だが幾何情報は持つ。§7.4 PR4 の bbox テスト用） */
function buildBlankPage(page: number): TextLayerPage {
  return { page, text: '', width: 612, height: 792, rotation: 0, items: [] };
}

function makeDocumentRecord(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    documentId: 'doc-1',
    studyId: 'study-1',
    documentRole: 'article',
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

function makeStudy(overrides: Partial<StudyRecord> = {}): StudyRecord {
  return {
    studyId: 'study-1',
    studyLabel: 'Smith 2020',
    registrationId: null,
    createdAt: 't0',
    createdBy: 'me@example.com',
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
    studyId: 'study-1',
    documentId: 'doc-1',
    fieldId: 'f-total',
    entityKey: '-',
    value: '12',
    notReported: false,
    quote: 'mortality was 12 percent',
    page: 1,
    confidence: 'high',
    anchorStatus: 'exact',
    bboxPage: null,
    bbox: null,
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
    studyId: 'study-1',
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

/**
 * verificationPanel のテスト用文書フィクスチャ（issue #28 案3: PDF は遅延読込のため、
 * VerificationDocumentView 自体はテキストのみ〔extractedPages〕しか持たない。
 * PDF ビューア素材〔pdf / pdfError / textPages〕はここで別に保持し、
 * data.loadPdfView 経由でのみ取得できるようにする ── 本番の非同期読込を模す）。
 * textPages のテキストが extractedPages の正典（本番同様、同一抽出結果由来）
 */
interface DocFixture {
  document: DocumentRecord;
  textPages: readonly TextLayerPage[];
  /** PDF ロード結果。null は読み込み失敗（pdfError 必須） */
  pdf: PdfViewerDocument | null;
  pdfError: string | null;
}

function makeDocFixture(overrides: Partial<DocFixture> = {}): DocFixture {
  return {
    document: makeDocumentRecord(),
    textPages: PAGES,
    pdf: makePdf(),
    pdfError: null,
    ...overrides,
  };
}

function toDocumentView(fixture: DocFixture): VerificationDocumentView {
  return {
    document: fixture.document,
    extractedPages: fixture.textPages.map((page) => ({ page: page.page, text: page.text })),
    extractedTextError: null,
  };
}

/** fixtures から loadPdfView（= retryPdfView の既定）を作る。未知の documentId はエラーを返す */
function makeLoadPdfView(
  fixtures: readonly DocFixture[],
): (documentId: string) => Promise<LoadedPdfView> {
  const byId = new Map(fixtures.map((fixture) => [fixture.document.documentId, fixture]));
  return async (documentId: string): Promise<LoadedPdfView> => {
    const fixture = byId.get(documentId);
    if (fixture === undefined) {
      return { pdf: null, pdfError: `document_id "${documentId}" が見つかりません`, textPages: [] };
    }
    return {
      pdf: fixture.pdf,
      pdfError: fixture.pdfError,
      textPages: fixture.pdf === null ? [] : fixture.textPages,
    };
  };
}

/**
 * verificationPanel のテスト用データ生成。単一文書を既定とし、単一文書の便宜プロパティ
 * （document / pdf / pdfError / textPages）を渡すと 1 文書ぶんの documents 配列へ畳み込む。
 * 複数文書は documents（DocFixture[]）を直接渡す
 */
interface PanelDataOverrides
  extends Partial<Omit<VerificationData, 'study' | 'documents' | 'loadPdfView' | 'retryPdfView'>> {
  study?: StudyRecord;
  documents?: readonly DocFixture[];
  document?: DocumentRecord;
  pdf?: PdfViewerDocument | null;
  pdfError?: string | null;
  textPages?: readonly TextLayerPage[];
  loadPdfView?: (documentId: string) => Promise<LoadedPdfView>;
  retryPdfView?: (documentId: string) => Promise<LoadedPdfView>;
}

function makeData(overrides: PanelDataOverrides = {}): VerificationData {
  const { study, documents, document, pdf, pdfError, textPages, loadPdfView, retryPdfView, ...rest } =
    overrides;
  const fixtures: readonly DocFixture[] =
    documents ??
    [
      makeDocFixture({
        document: document ?? makeDocumentRecord(),
        pdf: pdf === undefined ? makePdf() : pdf,
        pdfError: pdfError ?? null,
        textPages: textPages ?? PAGES,
      }),
    ];
  const defaultLoader = makeLoadPdfView(fixtures);
  return {
    study: study ?? makeStudy(),
    documents: fixtures.map(toDocumentView),
    loadPdfView: loadPdfView ?? defaultLoader,
    retryPdfView: retryPdfView ?? defaultLoader,
    fields: FIELDS,
    evidence: EVIDENCE,
    decisions: [],
    annotator: ME,
    // 既定はレビューモード（human_with_ai）。独立入力モードの挙動は専用 describe で
    // annotatorType: 'human_independent' を明示して検証する
    annotatorType: 'human_with_ai',
    schemaVersion: 1,
    // 既定は確定済み（群構成ゲートの挙動は専用 describe で null にして検証する）
    armStructure: { version: 1, arms: [{ armKey: 'arm:1', armName: '介入群' }] },
    ...rest,
  };
}

// renderPdfPageToCanvas と同じ戻り値の形（{ promise, cancel }）を返す fake（issue #28 案3）
const renderPage = () => ({ promise: Promise.resolve({ width: 612, height: 792 }), cancel: jest.fn() });

/** PDF ロード（loadPdfView）の非同期解決を待つ（マイクロタスクを数回流す） */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

/**
 * 既定はリストモード（issue #38 前の既存カバレッジをそのまま維持するため）。
 * フォーカスモードの挙動は options.layoutMode: 'focus' を明示したテストで別途検証する
 */
async function createPanel(overrides: PanelDataOverrides = {}, options: Partial<VerificationPanelOptions> = {}) {
  const onDecision = jest.fn();
  const panel = createVerificationPanel({
    data: makeData(overrides),
    onDecision,
    // preload 判定（decidedAt 't0'）より後にソートされる時刻にする（'t-now' は '-' < '0' で 't0' より前になる）
    now: () => 't1',
    renderPage,
    layoutMode: 'list',
    ...options,
  });
  document.body.replaceChildren(panel.root);
  await flush(); // 初期表示の PDF 遅延ロード（data.loadPdfView）が解決するのを待つ
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

/** 手組みの VerificationCell（focusUnits.test.ts と同じ流儀で防御分岐を直接検証する用） */
function makeFocusCell(fieldId: string, entityKey: string): VerificationCell {
  const field = makeField({ fieldId });
  return { cellKey: cellKeyOf(fieldId, entityKey), field, entityKey, evidence: null, state: emptyCellState() };
}

describe('locateCellInUnit / stepUnitPosition（issue #38 フォーカスモードのユニット内ナビゲーション）', () => {
  // buildFocusUnits は実データでは null セルを生成しない（全フィールドが全列に必ず存在する）ため、
  // null スキップの防御分岐は focusUnits.test.ts と同じく手組みの FocusUnit で直接検証する
  const cellA1 = makeFocusCell('f-a', 'arm:1');
  const cellA2 = makeFocusCell('f-a', 'arm:2');
  const cellB1 = makeFocusCell('f-b', 'arm:1');
  // 群 2（arm:2）は f-b のセルを持たない（null）
  const unit: FocusUnit = {
    unitKey: 'arm|info',
    heading: 'info',
    columns: [
      { entityKey: 'arm:1', label: '介入群' },
      { entityKey: 'arm:2', label: '対照群' },
    ],
    rows: [
      { field: cellA1.field, cells: [cellA1, cellA2] },
      { field: cellB1.field, cells: [cellB1, null] },
    ],
    summary: null,
  };

  test('locateCellInUnit: 行 / 列インデックスを返し、見つからなければ null', () => {
    expect(locateCellInUnit(unit, cellA2.cellKey)).toEqual({ row: 0, col: 1 });
    expect(locateCellInUnit(unit, cellB1.cellKey)).toEqual({ row: 1, col: 0 });
    expect(locateCellInUnit(unit, 'nope')).toBeNull();
  });

  test('stepUnitPosition: 列移動で null セルをスキップする', () => {
    // cellB1（行 1・列 0）から列 +1 は null（cellB2 相当）なので、その先が無く null（端で停止）
    expect(stepUnitPosition(unit, { row: 1, col: 0 }, 'col', 1)).toBeNull();
    // cellA1（行 0・列 0）から列 +1 は非 null の cellA2
    expect(stepUnitPosition(unit, { row: 0, col: 0 }, 'col', 1)).toBe(cellA2.cellKey);
  });

  test('stepUnitPosition: 行移動で null セルをスキップする', () => {
    // cellA1（行 0・列 1 相当は cellA2）から行 +1 は列 1 が null（cellB2 相当）なので端で停止
    expect(stepUnitPosition(unit, { row: 0, col: 1 }, 'row', 1)).toBeNull();
    // 列 0 側は行 +1 で cellB1 に到達する
    expect(stepUnitPosition(unit, { row: 0, col: 0 }, 'row', 1)).toBe(cellB1.cellKey);
  });

  test('stepUnitPosition: 範囲外（端）は null', () => {
    expect(stepUnitPosition(unit, { row: 0, col: 0 }, 'col', -1)).toBeNull();
    expect(stepUnitPosition(unit, { row: 0, col: 0 }, 'row', -1)).toBeNull();
    expect(stepUnitPosition(unit, { row: 1, col: 1 }, 'row', 1)).toBeNull();
  });

  test('firstCellKeyOfUnit: null をスキップした先頭セルを返し、空ユニットは null', () => {
    expect(firstCellKeyOfUnit(unit)).toBe(cellA1.cellKey);
    const emptyUnit: FocusUnit = { ...unit, rows: [{ field: cellB1.field, cells: [null, null] }] };
    expect(firstCellKeyOfUnit(emptyUnit)).toBeNull();
  });
});

describe('createVerificationPanel: 構造', () => {
  test('2 ペイン + タブ + 先頭セルへの初期フォーカス。自分の判定だけが状態に反映される', async () => {
    const { panel } = await createPanel({
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

  test('テキスト層なし文献はバナーを出す（テキスト層ありは hidden）', async () => {
    const { panel } = await createPanel({
      document: makeDocumentRecord({ textStatus: 'no_text_layer' }),
      textPages: [],
    });
    const banner = panel.root.querySelector<HTMLElement>('.verify__banner');
    expect(banner?.hidden).toBe(false);
    expect(banner?.textContent).toContain('テキスト層がないためハイライト検証は使えません');
    panel.dispose();

    // テキスト層ありの文書ではバナー要素は存在するが hidden
    const ok = await createPanel();
    expect(ok.panel.root.querySelector<HTMLElement>('.verify__banner')?.hidden).toBe(true);
    ok.panel.dispose();
  });

  test('no_text_layer × bbox あり: バナーが AI 推定ハイライト文言になり、bbox セルは「ハイライトへ移動」が有効（§7.4 PR4）', async () => {
    const bboxEvidence = makeEvidence({
      anchorStatus: null,
      bboxPage: 1,
      bbox: { ymin: 100, xmin: 80, ymax: 180, xmax: 850 },
    });
    const { panel } = await createPanel({
      document: makeDocumentRecord({ textStatus: 'no_text_layer' }),
      textPages: [buildBlankPage(1)],
      evidence: [bboxEvidence],
    });
    const banner = panel.root.querySelector<HTMLElement>('.verify__banner');
    expect(banner?.hidden).toBe(false);
    expect(banner?.textContent).toContain('AI が推定した座標ハイライト');

    const quote = cellEl(panel.root, KEY_TOTAL)?.querySelector('.verify__quote');
    expect(quote?.querySelector('.verify__quote-jump')).not.toBeNull();
    expect(quote?.querySelector('.verify__quote-unanchored')).toBeNull();
    // bbox は常に 1 出現のため「他 n 箇所に一致」の切替ボタンは出さない
    expect(quote?.querySelector('.verify__quote-cycle')).toBeNull();
    // rects もメモ化される（applyLoadedPdf 経由の buildDocumentHighlights bbox 分岐）
    expect(panel.root.querySelectorAll('.pdf-viewer__hl')).toHaveLength(1);
    panel.dispose();
  });

  test('bbox とテキストマッチの両方を持つセルは、テキストマッチの一致件数を優先する（上書きしない。§7.4 PR4）', async () => {
    const both = makeEvidence({ bboxPage: 1, bbox: { ymin: 100, xmin: 80, ymax: 180, xmax: 850 } });
    const { panel } = await createPanel({ evidence: [both, ...EVIDENCE.slice(1)] });
    const cycleButton = cellEl(panel.root, KEY_TOTAL)?.querySelector('.verify__quote-cycle');
    // ev-1 は 2 ページに出現するテキストマッチ（既定の EVIDENCE 構成）→ bbox の matchCount=1 では
    // 上書きされず「他 1 箇所に一致（1 / 2）」のまま
    expect(cycleButton?.textContent).toContain('他 1 箇所に一致（1 / 2）');
    panel.dispose();
  });

  test('PDF が開けないときはエラー + 再取り込み導線を出し、フォームは使える', async () => {
    const { panel, onDecision } = await createPanel({ pdf: null, pdfError: 'ダウンロード失敗' });
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

  test('PDF エラー理由が無ければ「原因不明」', async () => {
    const { panel } = await createPanel({ pdf: null });
    expect(panel.root.querySelector('.verify__pdf-error')?.textContent).toContain('原因不明');
    panel.dispose();
  });

  test('loadPdfView が reject してもエラーカードとして扱う（throw しない設計への防御）', async () => {
    const { panel } = await createPanel({
      loadPdfView: async () => {
        throw new Error('reject 失敗');
      },
    });
    expect(panel.root.querySelector('.verify__pdf-error')?.textContent).toContain('reject 失敗');
    panel.dispose();
  });

  test('retryPdfView が reject してもエラーカードのまま留まる（throw しない設計への防御）', async () => {
    const { panel } = await createPanel({
      pdf: null,
      pdfError: '最初の失敗',
      retryPdfView: async () => {
        throw new Error('再試行も失敗');
      },
    });
    panel.root.querySelector<HTMLButtonElement>('.verify__pdf-retry')?.click();
    await flush();
    expect(panel.root.querySelector('.verify__pdf-error')?.textContent).toContain('再試行も失敗');
    panel.dispose();
  });

  test('reject が Error 以外でも文字列化してエラーカードに表示する', async () => {
    const { panel } = await createPanel({
      loadPdfView: () => Promise.reject('文字列エラー'),
    });
    expect(panel.root.querySelector('.verify__pdf-error')?.textContent).toContain('文字列エラー');
    panel.dispose();
  });

  test('同じ文書への再ロード成功が続く場合は setDocument を呼び直さない（同一文書の最適化）', async () => {
    const retryPdfView = jest.fn(async () => ({ pdf: makePdf(), pdfError: null, textPages: PAGES }));
    const { panel } = await createPanel({ pdf: null, pdfError: '失敗', retryPdfView });
    const retryButton = panel.root.querySelector<HTMLButtonElement>('.verify__pdf-retry');
    retryButton?.click();
    await flush();
    expect(panel.root.querySelector('.pdf-viewer')).not.toBeNull();
    // 成功後もボタン参照経由で同じ文書を再度読み込む（documentId は変わらず active のまま）
    retryButton?.click();
    await flush();
    expect(panel.root.querySelector('.pdf-viewer')).not.toBeNull();
    expect(retryPdfView).toHaveBeenCalledTimes(2);
    panel.dispose();
  });

  test('文書切替後に古い loadPdfView の reject は無視される（連番ガード）', async () => {
    const rejecters = new Map<string, (err: unknown) => void>();
    const loadPdfView = jest.fn(
      (documentId: string) =>
        new Promise<LoadedPdfView>((_resolve, reject) => {
          rejecters.set(documentId, reject);
        }),
    );
    const doc1 = makeDocFixture();
    const doc2 = makeDocFixture({
      document: makeDocumentRecord({ documentId: 'doc-2', filename: 'other.pdf' }),
    });
    const panel = createVerificationPanel({
      data: makeData({ documents: [doc1, doc2], loadPdfView, retryPdfView: loadPdfView }),
      onDecision: jest.fn(),
      now: () => 't1',
      renderPage,
      layoutMode: 'list',
    });
    document.body.replaceChildren(panel.root);
    // 初期表示（doc-1）が pending のまま doc-2 へ切替える
    panel.root.querySelectorAll<HTMLButtonElement>('.verify__doc-tab')[1]?.click();
    // doc-1（古い要求）を reject させても、連番ガードにより無視される
    rejecters.get('doc-1')?.(new Error('古い失敗'));
    await flush();
    expect(panel.root.querySelector('.verify__pdf-error')).toBeNull();
    panel.dispose();
  });

  test('再試行が解決する前に文書を切替えると、古い再試行結果は無視される（連番ガード）', async () => {
    const doc1 = makeDocFixture({ pdf: null, pdfError: '失敗' });
    const doc2 = makeDocFixture({
      document: makeDocumentRecord({ documentId: 'doc-2', filename: 'other.pdf' }),
    });
    const retryResolvers: Array<(v: LoadedPdfView) => void> = [];
    const retryPdfView = jest.fn(
      () =>
        new Promise<LoadedPdfView>((resolve) => {
          retryResolvers.push(resolve);
        }),
    );
    const { panel } = await createPanel({ documents: [doc1, doc2], retryPdfView });
    panel.root.querySelector<HTMLButtonElement>('.verify__pdf-retry')?.click(); // doc-1 の再試行（未解決）
    panel.root.querySelectorAll<HTMLButtonElement>('.verify__doc-tab')[1]?.click(); // doc-2 へ切替
    await flush();
    retryResolvers[0]?.({ pdf: makePdf(), pdfError: null, textPages: PAGES }); // 古い再試行の結果
    await flush();
    // doc-2 の表示のまま（古い再試行結果は反映されていない）
    expect(panel.root.querySelector('.verify__doc-tab--active')?.textContent).toContain('other.pdf');
    panel.dispose();
  });

  test('文書切替後に古い再試行ボタンを押しても無視される（documentId 不一致ガード）', async () => {
    const doc1 = makeDocFixture({ pdf: null, pdfError: '失敗' });
    const doc2 = makeDocFixture({
      document: makeDocumentRecord({ documentId: 'doc-2', filename: 'other.pdf' }),
    });
    const { panel } = await createPanel({ documents: [doc1, doc2] });
    const staleRetryButton = panel.root.querySelector<HTMLButtonElement>('.verify__pdf-retry');
    expect(staleRetryButton).not.toBeNull();
    panel.root.querySelectorAll<HTMLButtonElement>('.verify__doc-tab')[1]?.click();
    await flush();
    expect(panel.root.querySelector('.verify__pdf-body .pdf-viewer')).not.toBeNull();
    staleRetryButton?.click(); // documentId は doc-1 のまま（もう active ではない）
    await flush();
    // doc-2 の表示のまま変わらない（doc-1 向けの古い再試行は無視される）
    expect(panel.root.querySelector('.verify__pdf-body .pdf-viewer')).not.toBeNull();
    panel.dispose();
  });

  test('項目が無いデータでは空タブ（フォーカスなし）でキー操作も無害', async () => {
    const { panel, onDecision } = await createPanel({ fields: [], evidence: [], textPages: PAGES });
    expect(panel.root.querySelectorAll('.verify__tab')).toHaveLength(0);
    pressKey('j');
    pressKey('a');
    expect(onDecision).not.toHaveBeenCalled();
    panel.dispose();
  });
});

describe('createVerificationPanel: 複数文書ビューア（v0.10 フェーズ 3 + issue #28 案3の遅延ロード）', () => {
  const DOC2_PAGES = [buildPage(1, 'registration enrolled 200 participants total')];

  function doc2Fixture(overrides: Partial<DocFixture> = {}): DocFixture {
    return makeDocFixture({
      document: makeDocumentRecord({
        documentId: 'doc-2',
        documentRole: 'registration',
        filename: 'nct01.pdf',
      }),
      textPages: DOC2_PAGES,
      ...overrides,
    });
  }

  /** study レベルのみのスキーマ + f-total(doc-1) / f-country(doc-2) の Evidence */
  function studyFields(): SchemaField[] {
    return [
      makeField(),
      makeField({ fieldId: 'f-country', fieldIndex: 2, fieldName: 'country', fieldLabel: '国' }),
    ];
  }

  function twoDocEvidence(): Evidence[] {
    return [
      makeEvidence(), // f-total, doc-1
      makeEvidence({
        evidenceId: 'ev-c',
        fieldId: 'f-country',
        value: '200',
        quote: 'enrolled 200 participants',
        documentId: 'doc-2',
        page: 1,
        anchorStatus: 'exact',
      }),
    ];
  }

  async function makeTwoDocPanel(overrides: PanelDataOverrides = {}) {
    const panel = createVerificationPanel({
      data: makeData({
        documents: [makeDocFixture(), doc2Fixture()],
        fields: studyFields(),
        evidence: twoDocEvidence(),
        armStructure: null,
        ...overrides,
      }),
      onDecision: jest.fn(),
      now: () => 't1',
      renderPage,
      layoutMode: 'list',
    });
    document.body.replaceChildren(panel.root);
    await flush(); // 初期表示文書の PDF 遅延ロードを待つ
    return panel;
  }

  function docTabs(root: HTMLElement): HTMLButtonElement[] {
    return [...root.querySelectorAll<HTMLButtonElement>('.verify__doc-tabs .verify__doc-tab')];
  }

  test('2 文書は role バッジ + ファイル名の切替タブを出し、先頭が active', async () => {
    const panel = await makeTwoDocPanel();
    const tabs = docTabs(panel.root);
    expect(tabs).toHaveLength(2);
    expect(tabs[0]?.classList.contains('verify__doc-tab--active')).toBe(true);
    expect(tabs[0]?.querySelector('.verify__doc-role')?.textContent).toBe('本論文');
    expect(tabs[1]?.querySelector('.verify__doc-role')?.textContent).toBe('試験登録');
    expect(tabs[1]?.textContent).toContain('nct01.pdf');
    // active タブの再クリックは何も変えない（setActiveDocument の早期 return）
    tabs[0]?.click();
    expect(tabs[0]?.classList.contains('verify__doc-tab--active')).toBe(true);
    panel.dispose();
  });

  test('初期表示では表示していない文書（doc-2）の PDF を読み込まない', async () => {
    const loadPdfView = jest.fn(makeLoadPdfView([makeDocFixture(), doc2Fixture()]));
    const panel = await makeTwoDocPanel({ loadPdfView });
    // 初期表示（doc-1 が active）の時点で doc-2 の loadPdfView は一度も呼ばれない
    expect(loadPdfView).toHaveBeenCalledTimes(1);
    expect(loadPdfView).toHaveBeenCalledWith('doc-1');
    panel.dispose();
  });

  test('タブクリックで表示文書を切替える（active クラスが移動）+ 表示中文書だけ遅延ロードする', async () => {
    const loadPdfView = jest.fn(makeLoadPdfView([makeDocFixture(), doc2Fixture()]));
    const panel = await makeTwoDocPanel({ loadPdfView });
    const tabs = docTabs(panel.root);
    tabs[1]?.click();
    expect(tabs[1]?.classList.contains('verify__doc-tab--active')).toBe(true);
    expect(tabs[0]?.classList.contains('verify__doc-tab--active')).toBe(false);
    // タブ切替の直後（解決前）は読み込み中プレースホルダを表示する
    expect(panel.root.querySelector('.verify__pdf-loading')).not.toBeNull();
    await flush();
    expect(loadPdfView).toHaveBeenCalledWith('doc-2');
    expect(panel.root.querySelector('.verify__pdf-body .pdf-viewer')).not.toBeNull();
    panel.dispose();
  });

  test('別文書由来のセルへフォーカスすると出所 PDF へ自動切替する', async () => {
    const panel = await makeTwoDocPanel();
    const tabs = docTabs(panel.root);
    // 初期フォーカスは f-total（doc-1）。f-country（doc-2）へフォーカスすると doc-2 が active に
    const countryCell = cellEl(panel.root, cellKeyOf('f-country', '-'));
    countryCell?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(tabs[1]?.classList.contains('verify__doc-tab--active')).toBe(true);
    await flush();
    panel.dispose();
  });

  test('判定後の自動送りで遷移先が別文書なら PDF も切替える', async () => {
    const panel = await makeTwoDocPanel();
    const tabs = docTabs(panel.root);
    // f-total（doc-1）を承認 → 次の未判定 f-country（doc-2）へ移り、PDF も doc-2 へ
    cellEl(panel.root, cellKeyOf('f-total', '-'))
      ?.querySelector<HTMLButtonElement>('.verify__action--accept')
      ?.click();
    expect(tabs[1]?.classList.contains('verify__doc-tab--active')).toBe(true);
    await flush();
    expect(panel.root.querySelector('.verify__pdf-body .pdf-viewer')).not.toBeNull();
    panel.dispose();
  });

  test('初期フォーカスセルの出所が先頭以外の文書なら初期表示でその文書を開く', async () => {
    // Evidence が doc-2 のみ・初期フォーカス = その項目 → 初期 active は doc-2
    const panel = await makeTwoDocPanel({
      fields: [makeField()],
      evidence: [makeEvidence({ documentId: 'doc-2', quote: 'enrolled 200 participants', page: 1 })],
    });
    const tabs = docTabs(panel.root);
    expect(tabs[1]?.classList.contains('verify__doc-tab--active')).toBe(true);
    panel.dispose();
  });

  test('先頭文書の PDF が開けなくてもタブ切替で他文書のビューアを表示できる', async () => {
    const panel = await makeTwoDocPanel({
      documents: [makeDocFixture({ pdf: null, pdfError: '取得失敗' }), doc2Fixture()],
    });
    // 初期 active（doc-1）は PDF エラーカード（再試行ボタン付き）
    const errorCard = panel.root.querySelector('.verify__pdf-body .verify__pdf-error');
    expect(errorCard?.textContent).toContain('取得失敗');
    expect(errorCard?.querySelector('.verify__pdf-retry')).not.toBeNull();
    // doc-2 へ切替えるとビューアが出る
    docTabs(panel.root)[1]?.click();
    await flush();
    expect(panel.root.querySelector('.verify__pdf-body .pdf-viewer')).not.toBeNull();
    panel.dispose();
  });

  test('PDF 読込失敗の再試行ボタンでキャッシュを捨てて読み直す', async () => {
    const fixture = makeDocFixture({ pdf: null, pdfError: '取得失敗' });
    // 初回ロード（loadPdfView）は失敗のまま。retryPdfView だけ成功させて再試行の効果を確認する
    const retryPdfView = jest.fn(async () => ({ pdf: makePdf(), pdfError: null, textPages: PAGES }));
    const panel = await makeTwoDocPanel({ documents: [fixture, doc2Fixture()], retryPdfView });
    expect(panel.root.querySelector('.verify__pdf-error')).not.toBeNull();
    panel.root.querySelector<HTMLButtonElement>('.verify__pdf-retry')?.click();
    // 再試行中は読み込み中プレースホルダに戻る
    expect(panel.root.querySelector('.verify__pdf-loading')).not.toBeNull();
    await flush();
    expect(panel.root.querySelector('.verify__pdf-body .pdf-viewer')).not.toBeNull();
    expect(panel.root.querySelector('.verify__pdf-error')).toBeNull();
    // 矩形ハイライトのメモも差し替わる（失敗時の空 → 再試行後の実体化済み rects）
    expect(panel.root.querySelector('.pdf-viewer__hl')).not.toBeNull();
    panel.dispose();
  });

  test('矩形ハイライトは文書ロード時に 1 回だけ実体化し、判定・フォーカス移動では再計算しない（メモ化）', async () => {
    const spy = jest.spyOn(highlightsModule, 'buildDocumentHighlights');
    try {
      // 単一文書パネル（既定）: 文書切替が起きないため、ロードは初期表示の 1 回だけ
      const { panel } = await createPanel();
      expect(spy).toHaveBeenCalledTimes(1); // 初期表示文書のロード時のみ
      // フォーカス移動・判定・複数一致切替のたびに syncViewer は走るが、アンカリングは再計算しない
      pressKey('j');
      pressKey('k');
      pressKey('a'); // f-total を accept（判定 → 自動送り → syncViewer）
      cellEl(panel.root, KEY_TOTAL)
        ?.querySelector<HTMLButtonElement>('.verify__quote-cycle')
        ?.click(); // 複数一致の切替（refreshForm + syncViewer）
      expect(spy).toHaveBeenCalledTimes(1);
      panel.dispose();
    } finally {
      spy.mockRestore();
    }
  });

  test('テキストマッチと PDF テキスト層の件数がズレても matchIndex をクランプして描画する（防御）', async () => {
    // extractedPages（fixture の textPages 由来）は quote が 2 ページに出現するが、
    // PDF テキスト層（loadPdfView の応答）は 1 ページのみ = rect 出現は 1 件、という不整合を作る
    // （取り込み後に Drive 上の PDF が差し替えられたケースの再現）
    const onePage = PAGES.slice(0, 1);
    const loadPdfView = async (): Promise<LoadedPdfView> => ({
      pdf: makePdf(),
      pdfError: null,
      textPages: onePage,
    });
    const { panel } = await createPanel({ loadPdfView, retryPdfView: loadPdfView });
    // テキストマッチ基準では 2 出現 → 切替ボタンが出る
    const cycle = cellEl(panel.root, KEY_TOTAL)?.querySelector<HTMLButtonElement>(
      '.verify__quote-cycle',
    );
    expect(cycle?.textContent).toBe('他 1 箇所に一致（1 / 2）');
    cycle?.click(); // matchSelection = 1（テキストマッチ件数 2 の剰余）
    // rect 側は 1 出現のみ → 1 % 1 = 0 にクランプされ、オーバーレイは壊れず描画される
    expect(panel.root.querySelector('.pdf-viewer__hl')).not.toBeNull();
    panel.dispose();
  });

  test('全文書の PDF が開けないときはビューアなしでも判定できる', async () => {
    const onDecision = jest.fn();
    const panel = createVerificationPanel({
      data: makeData({
        documents: [
          makeDocFixture({ pdf: null, pdfError: 'x' }),
          doc2Fixture({ pdf: null, pdfError: 'y' }),
        ],
        fields: studyFields(),
        evidence: twoDocEvidence(),
        armStructure: null,
      }),
      onDecision,
      now: () => 't1',
      renderPage,
      layoutMode: 'list',
    });
    document.body.replaceChildren(panel.root);
    await flush();
    expect(panel.root.querySelector('.verify__pdf-body .pdf-viewer')).toBeNull();
    cellEl(panel.root, cellKeyOf('f-total', '-'))
      ?.querySelector<HTMLButtonElement>('.verify__action--accept')
      ?.click();
    expect(onDecision).toHaveBeenCalledTimes(1);
    panel.dispose();
  });

  test('高速な文書切替: 前の切替が解決する前に別の文書へ切替えても古い結果は表示に反映しない', async () => {
    const resolvers = new Map<string, (v: LoadedPdfView) => void>();
    const loadPdfView = jest.fn((documentId: string) => {
      return new Promise<LoadedPdfView>((resolve) => {
        resolvers.set(documentId, resolve);
      });
    });
    // 初期表示（doc-1）ぶんの解決を先に済ませておく
    const panel = createVerificationPanel({
      data: makeData({
        documents: [makeDocFixture(), doc2Fixture()],
        fields: studyFields(),
        evidence: twoDocEvidence(),
        armStructure: null,
        loadPdfView,
        retryPdfView: loadPdfView,
      }),
      onDecision: jest.fn(),
      now: () => 't1',
      renderPage,
      layoutMode: 'list',
    });
    document.body.replaceChildren(panel.root);
    resolvers.get('doc-1')?.({ pdf: makePdf(), pdfError: null, textPages: PAGES });
    await flush();

    const tabs = docTabs(panel.root);
    tabs[1]?.click(); // doc-2 への切替を開始（未解決のまま保持）
    tabs[0]?.click(); // 解決前に doc-1 へ戻す（doc-2 の結果はもう不要）。表示は読み込み中のまま
    expect(panel.root.querySelector('.verify__pdf-loading')).not.toBeNull();
    // 先に doc-2（古い要求）の読込を解決させても、連番ガードにより無視され表示は変わらない
    resolvers.get('doc-2')?.({ pdf: makePdf(), pdfError: 'この結果は表示されないはず', textPages: [] });
    await flush();
    expect(panel.root.querySelector('.verify__pdf-loading')).not.toBeNull();
    expect(panel.root.querySelector('.verify__pdf-body .pdf-viewer')).toBeNull();
    expect(panel.root.querySelector('.verify__pdf-error')).toBeNull();
    expect(tabs[0]?.classList.contains('verify__doc-tab--active')).toBe(true);
    // doc-1 の読込（最新の要求）を解決すると、その結果が表示に反映される
    resolvers.get('doc-1')?.({ pdf: null, pdfError: '最新の doc-1 の失敗', textPages: [] });
    await flush();
    expect(panel.root.querySelector('.verify__pdf-error')?.textContent).toContain('最新の doc-1 の失敗');
    panel.dispose();
  });
});

describe('左ペイン表示切替（PDF / 抽出テキスト。issue #28 案2）', () => {
  function toggleButtons(root: HTMLElement): { pdf: HTMLButtonElement; text: HTMLButtonElement } {
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('.verify__view-toggle-btn')];
    return { pdf: buttons[0] as HTMLButtonElement, text: buttons[1] as HTMLButtonElement };
  }

  test('既定は PDF モード（抽出テキストは非表示）', async () => {
    const { panel } = await createPanel();
    const { pdf, text } = toggleButtons(panel.root);
    expect(pdf.getAttribute('aria-pressed')).toBe('true');
    expect(text.getAttribute('aria-pressed')).toBe('false');
    expect(panel.root.querySelector<HTMLElement>('.verify__pdf-body')?.hidden).toBe(false);
    expect(panel.root.querySelector<HTMLElement>('.verify__text-body')?.hidden).toBe(true);
    panel.dispose();
  });

  test('抽出テキストへ切替: 出所文書 / ページ番号 / mark 強調 + 前後文脈を表示する', async () => {
    const { panel } = await createPanel();
    toggleButtons(panel.root).text.click();
    expect(toggleButtons(panel.root).text.getAttribute('aria-pressed')).toBe('true');
    expect(panel.root.querySelector<HTMLElement>('.verify__pdf-body')?.hidden).toBe(true);
    expect(panel.root.querySelector<HTMLElement>('.verify__text-body')?.hidden).toBe(false);
    expect(panel.root.querySelector('.text-viewer__doc-label')?.textContent).toBe(
      'smith2020.pdf（本論文）',
    );
    expect(panel.root.querySelector('.text-viewer__page')?.textContent).toBe('1 ページ');
    expect(panel.root.querySelector('mark.text-viewer__mark')?.textContent).toBe(
      'mortality was 12 percent',
    );
    panel.dispose();
  });

  test('PDF ボタンへ戻すと元に戻り、同モードの再クリックは無害', async () => {
    const { panel } = await createPanel();
    const { pdf, text } = toggleButtons(panel.root);
    text.click();
    pdf.click();
    expect(panel.root.querySelector<HTMLElement>('.verify__pdf-body')?.hidden).toBe(false);
    expect(panel.root.querySelector<HTMLElement>('.verify__text-body')?.hidden).toBe(true);
    pdf.click();
    expect(pdf.getAttribute('aria-pressed')).toBe('true');
    panel.dispose();
  });

  test('AI 抽出なしセル（Evidence なし）へフォーカス中は根拠未選択の案内になる', async () => {
    const { panel } = await createPanel();
    toggleButtons(panel.root).text.click();
    pressKey('j');
    pressKey('j'); // f-blank（Evidence なし）へ
    expect(panel.root.querySelector('.text-viewer__empty')).not.toBeNull();
    expect(panel.root.querySelector('.text-viewer__doc-label')).toBeNull();
    panel.dispose();
  });

  test('anchor 失敗など再特定不能な quote は quote 全文 + 案内を表示する', async () => {
    const { panel } = await createPanel();
    toggleButtons(panel.root).text.click();
    pressKey('j'); // f-country（anchor failed）
    expect(panel.root.querySelector('.text-viewer__unresolved-note')?.textContent).toContain(
      '再特定できません',
    );
    expect(panel.root.querySelector('.text-viewer__quote-full')?.textContent).toBe(
      'nowhere to be found',
    );
    panel.dispose();
  });

  test('quote の出所文書が study の documents に無い場合は根拠未選択表示になる（データ不整合の防御）', async () => {
    const { panel } = await createPanel({ evidence: [makeEvidence({ documentId: 'doc-ghost' })] });
    toggleButtons(panel.root).text.click();
    expect(panel.root.querySelector('.text-viewer__empty')).not.toBeNull();
    panel.dispose();
  });

  test('テキスト層がない文書では抽出テキストボタンが無効化 + 案内が出る', async () => {
    const { panel } = await createPanel({
      document: makeDocumentRecord({ textStatus: 'no_text_layer' }),
      textPages: [],
    });
    const { text } = toggleButtons(panel.root);
    expect(text.disabled).toBe(true);
    expect(text.title).not.toBe('');
    expect(panel.root.querySelector<HTMLElement>('.verify__view-toggle-note')?.hidden).toBe(false);
    panel.dispose();
  });

  test('テキストモード中にテキスト層のない文書へ自動切替すると PDF モードへ戻る', async () => {
    const docWithText = makeDocFixture();
    const docNoText = makeDocFixture({
      document: makeDocumentRecord({ documentId: 'doc-2', filename: 'jones2021.pdf' }),
      textPages: [],
    });
    const evidenceOnDoc2 = makeEvidence({
      evidenceId: 'ev-doc2',
      fieldId: 'f-country',
      documentId: 'doc-2',
      value: 'Japan',
      quote: null,
      anchorStatus: null,
      confidence: null,
    });
    const panel = createVerificationPanel({
      data: makeData({
        documents: [docWithText, docNoText],
        fields: [
          makeField(),
          makeField({ fieldId: 'f-country', fieldIndex: 2, fieldName: 'country', fieldLabel: '国' }),
        ],
        evidence: [makeEvidence(), evidenceOnDoc2],
      }),
      onDecision: jest.fn(),
      now: () => 't1',
      renderPage,
      layoutMode: 'list',
    });
    document.body.replaceChildren(panel.root);
    await flush();
    const { pdf, text } = toggleButtons(panel.root);
    text.click(); // doc-1 はテキストあり → テキストモードへ
    expect(text.getAttribute('aria-pressed')).toBe('true');
    // f-country（doc-2・テキストなし）へフォーカス → 出所 PDF へ自動切替 + モードも PDF へ自動で戻る
    pressKey('j');
    expect(pdf.getAttribute('aria-pressed')).toBe('true');
    expect(text.disabled).toBe(true);
    expect(panel.root.querySelector<HTMLElement>('.verify__text-body')?.hidden).toBe(true);
    await flush();
    panel.dispose();
  });

  test('根拠クリック（ハイライトへ移動）は、フォーカスを動かさずスニペットだけ差し替える', async () => {
    const secondField = makeField({
      fieldId: 'f-second',
      fieldIndex: 2,
      fieldName: 'second',
      fieldLabel: '2 つ目',
    });
    const secondEvidence = makeEvidence({
      evidenceId: 'ev-second',
      fieldId: 'f-second',
      quote: 'in total',
      page: 1,
    });
    const { panel } = await createPanel({
      fields: [makeField(), secondField],
      evidence: [makeEvidence(), secondEvidence],
    });
    toggleButtons(panel.root).text.click();
    // 初期フォーカスは f-total（先頭の未判定セル）
    expect(cellEl(panel.root, KEY_TOTAL)?.classList.contains('verify__cell--focused')).toBe(true);
    expect(panel.root.querySelector('mark.text-viewer__mark')?.textContent).toBe(
      'mortality was 12 percent',
    );
    const secondCell = cellEl(panel.root, cellKeyOf('f-second', '-'));
    secondCell?.querySelector<HTMLButtonElement>('.verify__quote-jump')?.click();
    // フォーカスは f-total のまま、スニペットだけ 2 つ目の quote へ差し替わる
    expect(cellEl(panel.root, KEY_TOTAL)?.classList.contains('verify__cell--focused')).toBe(true);
    expect(panel.root.querySelector('mark.text-viewer__mark')?.textContent).toBe('in total');
    panel.dispose();
  });

  test('f キー（根拠へジャンプ）はテキストモードでは PDF を操作せずスニペットのまま', async () => {
    const { panel } = await createPanel();
    toggleButtons(panel.root).text.click();
    pressKey('f');
    expect(panel.root.querySelector('.pdf-viewer__page-indicator')?.textContent).toBe(
      '1 / 2 ページ',
    );
    expect(panel.root.querySelector('mark.text-viewer__mark')?.textContent).toBe(
      'mortality was 12 percent',
    );
    panel.dispose();
  });
});

describe('判定操作', () => {
  test('承認ボタン: AI 値で accept を確定し、チップとハイライト色が更新される', async () => {
    const { panel, onDecision } = await createPanel();
    cellEl(panel.root, KEY_TOTAL)
      ?.querySelector<HTMLButtonElement>('.verify__action--accept')
      ?.click();
    expect(onDecision).toHaveBeenCalledWith({
      decidedAt: 't1',
      decidedBy: ME,
      studyId: 'study-1',
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

  test('AI が未報告と主張する値の承認は NR で確定する', async () => {
    const { panel, onDecision } = await createPanel({
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

  test('キーボード: a で次の未判定セルへ自動遷移し、n は遷移先セルに効く', async () => {
    const { panel, onDecision } = await createPanel();
    pressKey('z'); // 履歴なし → 無害
    expect(onDecision).not.toHaveBeenCalled();
    // 先頭 f-total を accept → 次の未判定 f-country へフォーカスが移る（j キー不要）
    pressKey('a');
    expect(onDecision).toHaveBeenLastCalledWith(
      expect.objectContaining({ fieldId: 'f-total', action: 'accept', value: '12' }),
    );
    expect(cellEl(panel.root, KEY_COUNTRY)?.classList.contains('verify__cell--focused')).toBe(true);
    // n は遷移先の f-country に効く
    pressKey('n');
    expect(onDecision).toHaveBeenLastCalledWith(
      expect.objectContaining({ fieldId: 'f-country', action: 'not_reported', value: 'NR' }),
    );
    panel.dispose();
  });

  test('単一セルタブ: 全セル判定済みなら留まり、undo は同じセルで前の値へ戻す', async () => {
    const { panel, onDecision } = await createPanel();
    // arm タブ（単一セル f-arm-n。群構成は確定済み）へ切替
    panel.root.querySelectorAll<HTMLButtonElement>('.verify__tab')[1]?.click();
    expect(cellEl(panel.root, KEY_ARM)?.classList.contains('verify__cell--focused')).toBe(true);
    pressKey('a'); // accept → 他に未判定セルなし → 留まる
    expect(onDecision).toHaveBeenLastCalledWith(
      expect.objectContaining({ fieldId: 'f-arm-n', action: 'accept', value: '50' }),
    );
    expect(cellEl(panel.root, KEY_ARM)?.classList.contains('verify__cell--focused')).toBe(true);
    pressKey('n'); // not_reported → 留まる
    expect(cellEl(panel.root, KEY_ARM)?.classList.contains('verify__cell--focused')).toBe(true);
    pressKey('z'); // undo → accept の値 '50' へ戻す・留まる
    expect(onDecision).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'undo', value: '50' }),
    );
    expect(chipOf(panel.root, KEY_ARM)).toBe('承認');
    expect(cellEl(panel.root, KEY_ARM)?.classList.contains('verify__cell--focused')).toBe(true);
    panel.dispose();
  });

  test('AI 抽出なしセルでは a が無害（評拠なしの accept 不可）', async () => {
    const { panel, onDecision } = await createPanel();
    pressKey('j');
    pressKey('j'); // f-blank（Evidence なし）へ
    expect(
      cellEl(panel.root, KEY_BLANK)?.classList.contains('verify__cell--focused'),
    ).toBe(true);
    pressKey('a');
    expect(onDecision).not.toHaveBeenCalled();
    panel.dispose();
  });

  test('e で編集を開始し、入力へフォーカス・Enter で確定（空入力は null）', async () => {
    const { panel, onDecision } = await createPanel();
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

  test('x で棄却入力を開き、空のまま確定すると value は null', async () => {
    const { panel, onDecision } = await createPanel();
    pressKey('x');
    const input = panel.root.querySelector<HTMLInputElement>('.verify__edit-input');
    expect(input?.value).toBe('');
    panel.root.querySelector<HTMLButtonElement>('.verify__edit-confirm')?.click();
    expect(onDecision).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'reject', value: null }),
    );
    panel.dispose();
  });

  test('編集の Escape キャンセルで判定ボタンへ戻る', async () => {
    const { panel, onDecision } = await createPanel();
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
  test('j / k / 矢印キーで項目を移動し、端でクランプする', async () => {
    const { panel } = await createPanel();
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

  test('f で現在項目のハイライトへ PDF がスクロールする', async () => {
    const { panel } = await createPanel();
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

  test('ハイライトクリックで対応セルへフォーカス（同一タブは再構築なし）', async () => {
    const { panel } = await createPanel();
    pressKey('j'); // f-country へ
    const rect = panel.root.querySelector<HTMLButtonElement>('.pdf-viewer__hl');
    rect?.click(); // f-total のハイライト
    expect(cellEl(panel.root, KEY_TOTAL)?.classList.contains('verify__cell--focused')).toBe(true);
    // 同じセルの再クリックは何もしない（早期 return）
    panel.root.querySelector<HTMLButtonElement>('.pdf-viewer__hl')?.click();
    expect(cellEl(panel.root, KEY_TOTAL)?.classList.contains('verify__cell--focused')).toBe(true);
    panel.dispose();
  });

  test('別タブのハイライトクリックでタブが切り替わる（scrollIntoView があれば呼ぶ）', async () => {
    const scrollIntoView = jest.fn();
    (HTMLElement.prototype as unknown as { scrollIntoView: unknown }).scrollIntoView =
      scrollIntoView;
    try {
      const { panel } = await createPanel();
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

  test('セル DOM への直接フォーカス（focusin）でパネルのフォーカスが移る', async () => {
    const { panel } = await createPanel();
    cellEl(panel.root, KEY_COUNTRY)?.focus();
    expect(cellEl(panel.root, KEY_COUNTRY)?.classList.contains('verify__cell--focused')).toBe(
      true,
    );
    expect(cellEl(panel.root, KEY_TOTAL)?.classList.contains('verify__cell--focused')).toBe(false);
    panel.dispose();
  });

  test('arm Evidence が無くても確定 arm から空セルを作る', async () => {
    const { panel, onDecision } = await createPanel({
      evidence: [makeEvidence()],
    });
    panel.root.querySelectorAll<HTMLButtonElement>('.verify__tab')[1]?.click();
    expect(panel.root.querySelector('.verify__empty')).toBeNull();
    expect(panel.root.querySelector('.verify__ai--none')?.textContent).toContain('AI 抽出なし');
    expect(cellEl(panel.root, KEY_ARM)?.classList.contains('verify__cell--focused')).toBe(true);
    pressKey('a'); // Evidence なしなので accept は無害
    expect(onDecision).not.toHaveBeenCalled();
    panel.dispose();
  });

  test('タブの手動切替は最初の未判定セルへフォーカスし直す', async () => {
    const { panel } = await createPanel();
    const tabs = panel.root.querySelectorAll<HTMLButtonElement>('.verify__tab');
    tabs[1]?.click();
    expect(panel.root.querySelector('.verify__tab--active')?.textContent).toBe('群（arm）');
    expect(cellEl(panel.root, KEY_ARM)?.classList.contains('verify__cell--focused')).toBe(true);
    panel.dispose();
  });

  test('セルに対応しないハイライト（entity_key 不正）は無視される', async () => {
    const { panel } = await createPanel({
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

  test('anchor failed の「本文内を検索」は quote をビューア検索へ投入する', async () => {
    const { panel } = await createPanel();
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

  test('ハイライト色: low confidence は橙、判定済みは緑', async () => {
    const { panel } = await createPanel({ decisions: [makeDecision({ fieldId: 'f-arm-n', entityKey: 'arm:1', value: '50' })] });
    panel.root.querySelector<HTMLButtonElement>('.pdf-viewer__next')?.click();
    // arm セルは判定済み → verified が優先される
    expect(panel.root.querySelector('.pdf-viewer__hl--verified')).not.toBeNull();
    panel.dispose();
  });

  test('未判定 + low confidence のハイライトは橙になる', async () => {
    const { panel } = await createPanel();
    panel.root.querySelector<HTMLButtonElement>('.pdf-viewer__next')?.click();
    expect(panel.root.querySelector('.pdf-viewer__hl--low')).not.toBeNull();
    panel.dispose();
  });
});

describe('自動遷移・初期フォーカス・スクロール保持（UX 改善）', () => {
  test('初期フォーカスは最初の未判定セル（判定済みセルをスキップ）', async () => {
    const { panel } = await createPanel({
      decisions: [makeDecision({ fieldId: 'f-total', value: '12' })], // f-total 承認済み
    });
    expect(cellEl(panel.root, KEY_COUNTRY)?.classList.contains('verify__cell--focused')).toBe(true);
    expect(cellEl(panel.root, KEY_TOTAL)?.classList.contains('verify__cell--focused')).toBe(false);
    panel.dispose();
  });

  test('判定後は判定済みセルをスキップして次の未判定セルへ遷移する', async () => {
    const { panel } = await createPanel({
      decisions: [makeDecision({ fieldId: 'f-country', value: 'Japan' })], // f-country 承認済み
    });
    // 初期フォーカス = 未判定の先頭 f-total
    expect(cellEl(panel.root, KEY_TOTAL)?.classList.contains('verify__cell--focused')).toBe(true);
    pressKey('a'); // f-total を accept → f-country（判定済み）をスキップして f-blank へ
    expect(cellEl(panel.root, KEY_BLANK)?.classList.contains('verify__cell--focused')).toBe(true);
    panel.dispose();
  });

  test('undo は他に未判定セルがあっても同じセルに留まる（取り消し直後の再判定用）', async () => {
    const { panel } = await createPanel({
      decisions: [makeDecision({ fieldId: 'f-total', value: '12' })], // f-total 承認済み → 判定済みブロック
    });
    // 初期フォーカスは f-country。判定済み f-total は下部ブロックにあり j × 2 で到達（展開される）
    pressKey('j');
    pressKey('j');
    expect(cellEl(panel.root, KEY_TOTAL)?.classList.contains('verify__cell--focused')).toBe(true);
    pressKey('z'); // undo f-total → 未判定 f-country / f-blank があっても f-total に留まる
    expect(cellEl(panel.root, KEY_TOTAL)?.classList.contains('verify__cell--focused')).toBe(true);
    panel.dispose();
  });

  test('refreshForm はスクロール位置を保持する（判定後に先頭へ飛ばない）', async () => {
    const { panel } = await createPanel();
    const formPane = panel.root.querySelector<HTMLElement>('.verify__pane--form')!;
    let scrollTop = 0;
    Object.defineProperty(formPane, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
      },
    });
    formPane.scrollTop = 120; // ユーザーが下方へスクロール
    pressKey('a'); // 判定で refreshForm が走ってもスクロール位置は維持される
    expect(formPane.scrollTop).toBe(120);
    panel.dispose();
  });

  test('判定後の自動遷移で遷移先セルへ scrollIntoView + フォーカスする', async () => {
    const scrollIntoView = jest.fn();
    (HTMLElement.prototype as unknown as { scrollIntoView: unknown }).scrollIntoView =
      scrollIntoView;
    try {
      const { panel } = await createPanel();
      cellEl(panel.root, KEY_TOTAL)?.focus(); // f-total にフォーカス
      pressKey('a'); // accept → f-country へ自動遷移
      expect(document.activeElement).toBe(cellEl(panel.root, KEY_COUNTRY));
      expect(scrollIntoView).toHaveBeenCalled();
      panel.dispose();
    } finally {
      delete (HTMLElement.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });
});

describe('判定済みブロック（未判定を上・判定済みを下部へ）', () => {
  test('直近判定は元の位置に残り、次の判定で判定済みブロックへ移る', async () => {
    const { panel } = await createPanel();
    pressKey('a'); // f-total accept → 直近判定として元の位置に残る
    expect(panel.root.querySelector('.verify__group--decided')).toBeNull();
    expect(cellEl(panel.root, KEY_TOTAL)?.classList.contains('verify__cell--decided')).toBe(false);
    pressKey('a'); // f-country accept → f-total が判定済みブロックのコンパクト行へ
    expect(panel.root.querySelector('.verify__group--decided')).not.toBeNull();
    expect(cellEl(panel.root, KEY_TOTAL)?.classList.contains('verify__cell--decided')).toBe(true);
    expect(cellEl(panel.root, KEY_COUNTRY)?.classList.contains('verify__cell--decided')).toBe(
      false,
    );
    panel.dispose();
  });

  test('コンパクト行クリックで展開し、「たたむ」でコンパクトへ戻る', async () => {
    const { panel } = await createPanel({
      decisions: [makeDecision({ fieldId: 'f-total', value: '12' })],
    });
    const row = cellEl(panel.root, KEY_TOTAL);
    expect(row?.classList.contains('verify__cell--decided')).toBe(true);
    row?.click();
    const expanded = cellEl(panel.root, KEY_TOTAL);
    expect(expanded?.classList.contains('verify__cell--decided')).toBe(false);
    expect(expanded?.querySelector('.verify__actions')).not.toBeNull();
    expect(expanded?.classList.contains('verify__cell--focused')).toBe(true);
    expanded?.querySelector<HTMLButtonElement>('.verify__decided-collapse')?.click();
    expect(cellEl(panel.root, KEY_TOTAL)?.classList.contains('verify__cell--decided')).toBe(true);
    panel.dispose();
  });

  test('ハイライトクリックで判定済みセルへ着地すると展開される（同一タブ）', async () => {
    const { panel } = await createPanel({
      decisions: [makeDecision({ fieldId: 'f-total', value: '12' })],
    });
    // 初期フォーカスは f-country。page 1 の f-total ハイライトをクリック
    panel.root.querySelector<HTMLButtonElement>('.pdf-viewer__hl')?.click();
    const expanded = cellEl(panel.root, KEY_TOTAL);
    expect(expanded?.classList.contains('verify__cell--focused')).toBe(true);
    expect(expanded?.querySelector('.verify__actions')).not.toBeNull();
    panel.dispose();
  });

  test('別タブの判定済みセルへのハイライトクリックはタブ切替 + 展開になる', async () => {
    const { panel } = await createPanel({
      decisions: [makeDecision({ fieldId: 'f-arm-n', entityKey: 'arm:1', value: '50' })],
    });
    panel.root.querySelector<HTMLButtonElement>('.pdf-viewer__next')?.click();
    const armRect = [...panel.root.querySelectorAll<HTMLButtonElement>('.pdf-viewer__hl')].find(
      (node) => node.getAttribute('aria-label') === '根拠: 群の N',
    );
    armRect?.click();
    expect(panel.root.querySelector('.verify__tab--active')?.textContent).toBe('群（arm）');
    const expanded = cellEl(panel.root, KEY_ARM);
    expect(expanded?.classList.contains('verify__cell--decided')).toBe(false);
    expect(expanded?.querySelector('.verify__actions')).not.toBeNull();
    panel.dispose();
  });
});

describe('キーボードガード', () => {
  test('修飾キー付き・入力フィールド・未知キーは無視する', async () => {
    const { panel, onDecision } = await createPanel();
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

  test('DOM から切り離された（別ルート表示中の）パネルは反応しない', async () => {
    const { panel, onDecision } = await createPanel();
    document.body.replaceChildren(); // 切り離し（dispose はしない）
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(onDecision).not.toHaveBeenCalled();
    panel.dispose();
  });

  test('dispose 後は反応しない', async () => {
    const { panel, onDecision } = await createPanel();
    panel.dispose();
    pressKey('a');
    expect(onDecision).not.toHaveBeenCalled();
  });

  test('undo のフォーカス復元: フォーム内フォーカス時は同じセルへ戻す', async () => {
    const { panel, onDecision } = await createPanel({
      decisions: [makeDecision({ fieldId: 'f-total', value: '12' })], // f-total 承認済み（undo 可能）
    });
    // 初期フォーカスは未判定の f-country。j × 2 で判定済みブロックの f-total へ移動しフォーカス
    pressKey('j');
    pressKey('j');
    expect((document.activeElement as HTMLElement | null)?.dataset['cellKey']).toBe(KEY_TOTAL);
    pressKey('z'); // undo f-total（同セルに留まる）→ hadFocus true でフォーカス復元
    expect(onDecision).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'undo' }));
    expect((document.activeElement as HTMLElement | null)?.dataset['cellKey']).toBe(KEY_TOTAL);
    panel.dispose();
  });

  test('undo のフォーカス復元: body にフォーカスがなければ奪わない', async () => {
    const { panel, onDecision } = await createPanel({
      decisions: [
        makeDecision({ fieldId: 'f-total', value: '12' }),
        makeDecision({ fieldId: 'f-country', value: 'Japan' }),
        makeDecision({ fieldId: 'f-blank', value: 'RCT' }),
      ],
    });
    // 全 study セル判定済み → 初期フォーカスは先頭 f-total（DOM フォーカスは未設定 = body）
    expect(document.activeElement).toBe(document.body);
    expect(cellEl(panel.root, KEY_TOTAL)?.classList.contains('verify__cell--focused')).toBe(true);
    pressKey('z'); // undo f-total → 留まる・body のまま（フォーカスを奪わない）
    expect(onDecision).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'undo' }));
    expect(document.activeElement).toBe(document.body);
    panel.dispose();
  });

  test('now 未指定でも ISO 時刻で判定を作る', async () => {
    const onDecision = jest.fn();
    const panel = createVerificationPanel({ data: makeData(), onDecision, renderPage, layoutMode: 'list' });
    document.body.replaceChildren(panel.root);
    pressKey('a');
    const decision = onDecision.mock.calls[0]?.[0] as Decision;
    expect(decision.decidedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    panel.dispose();
  });
});

describe('群構成の確定ゲート（arm 未確定時。ui-states.md §3 `#/verify`）', () => {
  test('未確定: arm タブがディムされ、AI ドラフトを初期値にした編集カードが出る', async () => {
    const { panel } = await createPanel({ armStructure: null });
    const tabs = panel.root.querySelectorAll<HTMLButtonElement>('.verify__tab');
    expect(tabs[1]?.disabled).toBe(true);
    const input = panel.root.querySelector<HTMLInputElement>('.verify__arm-name');
    // arm 名フィールド（name / label）が無いスキーマは表示ラベルが初期値
    expect(input?.value).toBe('群 1');
    panel.dispose();
  });

  test('arm 名フィールドがあるスキーマは Evidence の値を初期値にする', async () => {
    const nameField = makeField({
      fieldId: 'f-arm-name',
      fieldIndex: 5,
      fieldName: 'arm_name',
      fieldLabel: '群の名称',
      entityLevel: 'arm',
    });
    const { panel } = await createPanel({
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

  test('確定フローの楽観反映: 名称編集 → 確定でタブが有効になり onArmConfirm が呼ばれる', async () => {
    const onArmConfirm = jest.fn();
    const { panel } = await createPanel({ armStructure: null }, { onArmConfirm });
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

  test('行の追加は次の arm:n を採番し、名称が空のままの確定はエラー', async () => {
    const onArmConfirm = jest.fn();
    const { panel } = await createPanel({ armStructure: null }, { onArmConfirm });
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

  test('全行削除しての確定は「少なくとも 1 つ」エラー。存在しない行の名称変更は無害', async () => {
    const onArmConfirm = jest.fn();
    const { panel } = await createPanel(
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

  test('非数値の arm キーは追加時の採番で数えない（arm:1 から振る）', async () => {
    const { panel } = await createPanel({
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

  test('outcome キーの arm 参照からもドラフトを集める（削除ボタンの行詰めも確認）', async () => {
    const { panel } = await createPanel({
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

  test('未確定のロック中: arm セルへのハイライトクリックとキーボードのタブ内クランプ', async () => {
    const { panel, onDecision } = await createPanel({ armStructure: null });
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

  test('rob_domain タブは arm 未確定でもロックされず判定できる（群構成に依存しない）', async () => {
    const robField = makeField({
      fieldId: 'f-rob',
      fieldIndex: 5,
      section: 'risk_of_bias',
      fieldName: 'rob2_judgement',
      fieldLabel: 'RoB 2 判定（ドメイン別）',
      entityLevel: 'rob_domain',
      dataType: 'enum',
      allowedValues: 'low|some_concerns|high',
    });
    const { panel, onDecision } = await createPanel({
      armStructure: null,
      fields: [...FIELDS, robField],
      evidence: [
        ...EVIDENCE,
        makeEvidence({
          evidenceId: 'ev-rob',
          fieldId: 'f-rob',
          entityKey: 'rob:d1_randomization',
          value: 'low',
          quote: null,
          anchorStatus: null,
        }),
      ],
    });
    const tabs = [...panel.root.querySelectorAll<HTMLButtonElement>('.verify__tab')];
    expect(tabs.find((tab) => tab.textContent === '群（arm）')?.disabled).toBe(true);
    const robTab = tabs.find((tab) => tab.textContent === 'RoB');
    expect(robTab?.disabled).toBe(false);
    robTab?.click();
    // ドメインごとのインスタンスグループが描画され、ロック案内は出ない
    expect(panel.root.querySelector('.verify__group-heading')?.textContent).toBe(
      'RoB: d1_randomization',
    );
    expect(panel.root.querySelector('.verify__locked-note')).toBeNull();
    // 判定操作も通常どおり通る
    pressKey('a');
    expect(onDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        fieldId: 'f-rob',
        entityKey: 'rob:d1_randomization',
        action: 'accept',
      }),
    );
    panel.dispose();
  });

  test('study 項目なしスキーマは初期表示から確定案内になり、キー操作は無害', async () => {
    const armOnly = [
      makeField({ fieldId: 'f-arm-n', fieldName: 'arm_n', fieldLabel: '群の N', entityLevel: 'arm' }),
    ];
    const { panel, onDecision } = await createPanel({
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

  test('改訂 → キャンセルで確定内容へ戻る（onArmConfirm は呼ばれない）', async () => {
    const onArmConfirm = jest.fn();
    const { panel } = await createPanel({}, { onArmConfirm });
    panel.root.querySelector<HTMLButtonElement>('#verify-arm-revise')?.click();
    const input = panel.root.querySelector<HTMLInputElement>('.verify__arm-name');
    expect(input?.value).toBe('介入群');
    input!.value = '書き換え';
    input!.dispatchEvent(new Event('change'));
    panel.root.querySelector<HTMLButtonElement>('.verify__arm-cancel')?.click();
    expect(panel.root.querySelector('.verify__arm-summary')?.textContent).toContain('介入群');
    expect(onArmConfirm).not.toHaveBeenCalled();
  });

  test('改訂の確定は version をインクリメントして onArmConfirm を呼ぶ', async () => {
    const onArmConfirm = jest.fn();
    const { panel } = await createPanel({}, { onArmConfirm });
    panel.root.querySelector<HTMLButtonElement>('#verify-arm-revise')?.click();
    panel.root.querySelector<HTMLButtonElement>('#verify-arm-confirm')?.click();
    expect(onArmConfirm).toHaveBeenCalledWith([{ armKey: 'arm:1', armName: '介入群' }]);
    expect(panel.root.querySelector('.verify__arm-summary')?.textContent).toContain('version 2');
    panel.dispose();
  });

  test('群構成が不要なスキーマ（study のみ）ではカードを出さない', async () => {
    const { panel } = await createPanel({
      armStructure: null,
      fields: [makeField()],
      evidence: [makeEvidence()],
    });
    expect(panel.root.querySelector('#verify-arm-card')).toBeNull();
    panel.dispose();
  });
});

describe('outcome_result インスタンス追加', () => {
  const outcomeField = makeField({
    fieldId: 'f-out-event',
    fieldIndex: 5,
    section: 'outcomes',
    fieldName: 'event_count',
    fieldLabel: 'イベント数',
    entityLevel: 'outcome_result',
  });

  async function openOutcomePanel(options: Partial<VerificationPanelOptions> = {}) {
    const onInstanceDeclare = jest.fn();
    const created = await createPanel(
      { fields: [...FIELDS, outcomeField] },
      { onInstanceDeclare, ...options },
    );
    [...created.panel.root.querySelectorAll<HTMLButtonElement>('.verify__tab')]
      .find((button) => button.textContent === 'アウトカム')
      ?.click();
    return { ...created, onInstanceDeclare };
  }

  test('アウトカムキーと時点から確定 arm 全体の宣言イベントを作り、空セルを表示する', async () => {
    const { panel, onInstanceDeclare } = await openOutcomePanel();
    expect(panel.root.querySelector('#verify-outcome-add')).not.toBeNull();
    const key = panel.root.querySelector<HTMLInputElement>('#verify-outcome-key');
    const time = panel.root.querySelector<HTMLInputElement>('#verify-outcome-time');
    expect(key?.value).toBe('outcome_1');
    key!.value = 'mortality';
    key!.dispatchEvent(new Event('change'));
    time!.value = '30d';
    time!.dispatchEvent(new Event('change'));
    panel.root.querySelector<HTMLButtonElement>('#verify-outcome-add-button')?.click();

    expect(onInstanceDeclare).toHaveBeenCalledWith([
      expect.objectContaining({
        decidedAt: 't1',
        decidedBy: ME,
        studyId: 'study-1',
        fieldId: '__entity_instance__',
        entityKey: 'outcome:mortality|arm:1|time:30d',
        annotator: ME,
        annotatorType: 'human_with_ai',
        schemaVersion: 1,
        action: 'edit',
        value: 'outcome:mortality|arm:1|time:30d',
        note: 'outcome_instance_declared',
      }),
    ]);
    const cell = cellEl(panel.root, cellKeyOf('f-out-event', 'outcome:mortality|arm:1|time:30d'));
    expect(cell).not.toBeNull();
    expect(cell?.textContent).toContain('AI 抽出なし');
    expect(cell?.classList.contains('verify__cell--focused')).toBe(true);
    expect(panel.root.querySelector<HTMLInputElement>('#verify-outcome-key')?.value).toBe(
      'outcome_1',
    ); // mortality は番号付きではないので次の既定も outcome_1
    panel.dispose();
  });

  test('既存キーとの衝突は保存せずエラー表示する', async () => {
    const { panel, onInstanceDeclare } = await openOutcomePanel();
    panel.root.querySelector<HTMLButtonElement>('#verify-outcome-add-button')?.click();
    expect(onInstanceDeclare).toHaveBeenCalledTimes(1);
    const key = panel.root.querySelector<HTMLInputElement>('#verify-outcome-key');
    key!.value = 'outcome_1';
    key!.dispatchEvent(new Event('change'));
    panel.root.querySelector<HTMLButtonElement>('#verify-outcome-add-button')?.click();
    expect(onInstanceDeclare).toHaveBeenCalledTimes(1);
    expect(panel.root.querySelector('#verify-outcome-error')?.textContent).toContain(
      '既に存在します',
    );
    panel.dispose();
  });

  test('不正な entity_key セグメントは保存せずエラー表示する', async () => {
    const { panel, onInstanceDeclare } = await openOutcomePanel();
    const key = panel.root.querySelector<HTMLInputElement>('#verify-outcome-key');
    key!.value = 'bad:key';
    key!.dispatchEvent(new Event('change'));
    panel.root.querySelector<HTMLButtonElement>('#verify-outcome-add-button')?.click();
    expect(onInstanceDeclare).not.toHaveBeenCalled();
    expect(panel.root.querySelector('#verify-outcome-error')?.textContent).toContain('entity_key');
    panel.dispose();
  });

  test('空のアウトカムキーは保存せずエラー表示する', async () => {
    const { panel, onInstanceDeclare } = await openOutcomePanel();
    const key = panel.root.querySelector<HTMLInputElement>('#verify-outcome-key');
    key!.value = '   ';
    key!.dispatchEvent(new Event('change'));
    panel.root.querySelector<HTMLButtonElement>('#verify-outcome-add-button')?.click();
    expect(onInstanceDeclare).not.toHaveBeenCalled();
    expect(panel.root.querySelector('#verify-outcome-error')?.textContent).toContain(
      'アウトカムキー',
    );
    panel.dispose();
  });
});

describe('独立入力モード（design §5.2。annotatorType = human_independent の panelMode）', () => {
  test('Evidence quote・AI 値・ハイライトを描画せず、代わりに抽出指示を出す（evidence があっても隠す）', async () => {
    const { panel } = await createPanel({ annotatorType: 'human_independent' });
    // evidence は既定（EVIDENCE）のままだが、mode ゲートにより一切表示されない（防御的な検証）
    expect(panel.root.querySelector('.verify__quote')).toBeNull();
    expect(panel.root.querySelector('.verify__ai')).toBeNull();
    expect(panel.root.querySelector('.verify__ai--none')).toBeNull();
    expect(cellEl(panel.root, KEY_TOTAL)?.querySelector('.verify__instruction')?.textContent).toBe(
      '総 N を抽出',
    );
    expect(panel.root.querySelectorAll('.pdf-viewer__hl')).toHaveLength(0);
    panel.dispose();
  });

  test('操作は入力 (e) / 未報告 (n) / 戻す (z) の 3 つのみで、承認・棄却ボタンは出さない', async () => {
    const { panel } = await createPanel({ annotatorType: 'human_independent' });
    const actions = [
      ...(cellEl(panel.root, KEY_TOTAL)?.querySelectorAll<HTMLButtonElement>('.verify__action') ?? []),
    ];
    expect(actions.map((button) => button.textContent)).toEqual(['入力 (e)', '未報告 (n)', '戻す (z)']);
    expect(cellEl(panel.root, KEY_TOTAL)?.querySelector('.verify__action--accept')).toBeNull();
    expect(cellEl(panel.root, KEY_TOTAL)?.querySelector('.verify__action--reject')).toBeNull();
    panel.dispose();
  });

  test('キーボード a / x は無効化され、判定も編集開始も起きない（e / n / z は従来どおり）', async () => {
    const { panel, onDecision } = await createPanel({ annotatorType: 'human_independent' });
    pressKey('a');
    expect(onDecision).not.toHaveBeenCalled();
    pressKey('x');
    expect(panel.root.querySelector('.verify__editor')).toBeNull();
    panel.dispose();
  });

  test('入力 (e) は AI 値を初期値にせず空欄から始まり、確定で human_independent の Decision を書く', async () => {
    const { panel, onDecision } = await createPanel({ annotatorType: 'human_independent' });
    cellEl(panel.root, KEY_TOTAL)
      ?.querySelector<HTMLButtonElement>('.verify__action--edit')
      ?.click();
    const input = panel.root.querySelector<HTMLInputElement>('.verify__edit-input');
    // 既定の EVIDENCE は f-total に AI 値 '12' を持つが、独立入力モードでは初期値へ流用しない
    expect(input?.value).toBe('');
    expect(panel.root.querySelector('.verify__edit-confirm')?.textContent).toBe('入力して確定');
    input!.value = '42';
    panel.root.querySelector<HTMLButtonElement>('.verify__edit-confirm')?.click();
    expect(onDecision).toHaveBeenCalledWith(
      expect.objectContaining({ annotatorType: 'human_independent', action: 'edit', value: '42' }),
    );
    panel.dispose();
  });

  test('未報告 (n) で human_independent の Decision を書く', async () => {
    const { panel, onDecision } = await createPanel({ annotatorType: 'human_independent' });
    cellEl(panel.root, KEY_TOTAL)
      ?.querySelector<HTMLButtonElement>('.verify__action--not-reported')
      ?.click();
    expect(onDecision).toHaveBeenCalledWith(
      expect.objectContaining({ annotatorType: 'human_independent', action: 'not_reported' }),
    );
    panel.dispose();
  });

  test('群構成カードは AI ドラフトではなく空行から始まり、独立モード向けの案内文言になる（design §5.3）', async () => {
    const { panel } = await createPanel({
      annotatorType: 'human_independent',
      fields: FIELDS,
      evidence: [],
      armStructure: null,
    });
    const card = panel.root.querySelector('#verify-arm-card');
    expect(card?.querySelector('.verify__arm-lead')?.textContent).toContain(
      '群を追加して名称・数を自分で確定します',
    );
    expect(card?.querySelectorAll('.verify__arm-row')).toHaveLength(0);
    panel.dispose();
  });
});

describe('createVerificationPanel: フォーカスモード（issue #38）', () => {
  // study タブ: section ごとに 1 ユニット・列は固定 1 つ。ユニット送り（Shift+J/K）・
  // ユニットをまたぐ自動遷移・z の直近判定ターゲットの検証に使う（arm 確認が不要で単純）
  const STUDY_UNIT_FIELDS = [
    makeField({
      fieldId: 'f-sec1',
      fieldIndex: 1,
      section: 'sec1',
      fieldName: 'sec1_value',
      fieldLabel: 'セクション1値',
    }),
    makeField({
      fieldId: 'f-sec2',
      fieldIndex: 2,
      section: 'sec2',
      fieldName: 'sec2_value',
      fieldLabel: 'セクション2値',
    }),
  ];
  const STUDY_UNIT_EVIDENCE = [
    makeEvidence({ evidenceId: 'ev-sec1', fieldId: 'f-sec1', entityKey: '-', value: 'A1', quote: null }),
    makeEvidence({ evidenceId: 'ev-sec2', fieldId: 'f-sec2', entityKey: '-', value: 'B1', quote: null }),
  ];

  // outcome_result タブ: 1 ユニット（pain）× 2 フィールド行 × 2 群列。行・列移動（j/k・h/l）の検証に使う
  const OUTCOME_UNIT_FIELDS = [
    makeField({
      fieldId: 'f-mean',
      fieldIndex: 1,
      section: 'outcomes',
      fieldName: 'outcome_mean',
      fieldLabel: '平均値',
      entityLevel: 'outcome_result',
    }),
    makeField({
      fieldId: 'f-sd',
      fieldIndex: 2,
      section: 'outcomes',
      fieldName: 'outcome_sd',
      fieldLabel: 'SD',
      entityLevel: 'outcome_result',
    }),
  ];
  const OUTCOME_UNIT_EVIDENCE = [
    makeEvidence({ evidenceId: 'ev-mean-1', fieldId: 'f-mean', entityKey: 'outcome:pain|arm:1', value: '5.2', quote: null }),
    makeEvidence({ evidenceId: 'ev-sd-1', fieldId: 'f-sd', entityKey: 'outcome:pain|arm:1', value: '1.1', quote: null }),
    makeEvidence({ evidenceId: 'ev-mean-2', fieldId: 'f-mean', entityKey: 'outcome:pain|arm:2', value: '4.0', quote: null }),
    makeEvidence({ evidenceId: 'ev-sd-2', fieldId: 'f-sd', entityKey: 'outcome:pain|arm:2', value: '1.0', quote: null }),
  ];
  const TWO_ARMS = {
    version: 1,
    arms: [
      { armKey: 'arm:1', armName: '介入群' },
      { armKey: 'arm:2', armName: '対照群' },
    ],
  };

  // study タブ（セルあり）+ outcome_result タブ（Evidence も宣言も無いため 0 セル）
  const WITH_EMPTY_TAB_FIELDS = [
    makeField({ fieldId: 'f-x', fieldIndex: 1, section: 'x', fieldName: 'x_value', fieldLabel: 'X' }),
    makeField({
      fieldId: 'f-out',
      fieldIndex: 2,
      section: 'outcomes',
      fieldName: 'outcome_val',
      fieldLabel: 'アウトカム値',
      entityLevel: 'outcome_result',
    }),
  ];
  const WITH_EMPTY_TAB_EVIDENCE = [
    makeEvidence({ evidenceId: 'ev-x', fieldId: 'f-x', entityKey: '-', value: 'v', quote: null }),
  ];

  test('layoutMode 未指定時の既定はフォーカス（コンポーネントレベルの既定値）', async () => {
    const panel = createVerificationPanel({ data: makeData(), onDecision: jest.fn(), now: () => 't1', renderPage });
    document.body.replaceChildren(panel.root);
    await flush();
    expect(panel.root.querySelector('#verify-focus-card')).not.toBeNull();
    panel.dispose();
  });

  test('トグルでリストモードへ切替わり、onLayoutModeChange が呼ばれる（パネルは作り直さない）', async () => {
    const onLayoutModeChange = jest.fn();
    const { panel } = await createPanel({}, { layoutMode: 'focus', onLayoutModeChange });
    expect(panel.root.querySelector('#verify-focus-card')).not.toBeNull();
    const toggle = panel.root.querySelector<HTMLButtonElement>('#verify-layout-toggle');
    expect(toggle?.textContent).toBe('リスト表示に切替');
    toggle?.click();
    expect(onLayoutModeChange).toHaveBeenCalledWith('list');
    expect(panel.root.querySelector('#verify-focus-card')).toBeNull();
    expect(panel.root.querySelector('.verify__group')).not.toBeNull();
    // 同一インスタンス（作り直していない）
    expect(document.body.contains(panel.root)).toBe(true);
    panel.dispose();
  });

  describe('study タブ: ユニット送り・自動遷移・直近判定 undo', () => {
    async function createStudyPanel() {
      return createPanel(
        { fields: STUDY_UNIT_FIELDS, evidence: STUDY_UNIT_EVIDENCE, armStructure: null },
        { layoutMode: 'focus' },
      );
    }

    test('初期フォーカスは最初の未判定ユニットの最初の未判定セル', async () => {
      const { panel } = await createStudyPanel();
      expect(panel.root.querySelector('#verify-focus-position')?.textContent).toBe(
        'ユニット 1 / 2（残り 2）',
      );
      expect(panel.root.querySelector('.focus-card__heading')?.textContent).toBe('sec1');
      panel.dispose();
    });

    test('全セル判定済みで開いた場合、初期フォーカスは先頭ユニットの先頭セル（firstCellKeyOfUnit のフォールバック）', async () => {
      const { panel } = await createPanel(
        {
          fields: STUDY_UNIT_FIELDS,
          evidence: STUDY_UNIT_EVIDENCE,
          armStructure: null,
          decisions: [
            makeDecision({ fieldId: 'f-sec1', value: 'A1' }),
            makeDecision({ fieldId: 'f-sec2', value: 'B1' }),
          ],
        },
        { layoutMode: 'focus' },
      );
      expect(panel.root.querySelector('#verify-focus-position')?.textContent).toBe(
        'ユニット 1 / 2（残り 0）',
      );
      panel.dispose();
    });

    test('Shift+J で判定済みユニットへ移動したときは先頭セルへ着地する（firstCellKeyOfUnit のフォールバック）', async () => {
      const { panel } = await createPanel(
        {
          fields: STUDY_UNIT_FIELDS,
          evidence: STUDY_UNIT_EVIDENCE,
          armStructure: null,
          decisions: [makeDecision({ fieldId: 'f-sec2', value: 'B1' })], // sec2 のみ判定済み
        },
        { layoutMode: 'focus' },
      );
      expect(panel.root.querySelector('#verify-focus-position')?.textContent).toContain('ユニット 1');
      pressKey('J', { shiftKey: true });
      // sec1 はまだ未判定のため「残り」には sec1 の 1 ユニットが数えられる（sec2 自体は判定済み）
      expect(panel.root.querySelector('#verify-focus-position')?.textContent).toBe(
        'ユニット 2 / 2（残り 1）',
      );
      expect(
        panel.root.querySelector('.focus-card__matrix-btn--focused')?.getAttribute('aria-label'),
      ).toContain('B1');
      panel.dispose();
    });

    test('判定でユニットが完了すると次の未判定ユニットの最初の未判定セルへ自動遷移する', async () => {
      const { panel, onDecision } = await createStudyPanel();
      panel.root.querySelector<HTMLButtonElement>('#verify-focus-detail .verify__action--accept')?.click();
      expect(onDecision).toHaveBeenCalledWith(expect.objectContaining({ fieldId: 'f-sec1', action: 'accept' }));
      expect(panel.root.querySelector('#verify-focus-position')?.textContent).toBe(
        'ユニット 2 / 2（残り 1）',
      );
      expect(panel.root.querySelector('.focus-card__heading')?.textContent).toBe('sec2');
      panel.dispose();
    });

    test('z は直近判定セルへ効く（ユニットをまたいでも）。無ければフォーカス中セルへ', async () => {
      const { panel } = await createStudyPanel();
      pressKey('a'); // sec1 を承認 → sec2 へ自動遷移
      expect(panel.root.querySelector('#verify-focus-position')?.textContent).toContain('ユニット 2');
      const bar = panel.root.querySelector('#verify-focus-recent');
      expect(bar?.textContent).toContain('セクション1値');
      pressKey('z'); // 直近判定（sec1）へ戻す。フォーカスも sec1 へ戻る
      expect(panel.root.querySelector('#verify-focus-position')?.textContent).toBe(
        'ユニット 1 / 2（残り 2）',
      );
      expect(panel.root.querySelector('#verify-focus-recent')).toBeNull(); // undo で直近判定は消える
      panel.dispose();
    });

    test('z: 直近判定が無ければフォーカス中セルへの undo（無害）', async () => {
      const { panel, onDecision } = await createStudyPanel();
      pressKey('z');
      expect(onDecision).not.toHaveBeenCalled();
      panel.dispose();
    });

    test('Shift+J / Shift+K は判定状況に関係なくユニットを送り、端では停止する', async () => {
      const { panel } = await createStudyPanel();
      expect(panel.root.querySelector('#verify-focus-position')?.textContent).toContain('ユニット 1');
      pressKey('J', { shiftKey: true });
      expect(panel.root.querySelector('#verify-focus-position')?.textContent).toContain('ユニット 2');
      expect(panel.root.querySelector('.focus-card__heading')?.textContent).toBe('sec2');
      pressKey('J', { shiftKey: true }); // 末尾で停止
      expect(panel.root.querySelector('#verify-focus-position')?.textContent).toContain('ユニット 2');
      pressKey('K', { shiftKey: true });
      expect(panel.root.querySelector('#verify-focus-position')?.textContent).toContain('ユニット 1');
      pressKey('K', { shiftKey: true }); // 先頭で停止
      expect(panel.root.querySelector('#verify-focus-position')?.textContent).toContain('ユニット 1');
      panel.dispose();
    });

    test('Shift+A 等の他の Shift 併用キーは無視する（誤爆防止）', async () => {
      const { panel, onDecision } = await createStudyPanel();
      pressKey('A', { shiftKey: true });
      expect(onDecision).not.toHaveBeenCalled();
      expect(panel.root.querySelector('#verify-focus-position')?.textContent).toContain('ユニット 1');
      panel.dispose();
    });
  });

  describe('outcome_result タブ: ユニット内の行・列移動', () => {
    async function createOutcomePanel() {
      return createPanel(
        { fields: OUTCOME_UNIT_FIELDS, evidence: OUTCOME_UNIT_EVIDENCE, armStructure: TWO_ARMS },
        { layoutMode: 'focus' },
      );
    }

    function matrixButtons(root: HTMLElement): HTMLButtonElement[] {
      return [...root.querySelectorAll<HTMLButtonElement>('.focus-card__matrix-btn')];
    }

    function detailValue(root: HTMLElement): string | null | undefined {
      return root.querySelector('#verify-focus-detail .verify__ai-value')?.textContent;
    }

    test('マトリクスは 2 行 × 2 列。列ヘッダは群名、初期フォーカスは先頭セル（平均値 × 介入群）', async () => {
      const { panel } = await createOutcomePanel();
      const table = panel.root.querySelector('#verify-focus-matrix');
      const colHeaders = [...table!.querySelectorAll('thead th')].map((node) => node.textContent);
      expect(colHeaders).toEqual(['項目', '介入群', '対照群']);
      expect(matrixButtons(panel.root)).toHaveLength(4);
      expect(detailValue(panel.root)).toBe('5.2');
      const focused = panel.root.querySelector('.focus-card__matrix-btn--focused');
      expect(focused?.getAttribute('aria-label')).toBe('平均値 × 介入群: 5.2');
      panel.dispose();
    });

    test('マトリクスセルのクリックでそのセルへフォーカスする', async () => {
      const { panel } = await createOutcomePanel();
      matrixButtons(panel.root)[3]?.click(); // 行1・列1 = SD × 対照群
      expect(detailValue(panel.root)).toBe('1.0');
      expect(
        panel.root.querySelector('.focus-card__matrix-btn--focused')?.getAttribute('aria-label'),
      ).toBe('SD × 対照群: 1.0');
      panel.dispose();
    });

    test('l / ArrowRight は同じ行で列を進め、端で停止する', async () => {
      const { panel } = await createOutcomePanel();
      expect(detailValue(panel.root)).toBe('5.2'); // 平均値 × 介入群
      pressKey('l');
      expect(detailValue(panel.root)).toBe('4.0'); // 平均値 × 対照群
      pressKey('l'); // 端で停止
      expect(detailValue(panel.root)).toBe('4.0');
      pressKey('ArrowRight'); // 同義キーも同じ挙動
      expect(detailValue(panel.root)).toBe('4.0');
      panel.dispose();
    });

    test('h / ArrowLeft は同じ行で列を戻し、端で停止する', async () => {
      const { panel } = await createOutcomePanel();
      pressKey('l');
      expect(detailValue(panel.root)).toBe('4.0');
      pressKey('h');
      expect(detailValue(panel.root)).toBe('5.2');
      pressKey('h'); // 端で停止
      expect(detailValue(panel.root)).toBe('5.2');
      pressKey('ArrowLeft');
      expect(detailValue(panel.root)).toBe('5.2');
      panel.dispose();
    });

    test('j / k は同じ列で行を移動し、端で停止する', async () => {
      const { panel } = await createOutcomePanel();
      expect(detailValue(panel.root)).toBe('5.2'); // 平均値 × 介入群
      pressKey('j');
      expect(detailValue(panel.root)).toBe('1.1'); // SD × 介入群（同じ列）
      pressKey('j'); // 端で停止
      expect(detailValue(panel.root)).toBe('1.1');
      pressKey('k');
      expect(detailValue(panel.root)).toBe('5.2');
      pressKey('k'); // 端で停止
      expect(detailValue(panel.root)).toBe('5.2');
      panel.dispose();
    });

    test('同一ユニット内に次の未判定セルがあれば、ユニットをまたがず自動遷移する', async () => {
      const { panel, onDecision } = await createOutcomePanel();
      expect(detailValue(panel.root)).toBe('5.2'); // 平均値 × 介入群（先頭セル）
      pressKey('a'); // 承認 → 同じユニット内の次の未判定セル（平均値 × 対照群）へ
      expect(onDecision).toHaveBeenCalledWith(expect.objectContaining({ fieldId: 'f-mean', action: 'accept' }));
      expect(panel.root.querySelector('#verify-focus-position')?.textContent).toBe(
        'ユニット 1 / 1（残り 1）',
      );
      expect(detailValue(panel.root)).toBe('4.0');
      panel.dispose();
    });

    test('要約行は unit.summary（連続アウトカムのプリセット認識）を表示する', async () => {
      const { panel } = await createOutcomePanel();
      expect(panel.root.querySelector('.focus-card__summary')).toBeNull(); // outcome_n が無いので認識対象外
      panel.dispose();
    });
  });

  test('対象セルが 0 件のタブへ切替えた直後の j/k/h/l は無害（focusedCellKey が null）', async () => {
    const { panel, onDecision } = await createPanel(
      {
        fields: WITH_EMPTY_TAB_FIELDS,
        evidence: WITH_EMPTY_TAB_EVIDENCE,
        armStructure: { version: 1, arms: [{ armKey: 'arm:1', armName: 'A' }] },
      },
      { layoutMode: 'focus' },
    );
    const outcomeTab = [...panel.root.querySelectorAll<HTMLButtonElement>('.verify__tab')].find(
      (button) => button.textContent === 'アウトカム',
    );
    outcomeTab?.click();
    expect(panel.root.querySelector('.verify__empty')).not.toBeNull();
    expect(panel.root.querySelector('#verify-focus-card')).toBeNull();
    pressKey('j');
    pressKey('k');
    pressKey('h');
    pressKey('l');
    // Shift+J / Shift+K も同様に無害（focusedCellKey が null → currentUnit も null）
    pressKey('J', { shiftKey: true });
    pressKey('K', { shiftKey: true });
    expect(onDecision).not.toHaveBeenCalled();
    panel.dispose();
  });

  test('全ユニットを判定し終えると現在セルに留まる（次の未判定ユニットが無い）', async () => {
    const { panel, onDecision } = await createPanel(
      { fields: STUDY_UNIT_FIELDS, evidence: STUDY_UNIT_EVIDENCE, armStructure: null },
      { layoutMode: 'focus' },
    );
    pressKey('a'); // sec1 承認 → sec2 へ自動遷移
    expect(panel.root.querySelector('#verify-focus-position')?.textContent).toContain('ユニット 2');
    pressKey('a'); // sec2 承認 → 次のユニットが無いので留まる
    expect(onDecision).toHaveBeenCalledTimes(2);
    expect(panel.root.querySelector('#verify-focus-position')?.textContent).toBe(
      'ユニット 2 / 2（残り 0）',
    );
    expect(
      panel.root.querySelector('.focus-card__matrix-btn--focused')?.getAttribute('aria-label'),
    ).toContain('B1');
    panel.dispose();
  });

  test('リストモードでは h / l / ArrowLeft / ArrowRight は無害（フォーカスモード専用キー）', async () => {
    const { panel, onDecision } = await createPanel({}, { layoutMode: 'list' });
    pressKey('h');
    pressKey('l');
    pressKey('ArrowLeft');
    pressKey('ArrowRight');
    expect(onDecision).not.toHaveBeenCalled();
    expect(cellEl(panel.root, KEY_TOTAL)?.classList.contains('verify__cell--focused')).toBe(true);
    panel.dispose();
  });
});

describe('renderCachedVerificationPanel', () => {
  afterEach(() => {
    disposeVerificationPanelCache();
  });

  test('同じ VerificationData 参照なら同一 DOM を返す（判定の楽観状態を維持）', async () => {
    const data = makeData();
    const onDecision = jest.fn();
    const first = renderCachedVerificationPanel({ data, onDecision, now: () => 't', renderPage, layoutMode: 'list' });
    document.body.replaceChildren(first);
    pressKey('a');
    const second = renderCachedVerificationPanel({ data, onDecision, now: () => 't', renderPage, layoutMode: 'list' });
    expect(second).toBe(first);
    expect(chipOf(second, KEY_TOTAL)).toBe('承認');
  });

  test('データが差し替わったら作り直し、古いパネルを破棄する', async () => {
    const onDecision = jest.fn();
    const first = renderCachedVerificationPanel({
      data: makeData(),
      onDecision,
      now: () => 't',
      renderPage,
      layoutMode: 'list',
    });
    const second = renderCachedVerificationPanel({
      data: makeData({ document: makeDocumentRecord({ documentId: 'doc-2' }) }),
      onDecision,
      now: () => 't',
      renderPage,
      layoutMode: 'list',
    });
    expect(second).not.toBe(first);
    // 破棄済みの古いパネルはキー入力に反応しない
    document.body.replaceChildren(first);
    pressKey('a');
    expect(onDecision).not.toHaveBeenCalled();
  });

  test('disposeVerificationPanelCache は空でも安全', async () => {
    disposeVerificationPanelCache();
    disposeVerificationPanelCache();
  });

  test('新規パネル生成直後に初期フォーカスセルを scrollIntoView する', async () => {
    const scrollIntoView = jest.fn();
    (HTMLElement.prototype as unknown as { scrollIntoView: unknown }).scrollIntoView =
      scrollIntoView;
    try {
      const root = renderCachedVerificationPanel({
        data: makeData(),
        onDecision: jest.fn(),
        now: () => 't',
        renderPage,
        layoutMode: 'list',
      });
      document.body.replaceChildren(root);
      await Promise.resolve(); // 接続後の microtask を待つ
      expect(scrollIntoView).toHaveBeenCalled();
    } finally {
      delete (HTMLElement.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  test('新規パネル: 項目のないデータでもスクロール処理は無害（フォーカスセルなし）', async () => {
    const root = renderCachedVerificationPanel({
      data: makeData({ fields: [], evidence: [] }),
      onDecision: jest.fn(),
      now: () => 't',
      renderPage,
      layoutMode: 'list',
    });
    document.body.replaceChildren(root);
    await Promise.resolve();
    expect(root.querySelector('.verify__cell')).toBeNull();
  });
});

describe('focusEntity（?entity= ディープリンクの着地）', () => {
  test('別タブの entity はタブ切替 + 先頭セルへフォーカスする', async () => {
    const { panel } = await createPanel();
    panel.focusEntity('arm:1');
    expect(panel.root.querySelector('.verify__tab--active')?.textContent).toBe('群（arm）');
    expect(cellEl(panel.root, KEY_ARM)?.classList.contains('verify__cell--focused')).toBe(true);
    panel.dispose();
  });

  test('初期フォーカスと同一セル（study の先頭）でも DOM フォーカスを当てる', async () => {
    const { panel } = await createPanel();
    panel.focusEntity('-');
    expect(document.activeElement).toBe(cellEl(panel.root, KEY_TOTAL));
    panel.dispose();
  });

  test('存在しない entity_key は何もしない', async () => {
    const { panel } = await createPanel();
    panel.focusEntity('arm:9');
    expect(panel.root.querySelector('.verify__tab--active')?.textContent).toBe('Study');
    expect(cellEl(panel.root, KEY_TOTAL)?.classList.contains('verify__cell--focused')).toBe(true);
    panel.dispose();
  });

  test('群構成未確定でロック中のタブに属する entity は無視する', async () => {
    const { panel } = await createPanel({ armStructure: null });
    panel.focusEntity('arm:1');
    expect(panel.root.querySelector('.verify__tab--active')?.textContent).toBe('Study');
    panel.dispose();
  });

  test('フォーカスモードでも動く: 該当タブへ切替え、そのユニットの該当セルへフォーカスする（issue #38）', async () => {
    const { panel } = await createPanel({}, { layoutMode: 'focus' });
    panel.focusEntity('arm:1');
    expect(panel.root.querySelector('.verify__tab--active')?.textContent).toBe('群（arm）');
    expect(panel.root.querySelector('#verify-focus-card')).not.toBeNull();
    expect(
      panel.root.querySelector('.focus-card__matrix-btn--focused')?.getAttribute('aria-label'),
    ).toContain('50');
    panel.dispose();
  });
});

describe('renderCachedVerificationPanel: focusEntityKey（?entity= ディープリンク）', () => {
  afterEach(() => {
    disposeVerificationPanelCache();
  });

  const flushMicrotasks = (): Promise<void> => Promise.resolve();

  function studyTab(root: HTMLElement): HTMLButtonElement | undefined {
    return [...root.querySelectorAll<HTMLButtonElement>('.verify__tab')].find(
      (button) => button.textContent === 'Study',
    );
  }

  test('focusEntityKey は DOM 接続後（microtask）に適用される', async () => {
    const data = makeData();
    const root = renderCachedVerificationPanel({
      data,
      onDecision: jest.fn(),
      now: () => 't',
      renderPage,
      layoutMode: 'list',
      focusEntityKey: 'arm:1',
    });
    document.body.replaceChildren(root);
    expect(root.querySelector('.verify__tab--active')?.textContent).toBe('Study'); // 適用前
    await flushMicrotasks();
    expect(root.querySelector('.verify__tab--active')?.textContent).toBe('群（arm）');
    expect(cellEl(root, KEY_ARM)?.classList.contains('verify__cell--focused')).toBe(true);
  });

  test('同じ focusEntityKey の再描画ではフォーカスを奪い直さない', async () => {
    const data = makeData();
    const options = {
      data,
      onDecision: jest.fn(),
      now: () => 't',
      renderPage,
      layoutMode: 'list' as const,
      focusEntityKey: 'arm:1',
    };
    const root = renderCachedVerificationPanel(options);
    document.body.replaceChildren(root);
    await flushMicrotasks();
    studyTab(root)?.click(); // ユーザーが Study タブへ戻る
    expect(root.querySelector('.verify__tab--active')?.textContent).toBe('Study');
    renderCachedVerificationPanel(options); // ストア再描画相当
    await flushMicrotasks();
    expect(root.querySelector('.verify__tab--active')?.textContent).toBe('Study');
  });

  test('null へ戻すとリセットされ、再指定で再適用される', async () => {
    const data = makeData();
    const base = { data, onDecision: jest.fn(), now: () => 't', renderPage, layoutMode: 'list' as const };
    const root = renderCachedVerificationPanel({ ...base, focusEntityKey: 'arm:1' });
    document.body.replaceChildren(root);
    await flushMicrotasks();
    studyTab(root)?.click();
    renderCachedVerificationPanel({ ...base, focusEntityKey: null });
    await flushMicrotasks();
    expect(root.querySelector('.verify__tab--active')?.textContent).toBe('Study');
    renderCachedVerificationPanel({ ...base, focusEntityKey: 'arm:1' });
    await flushMicrotasks();
    expect(root.querySelector('.verify__tab--active')?.textContent).toBe('群（arm）');
  });

  test('適用前にデータが差し替わったら古いパネルへは適用しない', async () => {
    const first = renderCachedVerificationPanel({
      data: makeData(),
      onDecision: jest.fn(),
      now: () => 't',
      renderPage,
      layoutMode: 'list',
      focusEntityKey: 'arm:1',
    });
    const second = renderCachedVerificationPanel({
      data: makeData({ document: makeDocumentRecord({ documentId: 'doc-2' }) }),
      onDecision: jest.fn(),
      now: () => 't',
      renderPage,
      layoutMode: 'list',
    });
    document.body.replaceChildren(second);
    await flushMicrotasks();
    expect(first.querySelector('.verify__tab--active')?.textContent).toBe('Study');
    expect(second.querySelector('.verify__tab--active')?.textContent).toBe('Study');
  });
});
