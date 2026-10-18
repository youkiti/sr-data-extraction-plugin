// 公開する全ファイルを走査し、非公開設定の値と機密情報らしい形の混入を止める。
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { loadLocalConfig, localConfigPath } from './localConfig';

// 以下はソース内の関数名・定数名・メトリクス名であり、外部ファイルの識別子ではない。
const safeIdentifiers = new Set([
  'BENCHMARK_PAGE_IMAGE_RENDER_SCALE', 'DECISION_THRESHOLD_POINTS',
  'DRAFT_SCHEMA_PROMPT_VERSION', 'DRAFT_SCHEMA_RESPONSE_SCHEMA', 'DRAFT_SCHEMA_SYSTEM_PROMPT',
  'EXTRACT_DATA_PROMPT_VERSION', 'EXTRACT_DATA_RESPONSE_SCHEMA', 'EXTRACT_DATA_SYSTEM_PROMPT',
  'RELOCATE_QUOTE_RESPONSE_SCHEMA', 'RELOCATE_QUOTE_SYSTEM_PROMPT',
  'bestNotReportedSensitivity', 'bestNotReportedSpecificity',
  'currentNotReportedSensitivity', 'currentNotReportedSpecificity',
  'buildDraftSchemaUserPrompt', 'buildExtractDataSystemPrompt', 'buildExtractDataUserContent',
  'buildExtractDataUserPrompt', 'buildRelocateQuoteUserPrompt', 'extractDataResponseSchema',
  'parseRelocateQuoteResponse', 'selectRelocateQuoteWindow', 'improvementNotSingleStudy',
  'notReportedSpecificityNotWorse', 'overallAccuracyNonInferior5pp',
]);
// 相対パスの構成要素・使用量 API のキー・架空 run ID は公開可能な固定文字列。
const safeStrings = new Set([
  'benchmark-schema-outcome-', 'dataset1_conventional_n-shot', 'original_description_insomnia',
  'extraction-benchmark-real', 'runs-v10-issue275-20260930',
  'cache_creation_input_tokens', 'model__text_only__pdf__r1',
]);

interface PrivateValue {
  key: string;
  value: string;
}

/** 項目 ID は公開済みなので照合せず、具体的な入力と指示文をすべて照合する。 */
function privateValues(value: unknown, key = '$'): PrivateValue[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => privateValues(entry, `${key}[${index}]`));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([name, entry]) => privateValues(entry, `${key}.${name}`));
  }
  if (typeof value === 'string' && (key.startsWith('$.outcome.') || key.startsWith('$.testFixtures.') ||
      /\.(pdfId|file|cleanDir|pdfDir|cachePdfId|jevPdfId|instruction|extractionInstruction)$/.test(key) ||
      // 選択肢の一覧全体は照合する。個々の特殊値（NA・Other など）は一般語なので照合しない。
      /\.allowedValues$/.test(key) ||
      /\.(papers|robTargets)\[\d+\]$/.test(key))) {
    return [{ key, value }];
  }
  return [];
}

/** 診断には位置と設定キーだけを出し、検出した機密値は表示しない。 */
function violations(text: string, concrete: readonly PrivateValue[] = []): string[] {
  const found: string[] = [];
  const patterns: Array<[string, RegExp]> = [
    ['文献識別子', /PMC\d{5,}/g],
    // URL スキームや entity_key 用の正規表現の末尾をドライブ文字と取り違えない。
    ['絶対パス', /(?<![A-Za-z0-9_])[A-Za-z]:[\\/]/g],
    ['利用者名', new RegExp(['you', 'ki'].join(''), 'gi')],
    ['論文 ID', /[A-Z][a-z]+(?:19|20)\d{2}/g],
    ['Drive 識別子候補', /[A-Za-z0-9_-]{25,}/g],
  ];
  for (const [label, pattern] of patterns) {
    for (const match of text.matchAll(pattern)) {
      if (label === 'Drive 識別子候補' &&
          (safeIdentifiers.has(match[0]) || safeStrings.has(match[0]))) {
        continue;
      }
      found.push(`${label}: 行 ${text.slice(0, match.index).split('\n').length}`);
    }
  }
  for (const entry of concrete) {
    const escaped = JSON.stringify(entry.value).slice(1, -1);
    if (text.includes(entry.value) || text.includes(escaped)) {
      found.push(`ローカル設定: ${entry.key}`);
    }
  }
  return found;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    // リンク先を検査対象外にしてしまう抜け道を作らない。
    assert.ok(!entry.isSymbolicLink(), `公開ソースにリンクがあります: ${entry.name}`);
    return entry.isDirectory() ? sourceFiles(file) : [file];
  });
}

test('公開ソース全体に非公開の値がない', () => {
  const dir = fileURLToPath(new URL('.', import.meta.url));
  let concrete: PrivateValue[] = [];
  if (existsSync(localConfigPath)) {
    concrete = privateValues(loadLocalConfig());
    assert.ok(concrete.length > 0);
  } else {
    console.log('ローカル設定が無いので具体的な値の照合は飛ばした');
  }
  const found = sourceFiles(dir).flatMap((file) =>
    violations(readFileSync(file, 'utf8'), concrete).map((message) => `${path.relative(dir, file)}: ${message}`));
  assert.deepEqual(found, []);
});

test('禁止形の各分類とローカル指示文を検出する', () => {
  const samples: Array<[string, string]> = [
    ['文献識別子', ['PM', 'C', '123456'].join('')],
    ['絶対パス', ['Q', ':', '/', 'private'].join('')],
    ['絶対パス', ['Q', ':', '\\', 'private'].join('')],
    ['利用者名', ['you', 'ki'].join('')],
    ['論文 ID', ['Fiction', '2020'].join('')],
    ['Drive 識別子候補', 'aB_9-'.repeat(6)],
  ];
  for (const [label, sample] of samples) {
    assert.ok(violations(sample).some((message) => message.startsWith(label)), label);
  }
  const instruction = ['架空の', '非公開指示文'].join('');
  assert.ok(violations(instruction, [{ key: '$.instruction', value: instruction }]).length > 0);
  assert.equal(violations('paper-a / relative/pdf / short-id').length, 0);
  assert.equal(violations('https://example.invalid / arm:' + '\\d+').length, 0);
  assert.equal(violations('EXTRACT_DATA_PROMPT_VERSION').length, 0);
  const nested = { probes: { cachePdfId: 'paper-a', multiSelect: { papers: ['paper-b'], fields: [{ instruction }] } } };
  assert.equal(privateValues(nested).length, 3);
});
