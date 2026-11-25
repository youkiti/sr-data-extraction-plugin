import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { classifyFailure, errorInfo, failureClass, retryDecision } from './retry';
import { costLimits, failureUsage, guardCostUsd, reportCostUsd, redactSecret, otherSpend } from './cost';
import { parseLedger, ledgerWriter, budgetSpend, readLedger, assertRunLedger, assertRunFilesLedger, type LedgerEntry } from './ledger';
import { resumeDecision, parseRunState, checkManifest, assertManifestPresent, type InputManifest } from './resume';
import { sha256 } from './io';
import { anchorItems, interruptedRecord } from './runner';
import { parseExtractDataResponse } from '../../../src/features/extraction/skills/extractData';
import { buildFields } from './schema';
import { cochraneRoot, readSubset, benchRoot, selectedModels } from './config';
import type { Study } from './evaluationSet';

async function temporary() {
  const outputs = path.join(benchRoot, 'outputs');
  await mkdir(outputs, { recursive: true });
  return mkdtemp(path.join(outputs, '.test-tmp-'));
}

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
    [{ status: 400, responseBody: '{"reason":"API_KEY_INVALID"}' }, 'auth'],
    [{ status: 400, responseBody: 'API key not valid' }, 'auth'],
    [{ status: 429 }, 'retryable'], [{ status: 503 }, 'retryable'], [{}, 'retryable'],
    [{ status: 400, failureKind: 'timeout' }, 'retryable'], [{ failureKind: 'output_limit' }, 'retryable'],
    [{ status: 400, retryable: true }, 'retryable'], [{ status: 400 }, 'other'],
    [{ failureKind: 'content_filter' }, 'other'], [{ failureKind: 'malformed' }, 'other'],
    [{ failureKind: 'malformed', retryable: true }, 'retryable'],
    [{ failureKind: 'content_filter', retryable: true }, 'retryable'],
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
  assert.ok(Math.abs(guardCostUsd('claude-haiku-5-5', 50_000, 2_000) - (50_000 * 0.5 + 2_000 * 2.5) / 1e6) < 1e-12);
  assert.ok(Math.abs(reportCostUsd('claude-haiku-5-5', 100_000, 2_000, 0, 0) - (100_000 * 0.1 + 2_000 * 0.5) / 1e6) < 1e-12);
  assert.ok(Math.abs(reportCostUsd('claude-haiku-5-5', 100_001, 2_000, 0, 0) - (100_001 * 0.5 + 2_000 * 2.5) / 1e6) < 1e-12);
  assert.throws(() => guardCostUsd('unknown', 1, 1), /単価/);
});
test('比較モデルに Gemini、Sonnet、Haiku を指定できる', () => {
  const previous = process.env.BENCH_MODELS;
  try {
    process.env.BENCH_MODELS = 'gemini-3.8-flash,claude-sonnet-5-5,claude-haiku-5-5';
    assert.deepEqual(selectedModels(), [
      { id: 'gemini-3.8-flash', keyEnv: 'GEMINI_API_KEY' },
      { id: 'claude-sonnet-5-5', keyEnv: 'ANTHROPIC_API_KEY' },
      { id: 'claude-haiku-5-5', keyEnv: 'ANTHROPIC_API_KEY' },
    ]);
  } finally {
    if (previous === undefined) delete process.env.BENCH_MODELS;
    else process.env.BENCH_MODELS = previous;
  }
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
  assert.deepEqual(resumeDecision({ kind: 'missing' }, [], 17), { kind: 'execute', attempt: 1 });
  for (const outcome of ['ok', 'request_failed', 'format_error'] as const) {
    assert.deepEqual(resumeDecision({ kind: 'parsed', outcome, promptVersion: 17 }, [], 17), { kind: 'skip' });
  }
  assert.deepEqual(resumeDecision(parseRunState('{'), [], 17), { kind: 'backup_execute', attempt: 1 });
  assert.deepEqual(resumeDecision({ kind: 'missing' }, [line], 17), { kind: 'execute', attempt: 2 });
  const history = [1, 2, 3, 4].map((attempt) => ({ ...line, attempt }));
  assert.deepEqual(resumeDecision({ kind: 'missing' }, history, 17), { kind: 'finalise', last: history[3] });
  const record = interruptedRecord({ tier: 'cc-by', reviewId: 'REV1' } as Study, history[3]!);
  assert.equal(record.outcome, 'request_failed'); assert.equal(record.attempts, 4);
  assert.equal(record.error, '再試行の上限に達した後に中断されていました');
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
  const dir = await temporary();
  try {
    const file = path.join(dir, 'ledger.jsonl');
    await writeFile(file, raw);
    const append = ledgerWriter(file);
    await Promise.all([append({ ...line, attempt: 2 }), append({ ...line, attempt: 3 })]);
    assert.deepEqual(parseLedger(await readFile(file, 'utf8')).map((entry) => entry.attempt), [1, 2, 3]);
  } finally { await rm(dir, { recursive: true }); }
});
test('入力 manifest は追加・削除・内容差・版数差を拒否', () => {
  const manifest: InputManifest = { hashes: { 'task.json': sha256('a') }, promptVersion: 17, harnessCommit: null, excluded: [], emptyGold: {} };
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

test('全ラベル台帳とその他支出の合算、manifest と採点台帳の必須検証', async () => {
  assert.equal(otherSpend({}), 0); assert.equal(otherSpend({ BENCH_OTHER_SPEND_USD: '2.5' }), 2.5);
  for (const raw of ['', ' ', '-1', 'NaN', 'Infinity', 'bad']) assert.throws(() => otherSpend({ BENCH_OTHER_SPEND_USD: raw }));
  const dir = await temporary();
  try {
    for (const [label, cost] of [['smoke', 1], ['main', 2]] as const) {
      const folder = path.join(dir, `runs-${label}`);
      await mkdir(folder);
      await writeFile(path.join(folder, '_ledger.jsonl'), JSON.stringify({ ...line, guardCostUsd: cost }) + '\n');
    }
    assert.deepEqual(await budgetSpend(dir, 2.5), { labels: { main: 2, smoke: 1 }, other: 2.5, total: 5.5 });
    const file = path.join(dir, '_inputs.json');
    assert.equal(await assertManifestPresent(file, false), null);
    await assert.rejects(assertManifestPresent(file, true), /_inputs.json/);
    await writeFile(path.join(dir, 'run.json'), '{}');
    await assert.rejects(assertManifestPresent(file, false), /_inputs.json/);
    await assert.rejects(assertRunFilesLedger(dir, [line]), /台帳/);
    await writeFile(path.join(dir, 'run.json'), JSON.stringify({ runId: line.runId }));
    await assertRunFilesLedger(dir, [line]);
    await rm(path.join(dir, 'run.json'));
    await writeFile(path.join(dir, '_ledger.jsonl'), '');
    await assert.rejects(assertManifestPresent(file, false), /_inputs.json/);
    await assert.rejects(readLedger(path.join(dir, 'missing.jsonl'), true), /_ledger.jsonl/);
    assert.throws(() => assertRunLedger(['missing'], [line]), /台帳/);
    assertRunLedger([line.runId], [line]);
  } finally { await rm(dir, { recursive: true }); }
});

test('台帳の失敗分類と旧行の null 補完', () => {
  for (const [info, expected] of [
    [{ status: 429 }, 'rate_limit'], [{ status: 503 }, 'server_error'], [{}, 'network'],
    [{ failureKind: 'timeout' }, 'timeout'], [{ failureKind: 'output_limit' }, 'output_limit'],
    [{ failureKind: 'malformed', retryable: true }, 'retryable_flag'], [{ status: 400 }, 'other'],
  ] as const) assert.equal(failureClass(errorInfo(info)), expected);
  const old = parseLedger(JSON.stringify(line) + '\n')[0]!;
  assert.equal(old.httpStatus, null); assert.equal(old.failureClass, null);
});
