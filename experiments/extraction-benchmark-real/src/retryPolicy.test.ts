import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyFailure, errorInfo, fatalAbortExcerpt, retryDecision } from './retryPolicy';

test('errorInfo: instanceof を使わず、素のオブジェクトからでも status/responseBody を読む', () => {
  // LlmProviderError のインスタンスではない、ただのオブジェクト（tsx のモジュール同一性で
  // instanceof が不安定になるケースを模す）
  const raw = { status: 429, responseBody: 'Your project has exceeded its monthly spending cap.', message: 'boom' };
  const info = errorInfo(raw);
  assert.equal(info.status, 429);
  assert.equal(info.responseBody, raw.responseBody);
  assert.equal(info.message, 'boom');
});

test('errorInfo: 素の Error（status 無し）は status null', () => {
  const info = errorInfo(new Error('network down'));
  assert.equal(info.status, null);
  assert.equal(info.retryAfterMs, null);
  assert.equal(info.responseBody, null);
  assert.equal(info.message, 'network down');
});

test('errorInfo: オブジェクトでない値でも message を必ず文字列で返す', () => {
  assert.equal(errorInfo('plain string error').message, 'plain string error');
  assert.equal(errorInfo(null).status, null);
});

test('classifyFailure: 429 + spending cap 本文 → spend_cap（instanceof に頼らず素のオブジェクトで判定できる）', () => {
  const info = errorInfo({
    status: 429,
    responseBody: '{"code":429,"message":"Your project has exceeded its monthly spending cap. Please go to AI Studio...","status":"RESOURCE_EXHAUSTED"}',
  });
  assert.equal(classifyFailure(info), 'spend_cap');
});

test('classifyFailure: 429 + spending cap を含まない本文 → rate_limit', () => {
  const info = errorInfo({ status: 429, responseBody: 'Too many requests, please slow down.' });
  assert.equal(classifyFailure(info), 'rate_limit');
});

test('classifyFailure: 503 → server_error', () => {
  assert.equal(classifyFailure(errorInfo({ status: 503, responseBody: 'unavailable' })), 'server_error');
});

test('classifyFailure: 403 → auth', () => {
  assert.equal(classifyFailure(errorInfo({ status: 403, responseBody: 'forbidden' })), 'auth');
});
test('classifyFailure: 401 → auth', () => {
  assert.equal(classifyFailure(errorInfo({ status: 401, responseBody: 'unauthorized' })), 'auth');
});

test('classifyFailure: status 無し（fetch 自体の失敗・タイムアウト）や他の 4xx → other', () => {
  assert.equal(classifyFailure(errorInfo(new Error('AbortError: timeout'))), 'other');
  assert.equal(classifyFailure(errorInfo({ status: 400, responseBody: 'bad request' })), 'other');
  assert.equal(classifyFailure(errorInfo({ status: 404, responseBody: 'not found' })), 'other');
});

test('retryDecision: rate_limit / server_error は再試行し、retryAfterMs が大きければそちらを、120秒で頭打ちにする', () => {
  const small = retryDecision('rate_limit', 1, null);
  assert.equal(small.retry, true);
  assert.equal(small.waitMs, 15_000); // バックオフ[0]

  const withRetryAfter = retryDecision('rate_limit', 1, 200_000);
  assert.equal(withRetryAfter.retry, true);
  assert.equal(withRetryAfter.waitMs, 120_000); // 200000 は頭打ちで 120000 に

  const secondAttempt = retryDecision('server_error', 2, null);
  assert.equal(secondAttempt.waitMs, 45_000); // バックオフ[1]
});

test('retryDecision: 4 回目（RETRY_MAX_ATTEMPTS）の失敗はもう再試行しない', () => {
  assert.equal(retryDecision('rate_limit', 4, null).retry, false);
  assert.equal(retryDecision('server_error', 4, null).retry, false);
});

test('retryDecision: spend_cap / auth / other は再試行しない（attempt 1 でも）', () => {
  assert.equal(retryDecision('spend_cap', 1, null).retry, false);
  assert.equal(retryDecision('auth', 1, null).retry, false);
  assert.equal(retryDecision('other', 1, null).retry, false);
});

test('fatalAbortExcerpt: 本文（無ければ message）の先頭300字を redactSecret して返す', () => {
  const secret = 'AIzaSyTestKey123';
  const info = errorInfo({ status: 429, responseBody: `key=${secret} spending cap exceeded. ${'x'.repeat(400)}` });
  const excerpt = fatalAbortExcerpt(info, secret);
  assert.ok(!excerpt.includes(secret));
  assert.ok(excerpt.includes('[REDACTED]'));
  assert.ok(excerpt.length <= 300);

  const messageOnly = errorInfo(new Error(`no body here, key=${secret}`));
  const excerpt2 = fatalAbortExcerpt(messageOnly, secret);
  assert.ok(!excerpt2.includes(secret));
});
