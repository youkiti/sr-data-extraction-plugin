import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import { PDF_WORKER_ASSET, configurePdfWorker, loadPdf } from '../../../../src/lib/pdf/loadPdf';

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
    const arg = mockedGetDocument.mock.calls[0]?.[0] as { data: Uint8Array };
    expect(arg.data).toBeInstanceOf(Uint8Array);
    expect([...arg.data]).toEqual([1, 2, 3]);
  });
});
