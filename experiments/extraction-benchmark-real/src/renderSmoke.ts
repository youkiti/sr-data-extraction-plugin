import path from 'node:path';
import { benchRoot, TARGETS } from './config';
import { BENCHMARK_PAGE_IMAGE_RENDER_SCALE, renderPdfPageImages } from './pageImages';

const target = TARGETS[0];
if (target === undefined) throw new Error('TARGETS が空です');
const images = await renderPdfPageImages(path.join(benchRoot, 'raw', 'pdf', target.file));
if (images.length === 0 || images.some((image) => image.mimeType !== 'image/png' || image.dataBase64 === '')) {
  throw new Error('ページ画像の生成結果が不正です');
}
console.log(`${target.pdfId}: ${images.length} pages, scale=${BENCHMARK_PAGE_IMAGE_RENDER_SCALE}, PNG生成OK`);
