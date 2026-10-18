// Node 上で PDF を本番と同じ scale 2.0 の PNG ページ画像へ変換する。
import { readFile } from 'node:fs/promises';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- pdfjs-dist の legacy build は NodeNext で型解決できない
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import type { ExtractDataImagePage } from '../../../src/features/extraction/skills/extractData';

/** 本番 loadDocumentPageImages.ts の PAGE_IMAGE_RENDER_SCALE と同値。 */
export const BENCHMARK_PAGE_IMAGE_RENDER_SCALE = 2.0;

export async function renderPdfPageImages(pdfPath: string): Promise<ExtractDataImagePage[]> {
  const data = new Uint8Array(await readFile(pdfPath));
  const loadingTask = getDocument({ data, useSystemFonts: true });
  const pdf = await loadingTask.promise;
  try {
    const images: ExtractDataImagePage[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: BENCHMARK_PAGE_IMAGE_RENDER_SCALE });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext('2d');
      // pdfjs の公開型は DOM canvas を要求するが、Node 実装は既定で @napi-rs/canvas を使う。
      // 実行時に受理される同一オブジェクトであり、ここだけ境界型を緩める。
      await page.render({ canvasContext: context, canvas, viewport } as never).promise;
      images.push({
        page: pageNumber,
        mimeType: 'image/png',
        dataBase64: canvas.toBuffer('image/png').toString('base64'),
      });
      page.cleanup();
    }
    return images;
  } finally {
    await loadingTask.destroy();
  }
}
