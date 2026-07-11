// loadDocumentPageImages（pdf_native 抽出のページ画像ローダ）の単体テスト
// - 正常系: Drive バイナリ取得 → pdfjs → canvas 描画 → toDataURL → base64 抽出（複数ページ）
// - PDF は全ページ処理後に必ず destroy する（finally）
// - 未知の document_id は throw（loadDocumentPages と同じ文言トーン）
// - deps.loadPdf 省略時は既定の loadDisposablePdf（lib/pdf/loadPdf）を使う
import type { DocumentRecord } from '../../../../src/domain/document';
import {
  PAGE_IMAGE_RENDER_SCALE,
  makeLoadDocumentPageImages,
} from '../../../../src/features/documents/loadDocumentPageImages';
import type { DisposablePdf } from '../../../../src/lib/pdf/loadPdf';
import type { RenderablePdfPage } from '../../../../src/lib/pdf/renderPage';

jest.mock('../../../../src/lib/pdf/loadPdf', () => ({
  loadDisposablePdf: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires -- jest.mock 後に読み込む必要がある
import { loadDisposablePdf } from '../../../../src/lib/pdf/loadPdf';

const mockedLoadDisposablePdf = loadDisposablePdf as jest.MockedFunction<typeof loadDisposablePdf>;

function makeDocument(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    documentId: 'doc-1',
    studyId: 'study-1',
    documentRole: 'article',
    driveFileId: 'drive-1',
    sourceFileId: 'src-1',
    filename: 'scan.pdf',
    pmid: null,
    doi: null,
    textRef: null,
    textStatus: 'no_text_layer',
    pageCount: 2,
    charCount: null,
    importedAt: 't1',
    importedBy: 'me',
    note: null,
    ...overrides,
  };
}

function makeGoogle(binary: ArrayBuffer): { fetch: jest.Mock; getAccessToken: jest.Mock } {
  return {
    fetch: jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => binary,
      text: async () => '',
    } as unknown as Response),
    getAccessToken: jest.fn().mockResolvedValue('token'),
  };
}

function makeFakePage(): RenderablePdfPage {
  return {
    getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 200 * scale }),
    render: () => ({ promise: Promise.resolve(), cancel: jest.fn() }),
  };
}

function makeFakePdf(pageCount: number): {
  fake: DisposablePdf;
  getPage: jest.Mock;
  destroy: jest.Mock;
} {
  const destroy = jest.fn().mockResolvedValue(undefined);
  const getPage = jest.fn().mockImplementation(async () => makeFakePage());
  const fake = { numPages: pageCount, getPage, destroy } as unknown as DisposablePdf;
  return { fake, getPage, destroy };
}

describe('makeLoadDocumentPageImages', () => {
  let toDataURLSpy: jest.SpyInstance;

  beforeEach(() => {
    toDataURLSpy = jest
      .spyOn(HTMLCanvasElement.prototype, 'toDataURL')
      .mockReturnValue('data:image/png;base64,QUJD');
  });

  afterEach(() => {
    toDataURLSpy.mockRestore();
    jest.clearAllMocks();
  });

  test('Drive からバイナリを取得し、pdfjs でページごとに canvas 描画 → base64 化して返す', async () => {
    const { fake, getPage, destroy } = makeFakePdf(2);
    const binary = new ArrayBuffer(8);
    const google = makeGoogle(binary);
    const load = makeLoadDocumentPageImages([makeDocument()], google, {
      loadPdf: jest.fn().mockResolvedValue(fake),
    });

    const images = await load('doc-1');

    expect(images).toEqual([
      { page: 1, mimeType: 'image/png', dataBase64: 'QUJD' },
      { page: 2, mimeType: 'image/png', dataBase64: 'QUJD' },
    ]);
    expect(getPage).toHaveBeenNthCalledWith(1, 1);
    expect(getPage).toHaveBeenNthCalledWith(2, 2);
    // devicePixelRatio を固定し、実行環境依存で解像度が変動しないようにする
    expect(toDataURLSpy).toHaveBeenCalledTimes(2);
    expect(toDataURLSpy).toHaveBeenCalledWith('image/png');
    // 全ページ処理後に必ず destroy する
    expect(destroy).toHaveBeenCalledTimes(1);
    const [url] = google.fetch.mock.calls[0] as [string];
    expect(url).toContain('/files/drive-1?alt=media');
  });

  test('canvas は都度新規生成する（ページごとに使い回さない）', async () => {
    const { fake } = makeFakePdf(2);
    const createSpy = jest.spyOn(document, 'createElement');
    const google = makeGoogle(new ArrayBuffer(8));
    const load = makeLoadDocumentPageImages([makeDocument()], google, {
      loadPdf: jest.fn().mockResolvedValue(fake),
    });
    await load('doc-1');
    const canvasCalls = createSpy.mock.calls.filter(([tag]) => tag === 'canvas');
    expect(canvasCalls).toHaveLength(2);
    createSpy.mockRestore();
  });

  test('ページ処理中に例外が起きても destroy を呼ぶ（finally）', async () => {
    const destroy = jest.fn().mockResolvedValue(undefined);
    const getPage = jest.fn().mockRejectedValue(new Error('page 崩壊'));
    const fake = { numPages: 1, getPage, destroy } as unknown as DisposablePdf;
    const google = makeGoogle(new ArrayBuffer(8));
    const load = makeLoadDocumentPageImages([makeDocument()], google, {
      loadPdf: jest.fn().mockResolvedValue(fake),
    });
    await expect(load('doc-1')).rejects.toThrow('page 崩壊');
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  test('未知の document_id は throw する（documents 一覧に見つからない）', async () => {
    const google = makeGoogle(new ArrayBuffer(8));
    const load = makeLoadDocumentPageImages([makeDocument()], google, {
      loadPdf: jest.fn(),
    });
    await expect(load('doc-x')).rejects.toThrow('"doc-x" が documents 一覧に見つかりません');
    expect(google.fetch).not.toHaveBeenCalled();
  });

  test('deps.loadPdf 省略時は既定の loadDisposablePdf（lib/pdf/loadPdf）を使う', async () => {
    const { fake, destroy } = makeFakePdf(1);
    mockedLoadDisposablePdf.mockResolvedValue(fake);
    const google = makeGoogle(new ArrayBuffer(8));
    const load = makeLoadDocumentPageImages([makeDocument()], google);
    const images = await load('doc-1');
    expect(mockedLoadDisposablePdf).toHaveBeenCalledTimes(1);
    expect(images).toHaveLength(1);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  test('PAGE_IMAGE_RENDER_SCALE はスパイク実測と同値の 2.0', () => {
    expect(PAGE_IMAGE_RENDER_SCALE).toBe(2.0);
  });
});
