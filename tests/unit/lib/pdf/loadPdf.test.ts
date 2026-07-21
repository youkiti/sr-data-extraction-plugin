import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import {
  PDF_CMAP_DIR,
  PDF_ICC_DIR,
  PDF_STANDARD_FONT_DIR,
  PDF_WASM_DIR,
  PDF_WORKER_ASSET,
  configurePdfWorker,
  loadDisposablePdf,
  loadPdf,
} from '../../../../src/lib/pdf/loadPdf';

jest.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: jest.fn(),
}));

const mockedGetDocument = jest.mocked(getDocument);

beforeEach(() => {
  GlobalWorkerOptions.workerSrc = '';
});

describe('configurePdfWorker', () => {
  test('未設定なら chrome.runtime.getURL で worker を解決する（同梱・CDN 不可）', () => {
    configurePdfWorker();
    expect(GlobalWorkerOptions.workerSrc).toBe(
      `chrome-extension://test-extension-id/${PDF_WORKER_ASSET}`,
    );
  });

  test('設定済みなら上書きしない（E2E の chrome スタブ差し替えを壊さない）', () => {
    GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
    configurePdfWorker();
    expect(GlobalWorkerOptions.workerSrc).toBe('/pdf.worker.min.mjs');
  });
});

describe('loadPdf', () => {
  test('worker を設定し、バイト列を Uint8Array にして getDocument へ渡す', async () => {
    const doc = { numPages: 3 };
    mockedGetDocument.mockReturnValue({
      promise: Promise.resolve(doc),
    } as unknown as ReturnType<typeof getDocument>);

    const data = new Uint8Array([1, 2, 3]).buffer;
    await expect(loadPdf(data)).resolves.toBe(doc);
    expect(GlobalWorkerOptions.workerSrc).toContain(PDF_WORKER_ASSET);
    const arg = mockedGetDocument.mock.calls[0]?.[0] as {
      data: Uint8Array;
      cMapUrl: string;
      cMapPacked: boolean;
      wasmUrl: string;
      standardFontDataUrl: string;
      iccUrl: string;
      useWorkerFetch: boolean;
    };
    expect(arg.data).toBeInstanceOf(Uint8Array);
    expect([...arg.data]).toEqual([1, 2, 3]);
    // 和文 PDF の CID フォント抽出用に、同梱 CMap を拡張内 URL で渡す（issue #95）
    expect(arg.cMapUrl).toBe(`chrome-extension://test-extension-id/${PDF_CMAP_DIR}`);
    expect(arg.cMapPacked).toBe(true);
    // 画像デコーダ（CCITTFax/JBIG2 等）の wasm 資産・標準フォント・ICC プロファイルも
    // 同梱ディレクトリを拡張内 URL で渡す（未指定だとスキャン PDF が白紙になる）
    expect(arg.wasmUrl).toBe(`chrome-extension://test-extension-id/${PDF_WASM_DIR}`);
    expect(arg.standardFontDataUrl).toBe(
      `chrome-extension://test-extension-id/${PDF_STANDARD_FONT_DIR}`,
    );
    expect(arg.iccUrl).toBe(`chrome-extension://test-extension-id/${PDF_ICC_DIR}`);
    // pdfjs の getFactoryUrlProp は末尾 `/` がないと「Invalid factory url」を投げるため、
    // 4 つの URL すべてが末尾スラッシュで終わることを回帰防止として固定する
    for (const url of [arg.cMapUrl, arg.wasmUrl, arg.standardFontDataUrl, arg.iccUrl]) {
      expect(url.endsWith('/')).toBe(true);
    }
    // E2E の chrome スタブ（getURL: p => '/'+p）では isValidFetchUrl が true になり得るため、
    // 実機（chrome-extension:）と取得経路を揃えるよう明示的に false にしている
    expect(arg.useWorkerFetch).toBe(false);
  });
});

describe('loadDisposablePdf', () => {
  test('getPage を委譲し、destroy は loadingTask.destroy へ振り向ける（pdfjs 6.x）', async () => {
    const page = { pageNumber: 1 };
    const destroy = jest.fn(async () => undefined);
    const doc = {
      numPages: 2,
      getPage: jest.fn(async () => page),
      loadingTask: { destroy },
    };
    mockedGetDocument.mockReturnValue({
      promise: Promise.resolve(doc),
    } as unknown as ReturnType<typeof getDocument>);

    const disposable = await loadDisposablePdf(new Uint8Array([9]).buffer);
    expect(disposable.numPages).toBe(2);
    await expect(disposable.getPage(1)).resolves.toBe(page);
    expect(doc.getPage).toHaveBeenCalledWith(1);
    await disposable.destroy();
    expect(destroy).toHaveBeenCalled();
  });
});
