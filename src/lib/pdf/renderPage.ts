// PDF ページの canvas 描画（S6 / S8 検証画面の左ペイン）。
// pdfjs-dist へ直接依存せず構造的な最小型で受けるため、テストは fake ページで完結する
// （textLayer.ts の PdfPageLike と同じ方針）。pdfjs 6.x の推奨に従い canvas パラメータで描画する

/** getViewport の戻りのうち本モジュールが読む部分 */
export interface PdfPageViewport {
  width: number;
  height: number;
}

/** pdfjs の PDFPageProxy のうち描画に使う部分 */
export interface RenderablePdfPage {
  getViewport(options: { scale: number }): PdfPageViewport;
  render(options: { canvas: HTMLCanvasElement; viewport: PdfPageViewport }): {
    promise: Promise<void>;
  };
}

/** ビューアが受け取る PDF ドキュメント（DisposablePdf からサービス境界でこの形へ絞る） */
export interface PdfViewerDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<RenderablePdfPage>;
}

/**
 * 指定倍率でページを canvas へ描画し、描画後の canvas 寸法（px）を返す。
 * canvas の width / height はここで viewport に合わせて上書きする
 */
export async function renderPdfPageToCanvas(
  page: RenderablePdfPage,
  canvas: HTMLCanvasElement,
  scale: number,
): Promise<PdfPageViewport> {
  const viewport = page.getViewport({ scale });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  await page.render({ canvas, viewport }).promise;
  return { width: canvas.width, height: canvas.height };
}
