import { disposeAdjudicatePdfPaneCache, renderAdjudicatePdfPane } from '../../../../src/app/views/adjudicatePdfPane';
import type { AdjudicateWorking } from '../../../../src/app/store';
import type { DocumentRecord } from '../../../../src/domain/document';
import type { SchemaField } from '../../../../src/domain/schemaField';
import type { StudyRecord } from '../../../../src/domain/study';
import type { LoadedPdfView } from '../../../../src/features/verification/pdfViewCache';
import type { PdfViewerDocument, RenderablePdfPage } from '../../../../src/lib/pdf/renderPage';

function makePdfDocument(): PdfViewerDocument {
  const page: RenderablePdfPage = {
    getViewport: ({ scale }) => ({ width: 612 * scale, height: 792 * scale }),
    render: () => ({ promise: Promise.resolve() }),
  };
  return { numPages: 1, getPage: jest.fn().mockResolvedValue(page) };
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
