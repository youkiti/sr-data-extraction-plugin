import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveProviderId } from '../../../src/lib/llm/providerFactory';
import { FALLBACK_PRICING, MODELS, selectedModels } from './config';

test('モデル設定: Sonnet 5.5 は Anthropic のキーを使う', () => {
  assert.deepEqual(MODELS.find((model) => model.id === 'claude-sonnet-5-5'),
    { id: 'claude-sonnet-5-5', keyEnv: 'ANTHROPIC_API_KEY' });
});

test('モデル選択: 指定した Gemini と Sonnet だけを返す', () => {
  const previous = process.env.BENCH_MODELS;
  try {
    process.env.BENCH_MODELS = 'gemini-3.8-flash,claude-sonnet-5-5';
    assert.deepEqual(selectedModels().map((model) => model.id), ['gemini-3.8-flash', 'claude-sonnet-5-5']);
  } finally {
    if (previous === undefined) delete process.env.BENCH_MODELS;
    else process.env.BENCH_MODELS = previous;
  }
});

test('モデル選択: 未知のモデルは拒否する', () => {
  const previous = process.env.BENCH_MODELS;
  try {
    process.env.BENCH_MODELS = 'unknown-model';
    assert.throws(() => selectedModels(), /BENCH_MODELS/);
  } finally {
    if (previous === undefined) delete process.env.BENCH_MODELS;
    else process.env.BENCH_MODELS = previous;
  }
});

test('補助単価: Sonnet 5.5 の入力は 2 ドル、出力は 10 ドル', () => {
  assert.deepEqual(FALLBACK_PRICING['claude-sonnet-5-5'], { inputPerMillion: 2, outputPerMillion: 10 });
});

test('プロバイダ解決: Sonnet 5.5 は本番の Anthropic 経路を使う', () => {
  assert.equal(resolveProviderId('claude-sonnet-5-5'), 'anthropic');
});
