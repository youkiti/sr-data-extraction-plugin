// pdfjs-dist の初期化と PDF ロード（architecture.md §3.1）。
// worker は dist/ に同梱した pdf.worker.min.mjs を chrome.runtime.getURL で解決する
// （CDN 参照不可・MV3 CSP 準拠。experiments/anchor-spike の MV3 検証で確定した方式）。
// E2E では chrome スタブ側が getURL を相対パスへ差し替える（test-strategy.md §2.1）
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from 'pdfjs-dist';

export const PDF_WORKER_ASSET = 'pdf.worker.min.mjs';

/**
 * 使用後に破棄できる形にした PDF ドキュメント
 * （features/documents の DisposablePdfDocument を構造的に満たす）。
 * pdfjs-dist 6.x では destroy が PDFDocumentProxy から loadingTask へ移ったため、ここで吸収する
 */
export interface DisposablePdf {
  numPages: number;
  getPage: PDFDocumentProxy['getPage'];
  destroy(): Promise<void>;
}

/** worker URL を未設定のときだけ解決する（複数回呼んでも安全） */
export function configurePdfWorker(): void {
  if (GlobalWorkerOptions.workerSrc === '') {
    GlobalWorkerOptions.workerSrc = chrome.runtime.getURL(PDF_WORKER_ASSET);
  }
}

/**
 * PDF バイト列からドキュメントを開く。
 * 呼び出し側は使用後に `doc.loadingTask.destroy()` を呼ぶこと（メモリ解放）
 */
export async function loadPdf(data: ArrayBuffer): Promise<PDFDocumentProxy> {
  configurePdfWorker();
  return getDocument({ data: new Uint8Array(data) }).promise;
}

/**
 * 取り込みパイプライン（extractTextLayer）用: destroy まで含む最小形で PDF を開く。
 * app/services から DocumentsServiceDeps.loadPdf として注入する
 */
export async function loadDisposablePdf(data: ArrayBuffer): Promise<DisposablePdf> {
  const doc = await loadPdf(data);
  return {
    numPages: doc.numPages,
    getPage: (pageNumber) => doc.getPage(pageNumber),
    destroy: () => doc.loadingTask.destroy(),
  };
}
