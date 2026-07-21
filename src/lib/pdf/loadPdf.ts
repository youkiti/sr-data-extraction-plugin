// pdfjs-dist の初期化と PDF ロード（architecture.md §3.1）。
// worker は dist/ に同梱した pdf.worker.min.mjs を chrome.runtime.getURL で解決する
// （CDN 参照不可・MV3 CSP 準拠。experiments/anchor-spike の MV3 検証で確定した方式）。
// E2E では chrome スタブ側が getURL を相対パスへ差し替える（test-strategy.md §2.1）
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from 'pdfjs-dist';

export const PDF_WORKER_ASSET = 'pdf.worker.min.mjs';

/**
 * 既定 CMap の同梱ディレクトリ（issue #95 層 1）。和文 PDF の CID フォント
 * （Adobe-Japan1 等）はテキスト抽出に既定 CMap を要求し、未指定だと translateFont が
 * 失敗して本文テキストの大半が欠落する。worker と同様に dist/ へ同梱して解決する
 */
export const PDF_CMAP_DIR = 'cmaps/';

/**
 * 画像デコーダ（CCITTFax/JBIG2・JPEG2000）の wasm 同梱ディレクトリ。
 * pdfjs-dist 6.x はこれらのデコーダを wasm 実装へ切り替えており、`wasmUrl` 未指定だと
 * `#instantiateWasm: Ensure that the wasmUrl API parameter is provided` で初期化に失敗し、
 * スキャン PDF の該当ページ（CCITTFaxDecode 等）が白紙になる（実測済み）
 */
export const PDF_WASM_DIR = 'wasm/';

/**
 * 標準 14 フォント（非埋め込み PDF 用）の同梱ディレクトリ。未指定でも致命的ではないが
 * 警告が出るため、他の資産と同様に dist/ へ同梱して解決する
 */
export const PDF_STANDARD_FONT_DIR = 'standard_fonts/';

/**
 * 既定 ICC プロファイル（qcms）の同梱ディレクトリ。未指定でも致命的ではないが
 * 警告が出るため、他の資産と同様に dist/ へ同梱して解決する
 */
export const PDF_ICC_DIR = 'iccs/';

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
  return getDocument({
    data: new Uint8Array(data),
    cMapUrl: chrome.runtime.getURL(PDF_CMAP_DIR),
    cMapPacked: true,
    // 画像デコーダの wasm 資産（同梱）。未指定だと Jbig2Error 等で該当ページが白紙になる
    wasmUrl: chrome.runtime.getURL(PDF_WASM_DIR),
    // 標準 14 フォント・既定 ICC プロファイル（いずれも同梱。未指定時の警告を防ぐ）
    standardFontDataUrl: chrome.runtime.getURL(PDF_STANDARD_FONT_DIR),
    iccUrl: chrome.runtime.getURL(PDF_ICC_DIR),
    // pdfjs の isValidFetchUrl は http/https のみ許可するため、実機の chrome-extension: URL では
    // 自動的に false になるが、E2E の chrome スタブ（getURL: p => '/'+p）は http URL に化けて
    // true になり得る。取得経路を実機と E2E で揃えるため明示的に false を渡す
    useWorkerFetch: false,
  }).promise;
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
