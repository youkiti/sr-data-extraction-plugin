// ステップ 1: PDF → 各ページ PNG（scale 2.0）+ ページ寸法 dims.json
// pdfjs-dist（Node では legacy ビルド）で描画する。pdfjs 6.x は isNodeJS 検出時に内部で
// require('@napi-rs/canvas') する作りのため、canvas 自体はこちらで作って `canvas` オプションに
// 直接渡すだけでよい（canvasContext / canvasFactory を自前提供する必要はない）。
// JBIG2 等の wasm デコーダは既定の `wasmUrl: "wasm"`（相対パス）が Node には効かず
// 「Ensure that the `wasmUrl` API parameter is provided」で無音失敗する（スキャン画像が
// 白紙になる）ため、wasmUrl / cMapUrl / standardFontDataUrl を node_modules 内の実パスで明示する。
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- legacy ビルドは型解決が effective でないため
import { getDocument, version as pdfjsVersion } from 'pdfjs-dist/legacy/build/pdf.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const spikeRoot = path.resolve(here, '..');
const pdfPath = path.join(spikeRoot, 'inputs', '07.pdf');
const pagesDir = path.join(spikeRoot, 'outputs', 'pages');
const pdfjsRoot = path.resolve(spikeRoot, 'node_modules', 'pdfjs-dist');
// NodeBinaryDataFactory#fetch は `${baseUrl}${filename}` を fs.readFile するため、
// 各 baseUrl には末尾 `/` が必須（getFactoryUrlProp が endsWith('/') を検査。Windows でも `/` 固定）
const wasmUrl = path.join(pdfjsRoot, 'wasm').replace(/\\/g, '/') + '/';
const cMapUrl = path.join(pdfjsRoot, 'cmaps').replace(/\\/g, '/') + '/';
const standardFontDataUrl = path.join(pdfjsRoot, 'standard_fonts').replace(/\\/g, '/') + '/';

const RENDER_SCALE = 2.0;

interface PageDims {
  page: number;
  /** scale 1.0 での viewport 寸法（PDF ポイント単位） */
  widthPt: number;
  heightPt: number;
  rotation: number;
}

async function main(): Promise<void> {
  await mkdir(pagesDir, { recursive: true });
  const data = new Uint8Array(await readFile(pdfPath));
  const loadingTask = getDocument({
    data,
    useSystemFonts: true,
    wasmUrl,
    cMapUrl,
    cMapPacked: true,
    standardFontDataUrl,
  });
  const doc = await loadingTask.promise;
  console.log(`pdfjs-dist version: ${pdfjsVersion}, pages: ${doc.numPages}`);

  const dims: PageDims[] = [];

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);

    // scale 1.0 の viewport 寸法（座標写像の基準単位）
    const baseViewport = page.getViewport({ scale: 1.0 });
    dims.push({
      page: p,
      widthPt: baseViewport.width,
      heightPt: baseViewport.height,
      rotation: baseViewport.rotation,
    });

    // 実描画は scale 2.0
    const viewport = page.getViewport({ scale: RENDER_SCALE });
    const canvas = createCanvas(viewport.width, viewport.height);
    // pdfjs の型定義は browser 向け RenderParameters（canvas: HTMLCanvasElement）しか公開していない。
    // @napi-rs/canvas の Canvas は互換の描画 API を持つが型としては別物のためキャストする
    await page.render({ canvas, viewport } as unknown as Parameters<typeof page.render>[0]).promise;

    const buffer = canvas.toBuffer('image/png');
    const outPath = path.join(pagesDir, `p${p}.png`);
    await writeFile(outPath, buffer);
    console.log(`  p${p}: ${viewport.width}x${viewport.height}px -> ${path.relative(spikeRoot, outPath)}`);

    page.cleanup();
  }

  await loadingTask.destroy();
  await writeFile(path.join(pagesDir, 'dims.json'), JSON.stringify({ pdfjsVersion, renderScale: RENDER_SCALE, pages: dims }, null, 1), 'utf8');
  console.log(`dims.json 保存 -> ${path.relative(spikeRoot, path.join(pagesDir, 'dims.json'))}`);
}

await main();
