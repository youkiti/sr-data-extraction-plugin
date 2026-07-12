import {
  disposeAdjudicatePdfPaneCache,
  focusAdjudicateEvidence,
  renderAdjudicatePdfPane,
} from '../../../../src/app/views/adjudicatePdfPane';
import type { AdjudicateWorking } from '../../../../src/app/store';
import type { DocumentRecord } from '../../../../src/domain/document';
import type { Evidence } from '../../../../src/domain/evidence';
import type { SchemaField } from '../../../../src/domain/schemaField';
import type { StudyRecord } from '../../../../src/domain/study';
import type { TextLayerPage } from '../../../../src/domain/textLayer';
import type { AdjudicationCell } from '../../../../src/features/adjudication/cellMatch';
import { cellKeyOf } from '../../../../src/features/verification/cellState';
import type { LoadedPdfView } from '../../../../src/features/verification/pdfViewCache';
import type { PdfViewerDocument, RenderablePdfPage } from '../../../../src/lib/pdf/renderPage';

function makePdfDocument(): PdfViewerDocument {
  const page: RenderablePdfPage = {
    getViewport: ({ scale }) => ({ width: 612 * scale, height: 792 * scale }),
    render: () => ({ promise: Promise.resolve() }),
  };
  return { numPages: 1, getPage: jest.fn().mockResolvedValue(page) };
}

/** テキスト層つきの 1 ページ（issue #63: Evidence ハイライトのテスト用。verificationPanel.test.ts と同じ構成） */
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
    quote: 'mortality was 12 percent',
    page: 1,
    confidence: 'high',
    anchorStatus: 'exact',
    bboxPage: null,
    bbox: null,
    relocatedFrom: null,
    ...overrides,
  };
}

function makeCell(overrides: Partial<AdjudicationCell> = {}): AdjudicationCell {
  return {
    cellKey: cellKeyOf('f-1', '-'),
    field: makeField(),
    entityKey: '-',
    valueA: '120',
    valueB: '120',
    schemaVersionA: 1,
    schemaVersionB: 1,
    matches: true,
    schemaVersionMismatch: false,
    noteA: null,
    noteB: null,
    ...overrides,
  };
}

function makeDocument(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    documentId: 'doc-1',
    studyId: 'study-1',
    documentRole: 'article',
    driveFileId: 'drive-1',
    sourceFileId: 'src-1',
    filename: 'smith2020.pdf',
    pmid: null,
    doi: null,
    textRef: null,
    textStatus: 'ok',
    pageCount: 1,
    charCount: 100,
    importedAt: 't0',
    importedBy: 'owner@example.com',
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
    createdBy: 'owner@example.com',
    note: null,
    ...overrides,
  };
}

function makeField(overrides: Partial<SchemaField> = {}): SchemaField {
  return {
    schemaVersion: 1,
    fieldId: 'f-1',
    fieldIndex: 1,
    section: 'population',
    fieldName: 'sample_size',
    fieldLabel: '総サンプルサイズ',
    entityLevel: 'study',
    dataType: 'text',
    unit: null,
    allowedValues: null,
    required: false,
    extractionInstruction: '',
    example: null,
    aiGenerated: false,
    note: null,
    ...overrides,
  };
}

function makeWorking(overrides: Partial<AdjudicateWorking> = {}): AdjudicateWorking {
  return {
    study: makeStudy(),
    documents: [makeDocument()],
    annotatorA: 'a@example.com',
    annotatorB: 'b@example.com',
    fields: [makeField()],
    schemaVersion: 1,
    armsA: [],
    armsB: [],
    needsArmConfirmation: false,
    armsMatched: true,
    consensusArmStructure: null,
    armDraft: [],
    cells: [],
    consensusDecisions: [],
    evidence: [],
    skippedCellKeys: [],
    loadPdfView: jest.fn().mockResolvedValue({ pdf: makePdfDocument(), pdfError: null, textPages: [] }),
    retryPdfView: jest.fn().mockResolvedValue({ pdf: makePdfDocument(), pdfError: null, textPages: [] }),
    disposePdf: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

afterEach(() => {
  disposeAdjudicatePdfPaneCache();
});

describe('renderAdjudicatePdfPane', () => {
  test('文書が無ければ案内メッセージを出す', () => {
    const root = renderAdjudicatePdfPane(makeWorking({ documents: [] }));
    expect(root.textContent).toContain('この研究には文書がありません');
  });

  test('文書 1 件はタブを出さず、PDF を読み込んで表示する', async () => {
    const working = makeWorking();
    const root = renderAdjudicatePdfPane(working);
    expect(root.querySelector('.adjudicate__doc-tabs')).toBeNull();
    expect(root.textContent).toContain('PDF を読み込んでいます');
    await flush();
    expect(working.loadPdfView).toHaveBeenCalledWith('doc-1');
    expect(root.querySelector('.pdf-viewer')).not.toBeNull();
  });

  test('文書 2 件以上はタブを出し、切替で該当文書を読み込む', async () => {
    const working = makeWorking({
      documents: [
        makeDocument({ documentId: 'doc-1', filename: 'a.pdf' }),
        makeDocument({ documentId: 'doc-2', filename: 'b.pdf', driveFileId: 'drive-2' }),
      ],
    });
    const root = renderAdjudicatePdfPane(working);
    await flush();
    const tabs = root.querySelectorAll<HTMLButtonElement>('.adjudicate__doc-tab');
    expect(tabs).toHaveLength(2);
    expect(tabs[0]?.className).toContain('adjudicate__doc-tab--active');
    expect(tabs[1]?.className).not.toContain('adjudicate__doc-tab--active');

    tabs[1]?.click();
    // 再クリックした tabsEl は作り直されるので新しい要素集合から取り直す
    const tabsAfter = root.querySelectorAll<HTMLButtonElement>('.adjudicate__doc-tab');
    expect(tabsAfter[1]?.className).toContain('adjudicate__doc-tab--active');
    await flush();
    expect(working.loadPdfView).toHaveBeenCalledWith('doc-2');

    // 同じタブを再クリックしても再読込しない
    (working.loadPdfView as jest.Mock).mockClear();
    tabsAfter[1]?.click();
    expect(working.loadPdfView).not.toHaveBeenCalled();
  });

  test('PDF 読込失敗はエラー表示 + 再試行ボタンで再読込する', async () => {
    const working = makeWorking({
      loadPdfView: jest.fn().mockResolvedValue({ pdf: null, pdfError: '読めません', textPages: [] } as LoadedPdfView),
    });
    const root = renderAdjudicatePdfPane(working);
    await flush();
    expect(root.querySelector('.adjudicate__pdf-error')?.textContent).toContain('読めません');
    const retry = root.querySelector('button') as HTMLButtonElement;
    expect(retry.textContent).toBe('再試行');
    (working.loadPdfView as jest.Mock).mockClear();
    retry.click();
    await flush();
    expect(working.loadPdfView).toHaveBeenCalledWith('doc-1');
  });

  test('pdfError が無い読込失敗（想定外の状態）でも空文字でエラー表示する', async () => {
    const working = makeWorking({
      loadPdfView: jest.fn().mockResolvedValue({ pdf: null, pdfError: null, textPages: [] } as LoadedPdfView),
    });
    const root = renderAdjudicatePdfPane(working);
    await flush();
    expect(root.querySelector('.adjudicate__pdf-error')?.textContent).toBe('PDF を読み込めませんでした: ');
  });

  test('同じ study への再描画は同一インスタンスを返す（PDF ビューアを作り直さない）', () => {
    const working = makeWorking();
    const first = renderAdjudicatePdfPane(working);
    const second = renderAdjudicatePdfPane(working);
    expect(first).toBe(second);
  });

  test('別 study への切替は新しいインスタンスを作る', () => {
    const first = renderAdjudicatePdfPane(makeWorking({ study: makeStudy({ studyId: 'study-1' }) }));
    const second = renderAdjudicatePdfPane(makeWorking({ study: makeStudy({ studyId: 'study-2' }) }));
    expect(first).not.toBe(second);
  });

  test('disposeAdjudicatePdfPaneCache でキャッシュを破棄すると次回は作り直す', () => {
    const working = makeWorking();
    const first = renderAdjudicatePdfPane(working);
    disposeAdjudicatePdfPaneCache();
    const second = renderAdjudicatePdfPane(working);
    expect(first).not.toBe(second);
  });
});

describe('renderAdjudicatePdfPane: Evidence ハイライト（issue #63）', () => {
  const MATCHING_PAGE = buildPage(1, 'intro mortality was 12 percent in total');

  test('AI 根拠（Evidence）が無ければ案内文を出す', () => {
    const root = renderAdjudicatePdfPane(makeWorking({ evidence: [] }));
    expect(root.querySelector('.adjudicate__no-evidence-note')?.textContent).toContain(
      'AI 抽出の根拠（Evidence）がありません',
    );
  });

  test('Evidence があれば案内文を出さない', () => {
    const root = renderAdjudicatePdfPane(
      makeWorking({
        evidence: [makeEvidence()],
        loadPdfView: jest.fn().mockResolvedValue({ pdf: makePdfDocument(), pdfError: null, textPages: [MATCHING_PAGE] }),
      }),
    );
    expect(root.querySelector('.adjudicate__no-evidence-note')).toBeNull();
  });

  test('表示中文書の Evidence を PDF 上にハイライトする（quote 全文検索で一致した矩形）', async () => {
    const working = makeWorking({
      cells: [makeCell()],
      evidence: [makeEvidence({ documentId: 'doc-1' })],
      loadPdfView: jest.fn().mockResolvedValue({ pdf: makePdfDocument(), pdfError: null, textPages: [MATCHING_PAGE] }),
    });
    const root = renderAdjudicatePdfPane(working);
    await flush();
    const hl = root.querySelector<HTMLButtonElement>('.pdf-viewer__hl');
    expect(hl).not.toBeNull();
    expect(hl?.className).toContain('pdf-viewer__hl--unverified');
    expect(hl?.getAttribute('aria-label')).toBe('根拠: 総サンプルサイズ');
  });

  test('working.cells に対応するセルが無い Evidence はラベルに cellKey をそのまま使う（防御）', async () => {
    const working = makeWorking({
      cells: [],
      evidence: [makeEvidence({ documentId: 'doc-1' })],
      loadPdfView: jest.fn().mockResolvedValue({ pdf: makePdfDocument(), pdfError: null, textPages: [MATCHING_PAGE] }),
    });
    const root = renderAdjudicatePdfPane(working);
    await flush();
    const hl = root.querySelector<HTMLButtonElement>('.pdf-viewer__hl');
    expect(hl?.getAttribute('aria-label')).toBe(`根拠: ${cellKeyOf('f-1', '-')}`);
  });

  test('別文書の Evidence は表示中文書のハイライトに含めない', async () => {
    const working = makeWorking({
      documents: [makeDocument({ documentId: 'doc-1' }), makeDocument({ documentId: 'doc-2', driveFileId: 'drive-2' })],
      cells: [makeCell()],
      evidence: [makeEvidence({ documentId: 'doc-2' })], // 表示中は doc-1
      loadPdfView: jest.fn().mockResolvedValue({ pdf: makePdfDocument(), pdfError: null, textPages: [MATCHING_PAGE] }),
    });
    const root = renderAdjudicatePdfPane(working);
    await flush();
    expect(root.querySelector('.pdf-viewer__hl')).toBeNull();
  });

  test('quote が本文に見つからない Evidence はハイライトしない（buildDocumentHighlights の除外規則）', async () => {
    const working = makeWorking({
      cells: [makeCell()],
      evidence: [makeEvidence({ documentId: 'doc-1', quote: '本文に無い文言' })],
      loadPdfView: jest.fn().mockResolvedValue({ pdf: makePdfDocument(), pdfError: null, textPages: [MATCHING_PAGE] }),
    });
    const root = renderAdjudicatePdfPane(working);
    await flush();
    expect(root.querySelector('.pdf-viewer__hl')).toBeNull();
  });
});

describe('focusAdjudicateEvidence（issue #63: セル選択 → 該当文書へ切替 + ハイライトへジャンプ）', () => {
  const MATCHING_PAGE = buildPage(1, 'intro mortality was 12 percent in total');
  const CELL_KEY = cellKeyOf('f-1', '-');

  test('まだ何も描画していない（cached 無し）状態では no-op', () => {
    expect(() => focusAdjudicateEvidence(makeWorking(), CELL_KEY)).not.toThrow();
  });

  test('cellKey に対応する Evidence が無ければ no-op', async () => {
    const working = makeWorking({
      cells: [makeCell()],
      evidence: [],
      loadPdfView: jest.fn().mockResolvedValue({ pdf: makePdfDocument(), pdfError: null, textPages: [MATCHING_PAGE] }),
    });
    const root = renderAdjudicatePdfPane(working);
    await flush();
    expect(() => focusAdjudicateEvidence(working, CELL_KEY)).not.toThrow();
    expect(root.querySelector('.pdf-viewer__hl--active')).toBeNull();
  });

  test('別 study の working で呼んでも no-op（cached が別 study を指している）', async () => {
    const working = makeWorking({
      cells: [makeCell()],
      evidence: [makeEvidence({ documentId: 'doc-1' })],
      loadPdfView: jest.fn().mockResolvedValue({ pdf: makePdfDocument(), pdfError: null, textPages: [MATCHING_PAGE] }),
    });
    renderAdjudicatePdfPane(working);
    await flush();
    const otherStudy = makeWorking({ study: makeStudy({ studyId: 'study-2' }) });
    expect(() => focusAdjudicateEvidence(otherStudy, CELL_KEY)).not.toThrow();
  });

  test('Evidence の出所文書が study 配下に無ければ no-op（データ不整合への防御）', async () => {
    const loadPdfView = jest
      .fn()
      .mockResolvedValue({ pdf: makePdfDocument(), pdfError: null, textPages: [MATCHING_PAGE] });
    const working = makeWorking({
      documents: [makeDocument({ documentId: 'doc-1' }), makeDocument({ documentId: 'doc-2', driveFileId: 'drive-2' })],
      cells: [makeCell()],
      evidence: [makeEvidence({ documentId: 'doc-ghost' })], // study 配下に無い文書 ID（データ不整合）
      loadPdfView,
    });
    const root = renderAdjudicatePdfPane(working);
    await flush();
    loadPdfView.mockClear();
    expect(() => focusAdjudicateEvidence(working, CELL_KEY)).not.toThrow();
    expect(loadPdfView).not.toHaveBeenCalled();
    const tabs = root.querySelectorAll<HTMLButtonElement>('.adjudicate__doc-tab');
    expect(tabs[0]?.className).toContain('adjudicate__doc-tab--active'); // doc-1 のまま
  });

  test('表示中文書内の Evidence へジャンプする（同一文書・ロード済み）', async () => {
    const working = makeWorking({
      cells: [makeCell()],
      evidence: [makeEvidence({ documentId: 'doc-1' })],
      loadPdfView: jest.fn().mockResolvedValue({ pdf: makePdfDocument(), pdfError: null, textPages: [MATCHING_PAGE] }),
    });
    const root = renderAdjudicatePdfPane(working);
    await flush();
    expect(root.querySelector('.pdf-viewer__hl--active')).toBeNull();
    focusAdjudicateEvidence(working, CELL_KEY);
    expect(root.querySelector('.pdf-viewer__hl--active')).not.toBeNull();
  });

  test('ロード中（viewer 未生成）に呼ばれた場合は保留し、ロード解決後に 1 回だけジャンプを適用する', async () => {
    let resolveLoad: (value: LoadedPdfView) => void = () => undefined;
    const working = makeWorking({
      cells: [makeCell()],
      evidence: [makeEvidence({ documentId: 'doc-1' })],
      loadPdfView: jest.fn().mockReturnValue(
        new Promise<LoadedPdfView>((resolve) => {
          resolveLoad = resolve;
        }),
      ),
    });
    const root = renderAdjudicatePdfPane(working);
    // ロード未解決の間に呼ぶ（保留ジャンプとして予約されるはず）
    focusAdjudicateEvidence(working, CELL_KEY);
    resolveLoad({ pdf: makePdfDocument(), pdfError: null, textPages: [MATCHING_PAGE] });
    await flush();
    expect(root.querySelector('.pdf-viewer__hl--active')).not.toBeNull();
  });

  test('別文書の Evidence は該当文書タブへ切替え、ロード後にジャンプを適用する', async () => {
    const loadPdfView = jest
      .fn()
      .mockResolvedValue({ pdf: makePdfDocument(), pdfError: null, textPages: [MATCHING_PAGE] });
    const working = makeWorking({
      documents: [makeDocument({ documentId: 'doc-1' }), makeDocument({ documentId: 'doc-2', driveFileId: 'drive-2' })],
      cells: [makeCell()],
      evidence: [makeEvidence({ documentId: 'doc-2' })],
      loadPdfView,
    });
    const root = renderAdjudicatePdfPane(working);
    await flush();
    loadPdfView.mockClear();
    focusAdjudicateEvidence(working, CELL_KEY);
    const tabsAfter = root.querySelectorAll<HTMLButtonElement>('.adjudicate__doc-tab');
    expect(tabsAfter[1]?.className).toContain('adjudicate__doc-tab--active');
    expect(loadPdfView).toHaveBeenCalledWith('doc-2');
    await flush();
    expect(root.querySelector('.pdf-viewer__hl--active')).not.toBeNull();
  });

  test('同じ文書への再選択は no-op（既に表示中）', async () => {
    const working = makeWorking({
      cells: [makeCell()],
      evidence: [makeEvidence({ documentId: 'doc-1' })],
      loadPdfView: jest.fn().mockResolvedValue({ pdf: makePdfDocument(), pdfError: null, textPages: [MATCHING_PAGE] }),
    });
    const root = renderAdjudicatePdfPane(working);
    await flush();
    focusAdjudicateEvidence(working, CELL_KEY);
    focusAdjudicateEvidence(working, CELL_KEY); // 2 回目も安全に呼べる
    expect(root.querySelector('.pdf-viewer__hl--active')).not.toBeNull();
  });
});
