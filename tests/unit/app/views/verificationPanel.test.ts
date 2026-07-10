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
import type { StudyRecord } from '../../../../src/domain/study';
import type { TextLayerPage } from '../../../../src/domain/textLayer';
import { cellKeyOf } from '../../../../src/features/verification/cellState';
import type {
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
 * verificationPanel のテスト用データ生成。単一文書を既定とし、単一文書の便宜プロパティ
 * （document / pdf / pdfError / textPages）を渡すと 1 文書ぶんの documents 配列へ畳み込む。
 * 複数文書は documents を直接渡す
 */
interface PanelDataOverrides
  extends Partial<Omit<VerificationData, 'study' | 'documents'>> {
  study?: StudyRecord;
  documents?: readonly VerificationDocumentView[];
  document?: DocumentRecord;
  pdf?: PdfViewerDocument | null;
  pdfError?: string | null;
  textPages?: readonly TextLayerPage[];
}

function makeDocumentView(overrides: Partial<VerificationDocumentView> = {}): VerificationDocumentView {
  return {
    document: makeDocumentRecord(),
    pdf: makePdf(),
    pdfError: null,
    textPages: PAGES,
    ...overrides,
  };
}

function makeData(overrides: PanelDataOverrides = {}): VerificationData {
  const { study, documents, document, pdf, pdfError, textPages, ...rest } = overrides;
  return {
    study: study ?? makeStudy(),
    documents:
      documents ??
      [
        {
          document: document ?? makeDocumentRecord(),
          pdf: pdf === undefined ? makePdf() : pdf,
          pdfError: pdfError ?? null,
          textPages: textPages ?? PAGES,
        },
      ],
    fields: FIELDS,
    evidence: EVIDENCE,
    decisions: [],
    annotator: ME,
    schemaVersion: 1,
    // 既定は確定済み（群構成ゲートの挙動は専用 describe で null にして検証する）
    armStructure: { version: 1, arms: [{ armKey: 'arm:1', armName: '介入群' }] },
    ...rest,
  };
}

const renderPage = () => Promise.resolve({ width: 612, height: 792 });

function createPanel(overrides: PanelDataOverrides = {}, options: Partial<VerificationPanelOptions> = {}) {
  const onDecision = jest.fn();
  const panel = createVerificationPanel({
    data: makeData(overrides),
    onDecision,
    // preload 判定（decidedAt 't0'）より後にソートされる時刻にする（'t-now' は '-' < '0' で 't0' より前になる）
    now: () => 't1',
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

  test('テキスト層なし文献はバナーを出す（テキスト層ありは hidden）', () => {
    const { panel } = createPanel({
      document: makeDocumentRecord({ textStatus: 'no_text_layer' }),
      textPages: [],
    });
    const banner = panel.root.querySelector<HTMLElement>('.verify__banner');
    expect(banner?.hidden).toBe(false);
    expect(banner?.textContent).toContain('テキスト層がないためハイライト検証は使えません');
    panel.dispose();

    // テキスト層ありの文書ではバナー要素は存在するが hidden
    const ok = createPanel();
    expect(ok.panel.root.querySelector<HTMLElement>('.verify__banner')?.hidden).toBe(true);
    ok.panel.dispose();
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

describe('createVerificationPanel: 複数文書ビューア（v0.10 フェーズ 3）', () => {
  const DOC2_PAGES = [buildPage(1, 'registration enrolled 200 participants total')];

  function doc2View(overrides: Partial<VerificationDocumentView> = {}): VerificationDocumentView {
    return makeDocumentView({
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

  function makeTwoDocPanel(overrides: PanelDataOverrides = {}) {
    const panel = createVerificationPanel({
      data: makeData({
        documents: [makeDocumentView(), doc2View()],
        fields: studyFields(),
        evidence: twoDocEvidence(),
        armStructure: null,
        ...overrides,
      }),
      onDecision: jest.fn(),
      now: () => 't1',
      renderPage,
    });
    document.body.replaceChildren(panel.root);
    return panel;
  }

  function docTabs(root: HTMLElement): HTMLButtonElement[] {
    return [...root.querySelectorAll<HTMLButtonElement>('.verify__doc-tabs .verify__doc-tab')];
  }

  test('2 文書は role バッジ + ファイル名の切替タブを出し、先頭が active', () => {
    const panel = makeTwoDocPanel();
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

  test('タブクリックで表示文書を切替える（active クラスが移動）', () => {
    const panel = makeTwoDocPanel();
    const tabs = docTabs(panel.root);
    tabs[1]?.click();
    expect(tabs[1]?.classList.contains('verify__doc-tab--active')).toBe(true);
    expect(tabs[0]?.classList.contains('verify__doc-tab--active')).toBe(false);
    panel.dispose();
  });

  test('別文書由来のセルへフォーカスすると出所 PDF へ自動切替する', () => {
    const panel = makeTwoDocPanel();
    const tabs = docTabs(panel.root);
    // 初期フォーカスは f-total（doc-1）。f-country（doc-2）へフォーカスすると doc-2 が active に
    const countryCell = cellEl(panel.root, cellKeyOf('f-country', '-'));
    countryCell?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(tabs[1]?.classList.contains('verify__doc-tab--active')).toBe(true);
    panel.dispose();
  });

  test('判定後の自動送りで遷移先が別文書なら PDF も切替える', () => {
    const panel = makeTwoDocPanel();
    const tabs = docTabs(panel.root);
    // f-total（doc-1）を承認 → 次の未判定 f-country（doc-2）へ移り、PDF も doc-2 へ
    cellEl(panel.root, cellKeyOf('f-total', '-'))
      ?.querySelector<HTMLButtonElement>('.verify__action--accept')
      ?.click();
    expect(tabs[1]?.classList.contains('verify__doc-tab--active')).toBe(true);
    panel.dispose();
  });

  test('初期フォーカスセルの出所が先頭以外の文書なら初期表示でその文書を開く', () => {
    // Evidence が doc-2 のみ・初期フォーカス = その項目 → 初期 active は doc-2
    const panel = makeTwoDocPanel({
      fields: [makeField()],
      evidence: [makeEvidence({ documentId: 'doc-2', quote: 'enrolled 200 participants', page: 1 })],
    });
    const tabs = docTabs(panel.root);
    expect(tabs[1]?.classList.contains('verify__doc-tab--active')).toBe(true);
    panel.dispose();
  });

  test('先頭文書の PDF が開けなくてもタブ切替で他文書のビューアを表示できる', () => {
    const panel = makeTwoDocPanel({
      documents: [makeDocumentView({ pdf: null, pdfError: '取得失敗' }), doc2View()],
    });
    // 初期 active（doc-1）は PDF エラーカード
    expect(panel.root.querySelector('.verify__pdf-body .verify__pdf-error')?.textContent).toContain(
      '取得失敗',
    );
    // doc-2 へ切替えるとビューアが出る
    docTabs(panel.root)[1]?.click();
    expect(panel.root.querySelector('.verify__pdf-body .pdf-viewer')).not.toBeNull();
    panel.dispose();
  });

  test('全文書の PDF が開けないときはビューアなしでも判定できる', () => {
    const onDecision = jest.fn();
    const panel = createVerificationPanel({
      data: makeData({
        documents: [
          makeDocumentView({ pdf: null, pdfError: 'x' }),
          doc2View({ pdf: null, pdfError: 'y' }),
        ],
        fields: studyFields(),
        evidence: twoDocEvidence(),
        armStructure: null,
      }),
      onDecision,
      now: () => 't1',
      renderPage,
    });
    document.body.replaceChildren(panel.root);
    expect(panel.root.querySelector('.verify__pdf-body .pdf-viewer')).toBeNull();
    cellEl(panel.root, cellKeyOf('f-total', '-'))
      ?.querySelector<HTMLButtonElement>('.verify__action--accept')
      ?.click();
    expect(onDecision).toHaveBeenCalledTimes(1);
    panel.dispose();
  });
});

describe('左ペイン表示切替（PDF / 抽出テキスト。issue #28 案2）', () => {
  function toggleButtons(root: HTMLElement): { pdf: HTMLButtonElement; text: HTMLButtonElement } {
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('.verify__view-toggle-btn')];
    return { pdf: buttons[0] as HTMLButtonElement, text: buttons[1] as HTMLButtonElement };
  }

  test('既定は PDF モード（抽出テキストは非表示）', () => {
    const { panel } = createPanel();
    const { pdf, text } = toggleButtons(panel.root);
    expect(pdf.getAttribute('aria-pressed')).toBe('true');
    expect(text.getAttribute('aria-pressed')).toBe('false');
    expect(panel.root.querySelector<HTMLElement>('.verify__pdf-body')?.hidden).toBe(false);
    expect(panel.root.querySelector<HTMLElement>('.verify__text-body')?.hidden).toBe(true);
    panel.dispose();
  });

  test('抽出テキストへ切替: 出所文書 / ページ番号 / mark 強調 + 前後文脈を表示する', () => {
    const { panel } = createPanel();
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

  test('PDF ボタンへ戻すと元に戻り、同モードの再クリックは無害', () => {
    const { panel } = createPanel();
    const { pdf, text } = toggleButtons(panel.root);
    text.click();
    pdf.click();
    expect(panel.root.querySelector<HTMLElement>('.verify__pdf-body')?.hidden).toBe(false);
    expect(panel.root.querySelector<HTMLElement>('.verify__text-body')?.hidden).toBe(true);
    pdf.click();
    expect(pdf.getAttribute('aria-pressed')).toBe('true');
    panel.dispose();
  });

  test('AI 抽出なしセル（Evidence なし）へフォーカス中は根拠未選択の案内になる', () => {
    const { panel } = createPanel();
    toggleButtons(panel.root).text.click();
    pressKey('j');
    pressKey('j'); // f-blank（Evidence なし）へ
    expect(panel.root.querySelector('.text-viewer__empty')).not.toBeNull();
    expect(panel.root.querySelector('.text-viewer__doc-label')).toBeNull();
    panel.dispose();
  });

  test('anchor 失敗など再特定不能な quote は quote 全文 + 案内を表示する', () => {
    const { panel } = createPanel();
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

  test('quote の出所文書が study の documents に無い場合は根拠未選択表示になる（データ不整合の防御）', () => {
    const { panel } = createPanel({ evidence: [makeEvidence({ documentId: 'doc-ghost' })] });
    toggleButtons(panel.root).text.click();
    expect(panel.root.querySelector('.text-viewer__empty')).not.toBeNull();
    panel.dispose();
  });

  test('テキスト層がない文書では抽出テキストボタンが無効化 + 案内が出る', () => {
    const { panel } = createPanel({
      document: makeDocumentRecord({ textStatus: 'no_text_layer' }),
      textPages: [],
    });
    const { text } = toggleButtons(panel.root);
    expect(text.disabled).toBe(true);
    expect(text.title).not.toBe('');
    expect(panel.root.querySelector<HTMLElement>('.verify__view-toggle-note')?.hidden).toBe(false);
    panel.dispose();
  });

  test('テキストモード中にテキスト層のない文書へ自動切替すると PDF モードへ戻る', () => {
    const docWithText = makeDocumentView();
    const docNoText = makeDocumentView({
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
    });
    document.body.replaceChildren(panel.root);
    const { pdf, text } = toggleButtons(panel.root);
    text.click(); // doc-1 はテキストあり → テキストモードへ
    expect(text.getAttribute('aria-pressed')).toBe('true');
    // f-country（doc-2・テキストなし）へフォーカス → 出所 PDF へ自動切替 + モードも PDF へ自動で戻る
    pressKey('j');
    expect(pdf.getAttribute('aria-pressed')).toBe('true');
    expect(text.disabled).toBe(true);
    expect(panel.root.querySelector<HTMLElement>('.verify__text-body')?.hidden).toBe(true);
    panel.dispose();
  });

  test('根拠クリック（ハイライトへ移動）は、フォーカスを動かさずスニペットだけ差し替える', () => {
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
    const { panel } = createPanel({
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

  test('f キー（根拠へジャンプ）はテキストモードでは PDF を操作せずスニペットのまま', () => {
    const { panel } = createPanel();
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
  test('承認ボタン: AI 値で accept を確定し、チップとハイライト色が更新される', () => {
    const { panel, onDecision } = createPanel();
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

  test('キーボード: a で次の未判定セルへ自動遷移し、n は遷移先セルに効く', () => {
    const { panel, onDecision } = createPanel();
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

  test('単一セルタブ: 全セル判定済みなら留まり、undo は同じセルで前の値へ戻す', () => {
    const { panel, onDecision } = createPanel();
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

  test('arm Evidence が無くても確定 arm から空セルを作る', () => {
    const { panel, onDecision } = createPanel({
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

  test('タブの手動切替は最初の未判定セルへフォーカスし直す', () => {
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

describe('自動遷移・初期フォーカス・スクロール保持（UX 改善）', () => {
  test('初期フォーカスは最初の未判定セル（判定済みセルをスキップ）', () => {
    const { panel } = createPanel({
      decisions: [makeDecision({ fieldId: 'f-total', value: '12' })], // f-total 承認済み
    });
    expect(cellEl(panel.root, KEY_COUNTRY)?.classList.contains('verify__cell--focused')).toBe(true);
    expect(cellEl(panel.root, KEY_TOTAL)?.classList.contains('verify__cell--focused')).toBe(false);
    panel.dispose();
  });

  test('判定後は判定済みセルをスキップして次の未判定セルへ遷移する', () => {
    const { panel } = createPanel({
      decisions: [makeDecision({ fieldId: 'f-country', value: 'Japan' })], // f-country 承認済み
    });
    // 初期フォーカス = 未判定の先頭 f-total
    expect(cellEl(panel.root, KEY_TOTAL)?.classList.contains('verify__cell--focused')).toBe(true);
    pressKey('a'); // f-total を accept → f-country（判定済み）をスキップして f-blank へ
    expect(cellEl(panel.root, KEY_BLANK)?.classList.contains('verify__cell--focused')).toBe(true);
    panel.dispose();
  });

  test('undo は他に未判定セルがあっても同じセルに留まる（取り消し直後の再判定用）', () => {
    const { panel } = createPanel({
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

  test('refreshForm はスクロール位置を保持する（判定後に先頭へ飛ばない）', () => {
    const { panel } = createPanel();
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

  test('判定後の自動遷移で遷移先セルへ scrollIntoView + フォーカスする', () => {
    const scrollIntoView = jest.fn();
    (HTMLElement.prototype as unknown as { scrollIntoView: unknown }).scrollIntoView =
      scrollIntoView;
    try {
      const { panel } = createPanel();
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
  test('直近判定は元の位置に残り、次の判定で判定済みブロックへ移る', () => {
    const { panel } = createPanel();
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

  test('コンパクト行クリックで展開し、「たたむ」でコンパクトへ戻る', () => {
    const { panel } = createPanel({
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

  test('ハイライトクリックで判定済みセルへ着地すると展開される（同一タブ）', () => {
    const { panel } = createPanel({
      decisions: [makeDecision({ fieldId: 'f-total', value: '12' })],
    });
    // 初期フォーカスは f-country。page 1 の f-total ハイライトをクリック
    panel.root.querySelector<HTMLButtonElement>('.pdf-viewer__hl')?.click();
    const expanded = cellEl(panel.root, KEY_TOTAL);
    expect(expanded?.classList.contains('verify__cell--focused')).toBe(true);
    expect(expanded?.querySelector('.verify__actions')).not.toBeNull();
    panel.dispose();
  });

  test('別タブの判定済みセルへのハイライトクリックはタブ切替 + 展開になる', () => {
    const { panel } = createPanel({
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

  test('undo のフォーカス復元: フォーム内フォーカス時は同じセルへ戻す', () => {
    const { panel, onDecision } = createPanel({
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

  test('undo のフォーカス復元: body にフォーカスがなければ奪わない', () => {
    const { panel, onDecision } = createPanel({
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

  test('rob_domain タブは arm 未確定でもロックされず判定できる（群構成に依存しない）', () => {
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
    const { panel, onDecision } = createPanel({
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

describe('outcome_result インスタンス追加', () => {
  const outcomeField = makeField({
    fieldId: 'f-out-event',
    fieldIndex: 5,
    section: 'outcomes',
    fieldName: 'event_count',
    fieldLabel: 'イベント数',
    entityLevel: 'outcome_result',
  });

  function openOutcomePanel(options: Partial<VerificationPanelOptions> = {}) {
    const onInstanceDeclare = jest.fn();
    const created = createPanel(
      { fields: [...FIELDS, outcomeField] },
      { onInstanceDeclare, ...options },
    );
    [...created.panel.root.querySelectorAll<HTMLButtonElement>('.verify__tab')]
      .find((button) => button.textContent === 'アウトカム')
      ?.click();
    return { ...created, onInstanceDeclare };
  }

  test('アウトカムキーと時点から確定 arm 全体の宣言イベントを作り、空セルを表示する', () => {
    const { panel, onInstanceDeclare } = openOutcomePanel();
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

  test('既存キーとの衝突は保存せずエラー表示する', () => {
    const { panel, onInstanceDeclare } = openOutcomePanel();
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

  test('不正な entity_key セグメントは保存せずエラー表示する', () => {
    const { panel, onInstanceDeclare } = openOutcomePanel();
    const key = panel.root.querySelector<HTMLInputElement>('#verify-outcome-key');
    key!.value = 'bad:key';
    key!.dispatchEvent(new Event('change'));
    panel.root.querySelector<HTMLButtonElement>('#verify-outcome-add-button')?.click();
    expect(onInstanceDeclare).not.toHaveBeenCalled();
    expect(panel.root.querySelector('#verify-outcome-error')?.textContent).toContain('entity_key');
    panel.dispose();
  });

  test('空のアウトカムキーは保存せずエラー表示する', () => {
    const { panel, onInstanceDeclare } = openOutcomePanel();
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
    });
    document.body.replaceChildren(root);
    await Promise.resolve();
    expect(root.querySelector('.verify__cell')).toBeNull();
  });
});

describe('focusEntity（?entity= ディープリンクの着地）', () => {
  test('別タブの entity はタブ切替 + 先頭セルへフォーカスする', () => {
    const { panel } = createPanel();
    panel.focusEntity('arm:1');
    expect(panel.root.querySelector('.verify__tab--active')?.textContent).toBe('群（arm）');
    expect(cellEl(panel.root, KEY_ARM)?.classList.contains('verify__cell--focused')).toBe(true);
    panel.dispose();
  });

  test('初期フォーカスと同一セル（study の先頭）でも DOM フォーカスを当てる', () => {
    const { panel } = createPanel();
    panel.focusEntity('-');
    expect(document.activeElement).toBe(cellEl(panel.root, KEY_TOTAL));
    panel.dispose();
  });

  test('存在しない entity_key は何もしない', () => {
    const { panel } = createPanel();
    panel.focusEntity('arm:9');
    expect(panel.root.querySelector('.verify__tab--active')?.textContent).toBe('Study');
    expect(cellEl(panel.root, KEY_TOTAL)?.classList.contains('verify__cell--focused')).toBe(true);
    panel.dispose();
  });

  test('群構成未確定でロック中のタブに属する entity は無視する', () => {
    const { panel } = createPanel({ armStructure: null });
    panel.focusEntity('arm:1');
    expect(panel.root.querySelector('.verify__tab--active')?.textContent).toBe('Study');
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
    const base = { data, onDecision: jest.fn(), now: () => 't', renderPage };
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
      focusEntityKey: 'arm:1',
    });
    const second = renderCachedVerificationPanel({
      data: makeData({ document: makeDocumentRecord({ documentId: 'doc-2' }) }),
      onDecision: jest.fn(),
      now: () => 't',
      renderPage,
    });
    document.body.replaceChildren(second);
    await flushMicrotasks();
    expect(first.querySelector('.verify__tab--active')?.textContent).toBe('Study');
    expect(second.querySelector('.verify__tab--active')?.textContent).toBe('Study');
  });
});
