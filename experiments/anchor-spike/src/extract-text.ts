// ステップ 1: PDF → ページ別テキスト + span 座標 JSON
// pdfjs-dist（Node では legacy ビルド）で fixture PDF 2 本からテキスト層を抽出する。
// 出力は outputs/textlayer/{pdf_id}.json（tools/generate-pdf-fixture.ts の原型）。
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- legacy ビルドは型解決が effective でないため
import { getDocument, version as pdfjsVersion } from 'pdfjs-dist/legacy/build/pdf.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const spikeRoot = path.resolve(here, '..');
const pdfDir = path.resolve(spikeRoot, '../../tests/fixtures/pdf');
const outDir = path.join(spikeRoot, 'outputs', 'textlayer');

/** span 1 個ぶんのテキスト層 item（highlightMap / fixture JSON の素材） */
interface TextItemJson {
  /** ページテキスト内の開始文字オフセット */
  charStart: number;
  str: string;
  /** PDF ユーザー空間への変換行列 [a,b,c,d,e,f]（e,f が原点座標） */
  transform: number[];
  width: number;
  height: number;
  hasEOL: boolean;
}

interface PageJson {
  page: number;
  /** item を読み順（コンテンツストリーム順）で連結したテキスト。hasEOL 位置に \n を挿入 */
  text: string;
  /** PDF ポイント単位のページサイズ */
  width: number;
  height: number;
  items: TextItemJson[];
}

interface TextLayerJson {
  pdfId: string;
  file: string;
  pdfjsVersion: string;
  pageCount: number;
  pages: PageJson[];
}

const TARGETS: Array<{ pdfId: string; file: string }> = [
  { pdfId: 'udca', file: 'PMC10715657_plosone_udca_rct.pdf' },
  { pdfId: 'thermocov', file: 'PMC10766786_frontmed_thermocov_rct.pdf' },
];

async function extractOne(target: { pdfId: string; file: string }): Promise<TextLayerJson> {
  const data = new Uint8Array(await readFile(path.join(pdfDir, target.file)));
  const loadingTask = getDocument({ data, useSystemFonts: true });
  const doc = await loadingTask.promise;
  const pages: PageJson[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    let text = '';
    const items: TextItemJson[] = [];
    for (const raw of content.items) {
      if (!('str' in raw)) continue; // TextMarkedContent はスキップ
      items.push({
        charStart: text.length,
        str: raw.str,
        transform: raw.transform,
        width: raw.width,
        height: raw.height,
        hasEOL: raw.hasEOL,
      });
      text += raw.str;
      if (raw.hasEOL) text += '\n';
    }
    pages.push({ page: p, text, width: viewport.width, height: viewport.height, items });
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
      `${target.pdfId}: ${result.pageCount} pages, ${chars} chars -> ${path.relative(spikeRoot, outPath)}`,
    );
  }
  console.log(`pdfjs-dist version: ${pdfjsVersion}`);
}

await main();
