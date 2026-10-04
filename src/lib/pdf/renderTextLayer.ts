import type { TextLayer, PageViewport } from 'pdfjs-dist';
import type { RenderablePdfPage } from './renderPage';

/** 選択用の文字配置は canvas と同倍率の viewport で pdf.js に任せる。 */
export function renderPdfTextLayer(
  page: RenderablePdfPage & { getTextContent: NonNullable<RenderablePdfPage['getTextContent']> },
  container: HTMLElement,
  scale: number,
): { promise: Promise<void>; cancel(): void } {
  let cancelled = false;
  let layer: TextLayer | undefined;
  const promise = (async () => {
    const [{ TextLayer }, textContentSource] = await Promise.all([
      import(/* webpackChunkName: "pdfjs" */ 'pdfjs-dist'),
      page.getTextContent(),
    ]);
    if (cancelled) return;
    const viewport = page.getViewport({ scale }) as PageViewport;
    container.style.setProperty('--scale-factor', String(scale));
    container.style.setProperty('--total-scale-factor', String(scale * viewport.userUnit));
    layer = new TextLayer({ textContentSource, container, viewport });
    await layer.render();
  })();
  return {
    promise,
    cancel() {
      cancelled = true;
      layer?.cancel();
    },
  };
}
