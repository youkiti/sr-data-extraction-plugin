import {
  createPdfViewCache,
  PDF_CACHE_SIZE,
  type PdfViewCacheDeps,
} from '../../../../src/features/verification/pdfViewCache';
import { getFileBinary } from '../../../../src/lib/google/drive';
import type { DisposablePdfDocument } from '../../../../src/features/documents/extractTextLayer';

jest.mock('../../../../src/lib/google/drive', () => ({
  getFileBinary: jest.fn(),
}));

const getFileBinaryMock = getFileBinary as jest.MockedFunction<typeof getFileBinary>;

function makePdf(overrides: Partial<DisposablePdfDocument> = {}): DisposablePdfDocument {
  return {
    numPages: 1,
    getPage: jest.fn().mockResolvedValue({
      getViewport: () => ({ width: 612, height: 792 }),
      getTextContent: async () => ({ items: [] }),
      cleanup: jest.fn(),
    }),
    destroy: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeDeps(overrides: Partial<PdfViewCacheDeps> = {}): PdfViewCacheDeps {
  return {
    google: { fetch: jest.fn(), getAccessToken: jest.fn() },
    loadPdf: jest.fn().mockResolvedValue(makePdf()),
    ...overrides,
  };
}

beforeEach(() => {
  getFileBinaryMock.mockResolvedValue(new ArrayBuffer(8));
});

describe('createPdfViewCache: load', () => {
  test('未読込の documentId は Drive → loadPdf → テキスト層抽出まで行い、キャッシュする', async () => {
    const pdf = makePdf();
    const deps = makeDeps({ loadPdf: jest.fn().mockResolvedValue(pdf) });
    const cache = createPdfViewCache(deps);
    const view = await cache.load('doc-1', 'drive-1');
    expect(getFileBinaryMock).toHaveBeenCalledWith('drive-1', deps.google);
    expect(view.pdf).not.toBeNull();
    expect(view.pdfError).toBeNull();
    expect(view.textPages).toHaveLength(1);
  });

  test('2 回目の呼び出しはキャッシュを返し、Drive を再度読まない', async () => {
    const deps = makeDeps();
    const cache = createPdfViewCache(deps);
    const first = await cache.load('doc-1', 'drive-1');
    const second = await cache.load('doc-1', 'drive-1');
    expect(second).toBe(first);
    expect(getFileBinaryMock).toHaveBeenCalledTimes(1);
  });

  test('読込中の同じ documentId への同時呼び出しは in-flight を共有する（重複排除）', async () => {
    let resolveBinary: (value: ArrayBuffer) => void = () => undefined;
    getFileBinaryMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveBinary = resolve;
        }),
    );
    const deps = makeDeps();
    const cache = createPdfViewCache(deps);
    const p1 = cache.load('doc-1', 'drive-1');
    const p2 = cache.load('doc-1', 'drive-1');
    resolveBinary(new ArrayBuffer(8));
    const [v1, v2] = await Promise.all([p1, p2]);
    expect(v1).toBe(v2);
    expect(getFileBinaryMock).toHaveBeenCalledTimes(1);
  });

  test('読込失敗は pdfError を持つ結果を返し、throw しない（キャッシュにも残る）', async () => {
    getFileBinaryMock.mockRejectedValue(new Error('404 not found'));
    const cache = createPdfViewCache(makeDeps());
    const view = await cache.load('doc-1', 'drive-1');
    expect(view.pdf).toBeNull();
    expect(view.pdfError).toBe('404 not found');
    expect(view.textPages).toEqual([]);
    // 失敗結果もキャッシュされ、再訪問では再フェッチしない
    const again = await cache.load('doc-1', 'drive-1');
    expect(again).toBe(view);
    expect(getFileBinaryMock).toHaveBeenCalledTimes(1);
  });

  test('Error 以外の throw も文字列化する', async () => {
    getFileBinaryMock.mockRejectedValue('壊れた応答');
    const cache = createPdfViewCache(makeDeps());
    const view = await cache.load('doc-1', 'drive-1');
    expect(view.pdfError).toBe('壊れた応答');
  });

  test(`直近 ${PDF_CACHE_SIZE} 件だけを保持し、あふれた分は destroy される`, async () => {
    const pdfs = new Map<string, ReturnType<typeof makePdf>>();
    const deps = makeDeps({
      loadPdf: jest.fn().mockImplementation(async () => {
        const pdf = makePdf();
        return pdf;
      }),
    });
    // documentId ごとに異なる pdf インスタンスを作るため loadPdf を documentId 非依存にせず、
    // getFileBinary の戻り値で見分けられるようにする
    getFileBinaryMock.mockImplementation(async (fileId: string) => {
      const buf = new ArrayBuffer(8);
      (buf as unknown as { __fileId?: string }).__fileId = fileId;
      return buf;
    });
    (deps.loadPdf as jest.Mock).mockImplementation(async (buf: ArrayBuffer) => {
      const fileId = (buf as unknown as { __fileId?: string }).__fileId as string;
      const pdf = makePdf();
      pdfs.set(fileId, pdf);
      return pdf;
    });
    const cache = createPdfViewCache(deps);
    await cache.load('doc-1', 'drive-1');
    await cache.load('doc-2', 'drive-2');
    await cache.load('doc-3', 'drive-3');
    await cache.load('doc-4', 'drive-4'); // 4 件目 → doc-1（最も長く触れていない）が破棄される

    expect(pdfs.get('drive-1')?.destroy).toHaveBeenCalledTimes(1);
    expect(pdfs.get('drive-2')?.destroy).not.toHaveBeenCalled();
    expect(pdfs.get('drive-3')?.destroy).not.toHaveBeenCalled();
    expect(pdfs.get('drive-4')?.destroy).not.toHaveBeenCalled();

    // doc-1 は破棄済みなので再訪問すると再フェッチされる
    await cache.load('doc-1', 'drive-1');
    expect(getFileBinaryMock).toHaveBeenCalledTimes(5);
  });

  test('直近アクセスした文書は LRU の対象から外れる（touch で末尾へ移動）', async () => {
    const pdfs = new Map<string, ReturnType<typeof makePdf>>();
    getFileBinaryMock.mockImplementation(async (fileId: string) => {
      const buf = new ArrayBuffer(8);
      (buf as unknown as { __fileId?: string }).__fileId = fileId;
      return buf;
    });
    const deps = makeDeps({
      loadPdf: jest.fn().mockImplementation(async (buf: ArrayBuffer) => {
        const fileId = (buf as unknown as { __fileId?: string }).__fileId as string;
        const pdf = makePdf();
        pdfs.set(fileId, pdf);
        return pdf;
      }),
    });
    const cache = createPdfViewCache(deps);
    await cache.load('doc-1', 'drive-1');
    await cache.load('doc-2', 'drive-2');
    await cache.load('doc-3', 'drive-3');
    await cache.load('doc-1', 'drive-1'); // doc-1 を再アクセス → 最新扱いへ
    await cache.load('doc-4', 'drive-4'); // あふれ: 最も長く触れていない doc-2 が破棄される

    expect(pdfs.get('drive-1')?.destroy).not.toHaveBeenCalled();
    expect(pdfs.get('drive-2')?.destroy).toHaveBeenCalledTimes(1);
    expect(pdfs.get('drive-3')?.destroy).not.toHaveBeenCalled();
  });
});

describe('createPdfViewCache: retry', () => {
  test('失敗結果を捨てて再取得する', async () => {
    getFileBinaryMock.mockRejectedValueOnce(new Error('一時的な失敗'));
    const cache = createPdfViewCache(makeDeps());
    const failed = await cache.load('doc-1', 'drive-1');
    expect(failed.pdfError).toBe('一時的な失敗');

    getFileBinaryMock.mockResolvedValueOnce(new ArrayBuffer(8));
    const retried = await cache.retry('doc-1', 'drive-1');
    expect(retried.pdfError).toBeNull();
    expect(retried.pdf).not.toBeNull();
    expect(getFileBinaryMock).toHaveBeenCalledTimes(2);
  });

  test('成功済みキャッシュに対しても再取得を強制できる', async () => {
    const cache = createPdfViewCache(makeDeps());
    await cache.load('doc-1', 'drive-1');
    await cache.retry('doc-1', 'drive-1');
    expect(getFileBinaryMock).toHaveBeenCalledTimes(2);
  });

  test('読込中に retry されたら、その完了を待ってから読み直す', async () => {
    let resolveBinary: (value: ArrayBuffer) => void = () => undefined;
    getFileBinaryMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveBinary = resolve;
        }),
    );
    const cache = createPdfViewCache(makeDeps());
    const inFlight = cache.load('doc-1', 'drive-1');
    const retryPromise = cache.retry('doc-1', 'drive-1');
    resolveBinary(new ArrayBuffer(8));
    await inFlight;
    await retryPromise;
    expect(getFileBinaryMock).toHaveBeenCalledTimes(2);
  });
});

describe('createPdfViewCache: disposeAll', () => {
  test('キャッシュ済みの全 PDF を破棄し、以後は再フェッチが必要になる', async () => {
    const pdf1 = makePdf();
    const pdf2 = makePdf();
    const loadPdf = jest.fn().mockResolvedValueOnce(pdf1).mockResolvedValueOnce(pdf2);
    const cache = createPdfViewCache(makeDeps({ loadPdf }));
    await cache.load('doc-1', 'drive-1');
    await cache.load('doc-2', 'drive-2');
    await cache.disposeAll();
    expect(pdf1.destroy).toHaveBeenCalledTimes(1);
    expect(pdf2.destroy).toHaveBeenCalledTimes(1);
  });

  test('読込中（in-flight）の完了を待ってから破棄する', async () => {
    let resolveBinary: (value: ArrayBuffer) => void = () => undefined;
    getFileBinaryMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveBinary = resolve;
        }),
    );
    const pdf = makePdf();
    const cache = createPdfViewCache(makeDeps({ loadPdf: jest.fn().mockResolvedValue(pdf) }));
    const loadPromise = cache.load('doc-1', 'drive-1');
    const disposePromise = cache.disposeAll();
    resolveBinary(new ArrayBuffer(8));
    await loadPromise;
    await disposePromise;
    expect(pdf.destroy).toHaveBeenCalledTimes(1);
  });

  test('失敗キャッシュ（disposable なし）は destroy を呼ばずに破棄する', async () => {
    getFileBinaryMock.mockRejectedValue(new Error('x'));
    const cache = createPdfViewCache(makeDeps());
    await cache.load('doc-1', 'drive-1');
    await expect(cache.disposeAll()).resolves.toBeUndefined();
  });

  test('空のキャッシュでも安全', async () => {
    const cache = createPdfViewCache(makeDeps());
    await expect(cache.disposeAll()).resolves.toBeUndefined();
  });
});
