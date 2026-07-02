// pdfjs-dist の初期化と PDF ロード（architecture.md §3.1）。
// worker は dist/ に同梱した pdf.worker.min.mjs を chrome.runtime.getURL で解決する
// （CDN 参照不可・MV3 CSP 準拠。experiments/anchor-spike の MV3 検証で確定した方式）。
// E2E では chrome スタブ側が getURL を相対パスへ差し替える（test-strategy.md §2.1）
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from 'pdfjs-dist';

export const PDF_WORKER_ASSET = 'pdf.worker.min.mjs';

/** worker URL を未設定のときだけ解決する（複数回呼んでも安全） */
export function configurePdfWorker(): void {
  if (GlobalWorkerOptions.workerSrc === '') {
    GlobalWorkerOptions.workerSrc = chrome.runtime.getURL(PDF_WORKER_ASSET);
  }
}

/**
 * PDF バイト列からドキュメントを開く。
 * 呼び出し側は使用後に `doc.destroy()` を呼ぶこと（メモリ解放）
 */
export async function loadPdf(data: ArrayBuffer): Promise<PDFDocumentProxy> {
  configurePdfWorker();
  return getDocument({ data: new Uint8Array(data) }).promise;
}
