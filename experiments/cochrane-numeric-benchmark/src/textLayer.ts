import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- legacy ビルドは型解決が effective でないため
import { getDocument, version as pdfjsVersion } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractTextLayerPages } from '../../../src/lib/pdf/textLayer';
import { selectedTiers, textLayerDir } from './config';
import { cachePath, inputRoot, loadStudies, readOptional, sha256, upstreamPath, writeJson, type TextCache } from './io';

export async function extractText(): Promise<void> {
  const root = await inputRoot();
  const studies = await loadStudies(root);
  await mkdir(textLayerDir(), { recursive: true });
  for (const tier of selectedTiers()) {
    const docs = new Map(studies.filter((study) => study.tier === tier).flatMap((study) => study.task.documents).map((doc) => [doc.pmcid, doc]));
    let extracted = 0, cached = 0, failed = 0, empty = 0, noPdfPath = 0;
    for (const doc of docs.values()) {
      if (!doc.pdf_path) { noPdfPath++; continue; }
      try {
        const data = new Uint8Array(await readFile(upstreamPath(root, doc.pdf_path)));
        const pdfSha256 = sha256(data);
        const file = cachePath(tier, doc.pmcid);
        const existing = await readOptional<TextCache>(file);
        if (existing?.pdfSha256 === pdfSha256) { cached++; if (!existing.pages.some((page) => page.text.trim())) empty++; continue; }
        // extraction-benchmark-real/src/extractText.ts の getDocument と同じ読み込み設定。
        const loading = getDocument({ data, useSystemFonts: true, verbosity: 0 });
        try {
          const pdf = await loading.promise;
          const pages = (await extractTextLayerPages(pdf)).map(({ page, text }) => ({ page, text }));
          await writeJson(file, { tier, docId: doc.pmcid, pdfSha256, pdfjsVersion, pageCount: pages.length, pages });
          extracted++;
          if (!pages.some((page) => page.text.trim())) empty++;
        } finally { await loading.destroy(); }
      } catch { failed++; }
    }
    console.log(`${tier}: documents=${docs.size}, extracted=${extracted}, cached=${cached}, no_pdf_path=${noPdfPath}, failed=${failed}, empty=${empty}`);
  }
}
