import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { downloader, fetchOne, listingVersions, md5 } from './fetchPdf';

const listing = '<ListBucketResult><Key>PMC2.1/a</Key><Key>PMC2.10/a</Key><Key>PMC2.2/a</Key><Key>PMC2.10/b</Key></ListBucketResult>';
function fake(responses: (string | Uint8Array | number | Error)[]) {
  const calls: string[] = [];
  const fetcher = (async (url: unknown) => {
    calls.push(String(url));
    const response = responses.shift();
    if (response === undefined) throw new Error('想定外の通信');
    if (response instanceof Error) throw response;
    return new Response(typeof response === 'number' ? '' : response as BodyInit, { status: typeof response === 'number' ? response : 200 });
  }) as typeof fetch;
  return { calls, download: downloader(fetcher, async () => {}) };
}
test('S3 の版は 1, 2, 10 の数値順、空一覧は no_oa、pdf_url 無しは no_pdf', async () => {
  assert.deepEqual(listingVersions(listing, 2), [1, 2, 10]);
  const noOa = await fetchOne(2, '/未使用', fake(['<ListBucketResult/>']).download);
  assert.equal(noOa.status, 'no_oa');
  const source = fake([listing, JSON.stringify({ license_code: 'CC BY' })]);
  const noPdf = await fetchOne(2, '/未使用', source.download);
  assert.equal(noPdf.status, 'no_pdf'); assert.equal(noPdf.version, 10); assert.equal(noPdf.licenseCode, 'CC BY');
  assert.match(source.calls[1]!, /metadata\/PMC2\.10\.json$/);
});
test('MD5 不一致の PDF は残さず、成功した PDF は再実行で通信せずスキップ', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yun-fetch-'));
  try {
    const pdf = Buffer.from('合成 PDF');
    const metadata = (hash: string) => JSON.stringify({ license_code: 'CC BY', pdf_url: `s3://pmc-oa-opendata/PMC2.10/PMC2.10.pdf?md5=${hash}` });
    const mismatch = await fetchOne(2, dir, fake([listing, metadata('0'.repeat(32)), pdf]).download);
    assert.equal(mismatch.status, 'fetch_failed'); assert.match(mismatch.error!, /MD5/);
    await assert.rejects(stat(path.join(dir, 'PMC2.10.pdf')), { code: 'ENOENT' });
    const success = await fetchOne(2, dir, fake([listing, metadata(md5(pdf)), pdf]).download);
    assert.equal(success.status, 'ok'); assert.deepEqual(await readFile(path.join(dir, 'PMC2.10.pdf')), pdf);
    const source = fake([]);
    assert.deepEqual(await fetchOne(2, dir, source.download, success), success); assert.deepEqual(source.calls, []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('ネットワーク・429・5xx を最大 3 回試行し、他の HTTP エラーは再試行しない', async () => {
  const source = fake([new Error('通信断'), 503, 'ok']);
  assert.equal(Buffer.from(await source.download('https://fake')).toString(), 'ok'); assert.equal(source.calls.length, 3);
  const limited = fake([429, 429, 429]); await assert.rejects(limited.download('https://fake'), /429/); assert.equal(limited.calls.length, 3);
  const missing = fake([404]); await assert.rejects(missing.download('https://fake'), /404/); assert.equal(missing.calls.length, 1);
});
