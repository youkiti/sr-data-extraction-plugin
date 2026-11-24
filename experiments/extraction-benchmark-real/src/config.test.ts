import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveProviderId } from '../../../src/lib/llm/providerFactory';
import { assertRunLabelAvailable, FALLBACK_PRICING, MODELS, selectedModels } from './config';

test('モデル設定: Sonnet 5.5 は Anthropic のキーを使う', () => {
  assert.deepEqual(MODELS.find((model) => model.id === 'claude-sonnet-5-5'),
    { id: 'claude-sonnet-5-5', keyEnv: 'ANTHROPIC_API_KEY' });
});

for (const raw of [undefined, '', '   ']) {
  test(`モデル選択: ${raw === undefined ? '未設定' : raw === '' ? '空文字' : '空白のみ'}なら Gemini の４モデルだけを返す`, () => {
    const previous = process.env.BENCH_MODELS;
    try {
      if (raw === undefined) delete process.env.BENCH_MODELS;
      else process.env.BENCH_MODELS = raw;
      assert.deepEqual(selectedModels().map((model) => model.id), [
        'gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-3.8-flash', 'gemini-3.5-flash-lite',
      ]);
    } finally {
      if (previous === undefined) delete process.env.BENCH_MODELS;
      else process.env.BENCH_MODELS = previous;
    }
  });
}

test('実行ラベル: Gemini だけなら未設定でも通る', () => {
  assert.doesNotThrow(() => assertRunLabelAvailable(['gemini-3.8-flash'], undefined));
});

for (const raw of [undefined, '', 'v9-20260921']) {
  test(`実行ラベル: Sonnet を含み${raw === undefined ? '未設定' : raw === '' ? '空文字' : '既定値'}なら拒否する`, () => {
    assert.throws(() => assertRunLabelAvailable(['gemini-3.8-flash', 'claude-sonnet-5-5'], raw), {
      message: 'Anthropic のモデルを含む実行では、前回の run と分けるため BENCH_RUN_LABEL を明示してください（例: v17-20261125）',
    });
  });
}

test('実行ラベル: Sonnet を含んでも別のラベルを明示すれば通る', () => {
  assert.doesNotThrow(() => assertRunLabelAvailable(['claude-sonnet-5-5'], 'v17-20261125'));
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
