import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { classifyFailure, errorInfo, retryDecision } from './retry';
import { costLimits, failureUsage, guardCostUsd, reportCostUsd, redactSecret } from './cost';
import { parseLedger, ledgerWriter, type LedgerEntry } from './ledger';
import { resumeDecision, parseRunState, checkManifest, type InputManifest } from './resume';
import { sha256 } from './io';
import { anchorItems } from './runner';
import { parseExtractDataResponse } from '../../../src/features/extraction/skills/extractData';
import { buildFields } from './schema';
import { cochraneRoot, readSubset } from './config';

test('上流ルートと部分集合の入力検証', () => {
  const oldRoot = process.env.COCHRANE_BENCH_ROOT;
  const oldSubset = process.env.BENCH_STUDIES;
  try {
    delete process.env.COCHRANE_BENCH_ROOT;
    assert.throws(cochraneRoot, /絶対パス/);
    process.env.COCHRANE_BENCH_ROOT = 'relative'; assert.throws(cochraneRoot, /絶対パス/);
    process.env.COCHRANE_BENCH_ROOT = os.tmpdir(); assert.equal(cochraneRoot(), os.tmpdir());
    process.env.BENCH_STUDIES = 'S1,S2'; assert.deepEqual(readSubset('BENCH_STUDIES', ['S1', 'S2']), ['S1', 'S2']);
    process.env.BENCH_STUDIES = 'S3'; assert.throws(() => readSubset('BENCH_STUDIES', ['S1', 'S2']), /未対応/);
  } finally {
    if (oldRoot === undefined) delete process.env.COCHRANE_BENCH_ROOT; else process.env.COCHRANE_BENCH_ROOT = oldRoot;
    if (oldSubset === undefined) delete process.env.BENCH_STUDIES; else process.env.BENCH_STUDIES = oldSubset;
  }
});

test('再試行分類の全状態と優先順位', () => {
  for (const [error, expected] of [
    [{ status: 429, responseBody: 'Spending CAP reached' }, 'spend_cap'],
    [{ status: 401, retryable: true }, 'auth'], [{ status: 403 }, 'auth'],
    [{ status: 429 }, 'retryable'], [{ status: 503 }, 'retryable'], [{}, 'retryable'],
    [{ status: 400, failureKind: 'timeout' }, 'retryable'], [{ failureKind: 'output_limit' }, 'retryable'],
    [{ status: 400, retryable: true }, 'retryable'], [{ status: 400 }, 'other'],
    [{ failureKind: 'content_filter' }, 'other'], [{ failureKind: 'malformed' }, 'other'],
  ] as const) assert.equal(classifyFailure(errorInfo(error)), expected);
  assert.equal(errorInfo('offline').status, null);
  assert.equal(errorInfo({ status: '429', retryable: 'true' }).retryable, null);
  assert.deepEqual(retryDecision('retryable', 1, null), { retry: true, waitMs: 15000 });
  assert.equal(retryDecision('retryable', 2, 60000).waitMs, 60000);
  assert.equal(retryDecision('retryable', 3, 200000).waitMs, 120000);
  assert.deepEqual(retryDecision('retryable', 4, null), { retry: false, waitMs: 0 });
  for (const kind of ['spend_cap', 'auth', 'other'] as const) assert.equal(retryDecision(kind, 1, null).retry, false);
});
test('監視は定価、報告は日付別の本番単価と Sonnet 補助単価', () => {
  assert.equal(guardCostUsd('gemini-3.8-flash', 1000000, 1000000), 9);
  assert.equal(reportCostUsd('gemini-3.8-flash', 1000000, 1000000, 0, Date.parse('2026-12-31T00:00:00Z')), 4.5);
  assert.equal(reportCostUsd('gemini-3.8-flash', 1000000, 1000000, 0, Date.parse('2027-01-01T00:00:00Z')), 9);
  assert.equal(reportCostUsd('claude-sonnet-5-5', 1000000, 1000000, 0, 0), 12);
  assert.throws(() => guardCostUsd('unknown', 1, 1), /単価/);
});
test('失敗の三費用基準と思考内数を二重加算しないこと', () => {
  assert.deepEqual(failureUsage({ usage: { tokensIn: 10, tokensOut: 20, thoughtsTokensOut: 5 } }, 100),
    { tokensIn: 10, tokensOut: 20, cachedTokensIn: null, costBasis: 'measured_failure' });
  assert.deepEqual(failureUsage({ failureKind: 'output_limit' }, 101),
    { tokensIn: 26, tokensOut: 65536, cachedTokensIn: null, costBasis: 'estimated_output_limit' });
  assert.deepEqual(failureUsage({}, 101), { tokensIn: 26, tokensOut: 0, cachedTokensIn: null, costBasis: 'estimated_input_only' });
});
test('費用停止の既定値と入力検証、秘匿化', () => {
  assert.deepEqual(costLimits({ BENCH_COST_LIMIT_USD: '80' }), { limit: 80, pause: 70 });
  assert.equal(costLimits({ BENCH_COST_LIMIT_USD: '80', BENCH_COST_PAUSE_USD: '80' }).pause, 80);
  for (const value of [undefined, '', '0', '-1', 'NaN', 'Infinity']) assert.throws(() => costLimits({ BENCH_COST_LIMIT_USD: value }));
  for (const value of ['0', '81', 'NaN']) assert.throws(() => costLimits({ BENCH_COST_LIMIT_USD: '80', BENCH_COST_PAUSE_USD: value }));
  assert.equal(redactSecret('a+b a%2Bb', 'a+b'), '[REDACTED] [REDACTED]');
});
const line: LedgerEntry = { runId: 'model__cc-by__REV1__S1', model: 'gemini-3.8-flash', studyKey: 'cc-by/REV1/S1',
  attempt: 1, attemptAt: '2026-11-24T00:00:00Z', outcome: 'ok', tokensIn: 1, tokensOut: 2,
  cachedTokensIn: 0, guardCostUsd: 0.1, costBasis: 'measured', elapsedMs: 100 };
test('再開の五状態（確定失敗を含む）', () => {
  assert.equal(resumeDecision({ kind: 'missing' }, [], 17), 'execute');
  for (const outcome of ['ok', 'request_failed', 'format_error'] as const) {
    assert.equal(resumeDecision({ kind: 'parsed', outcome, promptVersion: 17 }, [], 17), 'skip');
  }
  assert.equal(resumeDecision(parseRunState('{'), [], 17), 'backup_execute');
  assert.equal(resumeDecision({ kind: 'missing' }, [line], 17), 'execute');
  assert.throws(() => resumeDecision({ kind: 'parsed', outcome: 'ok', promptVersion: 16 }, [], 17), /BENCH_RUN_LABEL/);
  assert.equal(parseRunState('{}').kind, 'corrupt');
});
test('レジャの切れた最終行だけを許容し中間破損を拒否', async () => {
  const warnings: string[] = [];
  const raw = JSON.stringify(line) + '\n{"runId":';
  assert.equal(parseLedger(raw, (message) => warnings.push(message)).length, 1);
  assert.equal(warnings.length, 1);
  assert.throws(() => parseLedger('{\n' + JSON.stringify(line)), /1 行目/);
  assert.throws(() => parseLedger('{\n'), /1 行目/);
  const dir = await mkdtemp(path.join(os.tmpdir(), 'numeric-ledger-'));
  try {
    const file = path.join(dir, 'ledger.jsonl');
    await writeFile(file, raw);
    const append = ledgerWriter(file);
    await Promise.all([append({ ...line, attempt: 2 }), append({ ...line, attempt: 3 })]);
    assert.deepEqual(parseLedger(await readFile(file, 'utf8')).map((entry) => entry.attempt), [1, 2, 3]);
  } finally { await rm(dir, { recursive: true }); }
});
test('入力 manifest は追加・削除・内容差・版数差を拒否', () => {
  const manifest: InputManifest = { hashes: { 'task.json': sha256('a') }, promptVersion: 17, harnessCommit: null, excluded: [] };
  checkManifest(manifest, manifest);
  const variants: Record<string, string>[] = [{}, { 'task.json': sha256('b') }, { ...manifest.hashes, other: sha256('a') }];
  for (const hashes of variants) {
    assert.throws(() => checkManifest(manifest, { ...manifest, hashes }), /ハッシュ/);
  }
  assert.throws(() => checkManifest(manifest, { ...manifest, promptVersion: 16 }), /版数/);
});
test('本番パーサーと本番アンカリングで文書番号を使う', () => {
  const fields = buildFields([{ row_id: 'row', data_type: 'continuous', fields: ['experimental_mean'] }]);
  const parsed = parseExtractDataResponse(JSON.stringify([{ field_id: 'experimental_mean', entity_key: 'outcome:o1',
    value: '2', not_reported: false, quote: 'value 2', document_index: 2, page: 1 }]), fields, 2);
  const items = anchorItems(parsed.items, [
    { pmcid: 'DOC1', pdf_path: 'one.pdf', pages: [{ page: 1, text: 'other' }] },
    { pmcid: 'DOC2', pdf_path: 'two.pdf', pages: [{ page: 1, text: 'value 2' }] },
  ]);
  assert.equal(items[0]!.anchorStatus, 'exact');
  assert.throws(() => parseExtractDataResponse('invalid', fields, 1));
});
