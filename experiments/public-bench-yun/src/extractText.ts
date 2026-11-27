import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
// @ts-ignore -- legacy ビルドの型解決に合わせる
import { getDocument, version as pdfjsVersion } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractTextLayerPages } from '../../../src/lib/pdf/textLayer';
import { readJson, readOptional, sha256, writeJson } from '../../cochrane-numeric-benchmark/src/io';
import { safeError } from '../../cochrane-numeric-benchmark/src/cost';
import { outputRoot } from './config';
import type { TextCache } from './dataset';
import type { PdfManifest } from './fetchPdf';

export async function extractText(out = outputRoot()): Promise<void> {
  const manifest = await readJson<PdfManifest>(path.join(out, 'pdf/manifest.json'));
  let extracted = 0, cached = 0, failed = 0, empty = 0;
  for (const entry of manifest.entries.filter((e) => e.status === 'ok')) {
    try {
      const data = new Uint8Array(await readFile(path.join(out, `pdf/PMC${entry.pmcid}.${entry.version}.pdf`)));
      const pdfSha256 = sha256(data);
      if (pdfSha256 !== entry.sha256) throw new Error('PDF の SHA256 が一致しません');
      const file = path.join(out, `textlayer/PMC${entry.pmcid}.json`);
      const existing = await readOptional<TextCache>(file);
      if (existing?.pdfSha256 === pdfSha256) {
        cached++; if (!existing.pages.some((p) => p.text.trim())) empty++;
        continue;
      }
      const loading = getDocument({ data, useSystemFonts: true, verbosity: 0 });
      try {
        const pdf = await loading.promise;
        const pages = (await extractTextLayerPages(pdf)).map(({ page, text }) => ({ page, text }));
        await writeJson(file, { pmcid: entry.pmcid, version: entry.version!, pdfSha256, pdfjsVersion,
          pageCount: pages.length, pages } satisfies TextCache);
        extracted++; if (!pages.some((p) => p.text.trim())) empty++;
      } finally { await loading.destroy(); }
    } catch (error) { failed++; console.error(`PMC${entry.pmcid}: text_failed: ${safeError(error)}`); }
  }
  console.log(`抽出=${extracted}, キャッシュ=${cached}, text_failed=${failed}, 空文字層=${empty}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await extractText(); } catch (error) { console.error(safeError(error)); process.exitCode = 1; }
}
