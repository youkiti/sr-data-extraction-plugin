// PDF → ページ別テキスト（既存 extraction-benchmark/src/extractText.ts の踏襲）。
// 入力は raw/pdf/{file}（gitignore 済み。Step 6 で配置）。出力は outputs/textlayer/{pdfId}.json。
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- legacy ビルドは型解決が effective でないため
import { getDocument, version as pdfjsVersion } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { benchRoot, TARGETS } from './config';

const pdfDir = path.join(benchRoot, 'raw', 'pdf');
const outDir = path.join(benchRoot, 'outputs', 'textlayer');

interface PageJson {
  page: number;
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
      if (!('str' in raw)) continue;
      text += raw.str;
      if (raw.hasEOL) text += '\n';
    }
    pages.push({ page: p, text });
    page.cleanup();
  }
  await loadingTask.destroy();
  return { pdfId: target.pdfId, file: target.file, pdfjsVersion, pageCount: pages.length, pages };
}

async function main(): Promise<void> {
  await mkdir(outDir, { recursive: true });
  for (const target of TARGETS) {
    try {
      const result = await extractOne(target);
      const outPath = path.join(outDir, `${target.pdfId}.json`);
      await writeFile(outPath, JSON.stringify(result, null, 1), 'utf8');
      const chars = result.pages.reduce((n, pg) => n + pg.text.length, 0);
      console.log(`${target.pdfId}: ${result.pageCount} pages, ${chars} chars -> ${path.relative(benchRoot, outPath)}`);
    } catch (e) {
      console.error(`${target.pdfId}: 抽出失敗（${target.file}）: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(`pdfjs-dist version: ${pdfjsVersion}`);
}

await main();
