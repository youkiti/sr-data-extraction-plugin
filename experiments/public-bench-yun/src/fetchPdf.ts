import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readOptional, sha256, writeJson } from '../../cochrane-numeric-benchmark/src/io';
import { safeError } from '../../cochrane-numeric-benchmark/src/cost';
import { outputRoot, yunRoot } from './config';
import { loadGold } from './dataset';

export const SOURCE = 'https://pmc-oa-opendata.s3.amazonaws.com';
export interface PdfEntry {
  pmcid: number; versions: number[]; version: number | null; licenseCode: string | null; pdfUrl: string | null;
  md5: string | null; sha256: string | null; bytes: number; fetchedAt: string;
  status: 'ok' | 'no_oa' | 'no_pdf' | 'fetch_failed'; error: string | null;
}
export interface PdfManifest { source: string; fetchedAt: string; counts: Record<string, number>; entries: PdfEntry[] }
export const md5 = (bytes: Uint8Array) => createHash('md5').update(bytes).digest('hex');
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export function listingVersions(xml: string, pmcid: number): number[] {
  const versions = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].flatMap((match) => {
    const found = match[1]!.match(new RegExp(`^PMC${pmcid}\\.(\\d+)/`));
    return found ? [Number(found[1])] : [];
  });
  return [...new Set(versions)].sort((a, b) => a - b);
}
// 応答ボディの読み取りもタイムアウトと再試行の対象にする。
export function downloader(fetcher: typeof fetch = fetch, wait = sleep) {
  let last = 0;
  return async (url: string): Promise<Uint8Array> => {
    for (let attempt = 0; ; attempt++) {
      await wait(Math.max(0, last + 300 - Date.now()));
      last = Date.now();
      let retryable = true;
      try {
        const response = await fetcher(url, { signal: AbortSignal.timeout(60_000) });
        if (!response.ok) {
          retryable = response.status === 429 || response.status >= 500;
          throw new Error(`PDF 取得 HTTP ${response.status}`);
        }
        return new Uint8Array(await response.arrayBuffer());
      } catch (error) {
        if (!retryable || attempt >= 2) throw error;
        await wait(attempt === 0 ? 2000 : 8000);
      }
    }
  };
}
export async function fetchOne(pmcid: number, dir: string, download: (url: string) => Promise<Uint8Array>, previous?: PdfEntry): Promise<PdfEntry> {
  if (previous?.status === 'ok' && previous.version !== null) {
    try { if (md5(await readFile(path.join(dir, `PMC${pmcid}.${previous.version}.pdf`))) === previous.md5) return previous; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  const entry: PdfEntry = { pmcid, versions: [], version: null, licenseCode: null, pdfUrl: null, md5: null,
    sha256: null, bytes: 0, fetchedAt: new Date().toISOString(), status: 'fetch_failed', error: null };
  try {
    const xml = Buffer.from(await download(`${SOURCE}/?list-type=2&max-keys=200&prefix=PMC${pmcid}.`)).toString('utf8');
    // 件数が増えた場合、途中までの一覧で最新版を選ばない。
    if (/<IsTruncated>true<\/IsTruncated>/.test(xml)) throw new Error('S3 一覧が省略されています');
    entry.versions = listingVersions(xml, pmcid);
    entry.version = entry.versions.at(-1) ?? null;
    if (entry.version === null) { entry.status = 'no_oa'; return entry; }
    const metadata = JSON.parse(Buffer.from(await download(`${SOURCE}/metadata/PMC${pmcid}.${entry.version}.json`)).toString('utf8')) as { license_code?: string; pdf_url?: string };
    entry.licenseCode = metadata.license_code ?? null; entry.pdfUrl = metadata.pdf_url ?? null;
    if (!entry.pdfUrl) { entry.status = 'no_pdf'; return entry; }
    const url = new URL(entry.pdfUrl);
    const expectedPath = `/PMC${pmcid}.${entry.version}/PMC${pmcid}.${entry.version}.pdf`;
    const expectedMd5 = url.searchParams.get('md5');
    if (url.protocol !== 's3:' || url.hostname !== 'pmc-oa-opendata' || url.pathname !== expectedPath || !expectedMd5 || !/^[a-f\d]{32}$/i.test(expectedMd5)) throw new Error('pdf_url の形式が不正です');
    const bytes = await download(`${SOURCE}${expectedPath}`);
    entry.md5 = md5(bytes); entry.sha256 = sha256(bytes); entry.bytes = bytes.length;
    const file = path.join(dir, `PMC${pmcid}.${entry.version}.pdf`);
    if (entry.md5 !== expectedMd5.toLowerCase()) {
      await rm(file, { force: true });
      throw new Error('PDF の MD5 が一致しません');
    }
    await mkdir(dir, { recursive: true });
    await writeFile(`${file}.tmp`, bytes); await rename(`${file}.tmp`, file);
    entry.status = 'ok';
  } catch (error) { entry.status = 'fetch_failed'; entry.error = safeError(error); }
  return entry;
}
export async function fetchPdfs(fetcher: typeof fetch = fetch): Promise<void> {
  const out = outputRoot();
  const { studies } = await loadGold(yunRoot());
  const dir = path.join(out, 'pdf'), file = path.join(dir, 'manifest.json');
  const previous = await readOptional<PdfManifest>(file);
  const entries = new Map(previous?.entries.map((e) => [e.pmcid, e]) ?? []);
  const download = downloader(fetcher);
  for (const study of studies) {
    const entry = await fetchOne(study.pmcid, dir, download, entries.get(study.pmcid));
    entries.set(study.pmcid, entry);
    const values = studies.flatMap((s) => entries.has(s.pmcid) ? [entries.get(s.pmcid)!] : []);
    const counts = Object.fromEntries(['ok', 'no_oa', 'no_pdf', 'fetch_failed'].map((status) => [status, values.filter((e) => e.status === status).length]));
    await writeJson(`${file}.tmp`, { source: SOURCE, fetchedAt: new Date().toISOString(), counts, entries: values } satisfies PdfManifest);
    await rename(`${file}.tmp`, file);
    console.log(`${study.studyKey}: ${entry.status}`);
  }
  const values = [...entries.values()];
  for (const status of ['ok', 'no_oa', 'no_pdf', 'fetch_failed']) console.log(`${status}: ${values.filter((e) => e.status === status).length}`);
  for (const license of new Set(values.map((e) => e.licenseCode))) console.log(`ライセンス ${license ?? '記載なし'}: ${values.filter((e) => e.licenseCode === license).length}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await fetchPdfs(); } catch (error) { console.error(safeError(error)); process.exitCode = 1; }
}
