// PDF → ページ別テキスト（IMPLEMENTATION.md §6）。
// anchor-spike/src/extract-text.ts を踏襲し、出力を本ディレクトリの outputs/textlayer/{pdf_id}.json に。
// runner はこの JSON の pages（{ page, text }[]）をそのまま ExtractDataPage[] として渡す。
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- legacy ビルドは型解決が effective でないため
import { getDocument, version as pdfjsVersion } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { benchRoot, repoRoot, TARGETS } from './config';

const pdfDir = path.join(repoRoot, 'tests', 'fixtures', 'pdf');
const outDir = path.join(benchRoot, 'outputs', 'textlayer');

interface PageJson {
  /** 1-indexed ページ番号 */
  page: number;
  /** item を読み順（コンテンツストリーム順）で連結。hasEOL 位置に \n を挿入 */
  text: string;
}

interface TextLayerJson {
  pdfId: string;
  file: string;
  pdfjsVersion: string;
  pageCount: number;
  pages: PageJson[];
}

async function extractOne(target: { pdfId: string; file: string }): Promise<TextLayerJson> {
  const data = new Uint8Array(await readFile(path.join(pdfDir, target.file)));
  const loadingTask = getDocument({ data, useSystemFonts: true });
  const doc = await loadingTask.promise;
  const pages: PageJson[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    let text = '';
    for (const raw of content.items) {
      if (!('str' in raw)) continue; // TextMarkedContent はスキップ
      text += raw.str;
      if (raw.hasEOL) text += '\n';
    }
    pages.push({ page: p, text });
    page.cleanup();
  }
  await loadingTask.destroy();
  return {
    pdfId: target.pdfId,
    file: target.file,
    pdfjsVersion,
    pageCount: pages.length,
    pages,
  };
}

async function main(): Promise<void> {
  await mkdir(outDir, { recursive: true });
  for (const target of TARGETS) {
    const result = await extractOne(target);
    const outPath = path.join(outDir, `${target.pdfId}.json`);
    await writeFile(outPath, JSON.stringify(result, null, 1), 'utf8');
    const chars = result.pages.reduce((n, pg) => n + pg.text.length, 0);
    console.log(
      `${target.pdfId}: ${result.pageCount} pages, ${chars} chars -> ${path.relative(benchRoot, outPath)}`,
    );
  }
  console.log(`pdfjs-dist version: ${pdfjsVersion}`);
}

await main();
