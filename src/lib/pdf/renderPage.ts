// PDF ページの canvas 描画（S6 / S8 検証画面の左ペイン）。
// pdfjs-dist へ直接依存せず構造的な最小型で受けるため、テストは fake ページで完結する
// （textLayer.ts の PdfPageLike と同じ方針）。pdfjs 6.x の推奨に従い canvas パラメータで描画する
//
// 高 DPI 対応（issue #28 案1: CSS 表示寸法と canvas 内部解像度の分離）:
// canvas の内部解像度（width / height 属性）は devicePixelRatio 分だけ高く確保し、
// CSS 表示寸法（style.width / height）は scale 基準のまま据え置く。これにより
// ハイライトオーバーレイ（pdfViewer.ts の rectStyle。TextLayerPage 基準の CSS px）との
// 位置整合や、テキスト層が無いページのレイアウト寸法（pageWrap が canvas の自然寸法に依存する
// ケース）に影響を与えずに高解像度描画できる。

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

/** canvas の内部解像度（width × height の総画素数）の既定上限。4096×4096 相当 */
export const MAX_CANVAS_TOTAL_PIXELS = 16_777_216;

export interface RenderPdfPageOptions {
  /**
   * 出力解像度の倍率（テスト注入用）。既定は `globalThis.devicePixelRatio ?? 1`。
   * 1 未満を渡しても内部では 1 未満に縮小しない（従来品質を下限とする）
   */
  devicePixelRatio?: number;
  /** canvas 内部の総画素数上限（テスト注入用）。既定は {@link MAX_CANVAS_TOTAL_PIXELS} */
  maxTotalPixels?: number;
}

/**
 * 指定倍率でページを canvas へ描画し、CSS 表示寸法（px。scale 基準）を返す。
 *
 * canvas.width / height（内部解像度）には devicePixelRatio 分の追加倍率 outputScale を
 * かけて確保する一方、canvas.style.width / height（CSS 表示寸法）は outputScale の影響を
 * 受けず scale 基準のまま設定する。総画素数が maxTotalPixels を超える場合は outputScale を
 * 按分で縮小するが、1 未満（= 従来の等倍描画を下回る解像度）にはしない。
 */
export async function renderPdfPageToCanvas(
  page: RenderablePdfPage,
  canvas: HTMLCanvasElement,
  scale: number,
  options?: RenderPdfPageOptions,
): Promise<PdfPageViewport> {
  const displayViewport = page.getViewport({ scale });
  const cssWidth = displayViewport.width;
  const cssHeight = displayViewport.height;

  const requestedRatio = options?.devicePixelRatio ?? globalThis.devicePixelRatio ?? 1;
  const maxTotalPixels = options?.maxTotalPixels ?? MAX_CANVAS_TOTAL_PIXELS;

  // 下限 1（従来品質）を確保したうえで、総画素数の上限を超える場合のみ按分で縮小する
  let outputScale = Math.max(1, requestedRatio);
  const totalPixelsAtOutputScale = cssWidth * outputScale * (cssHeight * outputScale);
  if (totalPixelsAtOutputScale > maxTotalPixels) {
    const shrinkFactor = Math.sqrt(maxTotalPixels / (cssWidth * cssHeight));
    outputScale = Math.max(1, Math.min(outputScale, shrinkFactor));
  }

  const renderViewport = page.getViewport({ scale: scale * outputScale });
  canvas.width = Math.floor(renderViewport.width);
  canvas.height = Math.floor(renderViewport.height);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;

  await page.render({ canvas, viewport: renderViewport }).promise;
  return { width: cssWidth, height: cssHeight };
}
