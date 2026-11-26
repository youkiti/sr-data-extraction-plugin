// extraction-benchmark-real/src/publicSafety.test.ts の公開走査をローカル設定なしで移植。
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { benchRoot } from './config';

// 公開済みの関数名・定数・フィールド名だけを明示する。ハッシュや外部 ID は追加しない。
const safe = new Set([
  'cochrane-numeric-benchmark', 'extraction-benchmark-real', 'EXTRACT_DATA_PROMPT_VERSION',
  'EXTRACT_DATA_TEMPERATURE', 'REPORT_FALLBACK_PRICING', 'buildExtractDataSystemPrompt',
  'buildExtractDataUserContent', 'extractDataResponseSchema', 'parseExtractDataResponse',
  'ExtractDataOutcomeListEntry', 'answerRateNotInDocuments', 'BENCH_COST_LIMIT_USD',
  'experimental_intervention',
  'notReturnedNotInDocuments', 'elapsedMsSuccessfulRunMedian', 'elapsedMsSuccessfulRunMean',
  'elapsedMsPerRequestMedian', 'recheck-labels.jsonl',
  'ChildProcessWithoutNullStreams', 'subscription_not_computable',
  'tokensUnmeasuredAttempts',
]);
export function violations(text: string): string[] {
  const found: string[] = [];
  const patterns: [string, RegExp][] = [
    ['文献識別子', /PMC\d{5,}/g], ['絶対パス', /(?<![A-Za-z0-9_])[A-Za-z]:[\\/]/g],
    ['利用者名', new RegExp(['you', 'ki'].join(''), 'gi')], ['長い識別子', /[A-Za-z0-9_-]{25,}/g],
  ];
  for (const [label, pattern] of patterns) for (const match of text.matchAll(pattern)) {
    if (label === '長い識別子' && safe.has(match[0])) continue;
    found.push(`${label}: 行 ${text.slice(0, match.index).split('\n').length}`);
  }
  return found;
}
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    assert.ok(!entry.isSymbolicLink(), '公開ソース内のリンクは許容しません');
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : [file];
  });
}
test('公開予定ソースとマニフェスト・README に非公開情報がない', () => {
  const files = [...sourceFiles(path.join(benchRoot, 'src')), ...['package.json', 'tsconfig.json', 'README.md'].map((name) => path.join(benchRoot, name))];
  assert.deepEqual(files.flatMap((file) => violations(readFileSync(file, 'utf8')).map((message) => `${path.relative(benchRoot, file)}: ${message}`)), []);
});
test('禁止形と安全な公開識別子を区別する', () => {
  for (const sample of [['PM', 'C', '123456'].join(''), ['Q', ':', '/', 'secret'].join(''),
    ['Q', ':', '\\', 'secret'].join(''), ['you', 'ki'].join(''), 'aB_9-'.repeat(6)]) assert.ok(violations(sample).length);
  assert.deepEqual(violations('EXTRACT_DATA_PROMPT_VERSION'), []);
});
