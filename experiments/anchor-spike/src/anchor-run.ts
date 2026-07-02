// ステップ 4: 全 evidence 行に anchor_status を付与する
// base 正規化（§5 どおり）と extended 正規化（ダッシュ / 引用符折り畳み追加）の両方で計測し、
// 追加正規化の効果を REPORT で比較できるようにする。
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { anchorQuote, type AnchorResult, type NormalizedPage } from './anchor.js';
import { normalizeBase, normalizeExtended } from './normalize.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const spikeRoot = path.resolve(here, '..');

interface EvidenceRow {
  run: string;
  pdfId: string;
  mode: string;
  field_id: string;
  entity_key: string;
  value: string | null;
  not_reported: boolean;
  quote: string | null;
  page: number | null;
  confidence: string;
}

interface AnchoredRow extends EvidenceRow {
  anchorBase: AnchorResult | null;
  anchorExtended: AnchorResult | null;
}

interface PageJson {
  page: number;
  text: string;
}

async function loadNormalizedPages(
  pdfId: string,
): Promise<{ base: NormalizedPage[]; extended: NormalizedPage[] }> {
  const raw = await readFile(path.join(spikeRoot, 'outputs', 'textlayer', `${pdfId}.json`), 'utf8');
  const pages = (JSON.parse(raw) as { pages: PageJson[] }).pages;
  return {
    base: pages.map((p) => ({ page: p.page, text: normalizeBase(p.text) })),
    extended: pages.map((p) => ({ page: p.page, text: normalizeExtended(p.text) })),
  };
}

async function main(): Promise<void> {
  const evidence = JSON.parse(
    await readFile(path.join(spikeRoot, 'outputs', 'runs', 'evidence-all.json'), 'utf8'),
  ) as EvidenceRow[];

  const pagesByPdf = new Map<string, { base: NormalizedPage[]; extended: NormalizedPage[] }>();
  for (const pdfId of new Set(evidence.map((e) => e.pdfId))) {
    pagesByPdf.set(pdfId, await loadNormalizedPages(pdfId));
  }

  const anchored: AnchoredRow[] = [];
  for (const row of evidence) {
    if (row.quote == null || row.quote.length === 0) {
      anchored.push({ ...row, anchorBase: null, anchorExtended: null });
      continue;
    }
    const pages = pagesByPdf.get(row.pdfId);
    if (!pages) throw new Error(`テキスト層がない: ${row.pdfId}`);
    anchored.push({
      ...row,
      anchorBase: anchorQuote(normalizeBase(row.quote), pages.base, row.page),
      anchorExtended: anchorQuote(normalizeExtended(row.quote), pages.extended, row.page),
    });
  }

  const outDir = path.join(spikeRoot, 'outputs', 'anchored');
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'anchored-all.json'), JSON.stringify(anchored, null, 1), 'utf8');

  const withQuote = anchored.filter((a) => a.anchorBase != null);
  const tally = (pick: (a: AnchoredRow) => AnchorResult | null): Record<string, number> => {
    const t: Record<string, number> = {};
    for (const a of withQuote) {
      const s = pick(a)?.status ?? 'none';
      t[s] = (t[s] ?? 0) + 1;
    }
    return t;
  };
  console.log(`quote 付き evidence: ${withQuote.length} / ${anchored.length}`);
  console.log('base:    ', JSON.stringify(tally((a) => a.anchorBase)));
  console.log('extended:', JSON.stringify(tally((a) => a.anchorExtended)));
}

await main();
