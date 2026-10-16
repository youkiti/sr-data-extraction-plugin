import { resolveFetchedPricing } from '../../../src/app/fetchedPricing';
import { createInitialState } from '../../../src/app/store';
import { estimateCostUsd } from '../../../src/lib/llm/pricing';
import { estimateAskPaperCost } from '../../../src/features/verification/askPaper';
import { estimateForQuestion } from '../../../src/app/services/askPaperService';

const pricing = { inputPerMillion: 0.1, outputPerMillion: 0.4, cachedInputPerMillion: 0.01 };

test('保存済み接続方式が OpenRouter のときだけ取得単価を使う', () => {
  const state = createInitialState();
  state.fetchedModelPricing = { openrouter: { custom: pricing } };
  for (const provider of [null, 'gemini', 'anthropic', 'openai_compatible', 'local_llm', 'azure_openai'] as const) {
    state.llmProviderOverride = provider;
    expect(estimateCostUsd('custom', 1_000_000, 1_000_000, null, resolveFetchedPricing(state, 'custom'))).toBeNull();
  }
  state.llmProviderOverride = 'openrouter';
  expect(resolveFetchedPricing(state, 'missing')).toBeUndefined();
  expect(estimateCostUsd('custom', 1_000_000, 1_000_000, 500_000, resolveFetchedPricing(state, 'custom')))
    .toBeCloseTo(0.455, 12);
  expect(estimateCostUsd('gemini-2.0-flash', 1_000_000, 1_000_000, null,
    { inputPerMillion: 99, outputPerMillion: 99 })).toBe(0.5);
  expect(estimateCostUsd('free', 1_000_000, 1_000_000, null,
    { inputPerMillion: 0, outputPerMillion: 0 })).toBe(0);
});

test('質問の概算にも取得単価を渡す', () => {
  const input = { model: 'custom', prefixChars: 0, historyChars: 0, questionChars: 0 };
  const result = estimateAskPaperCost({ ...input, fallbackPricing: pricing });
  expect(result.costUsd).toBeCloseTo(result.tokensIn * 0.0000001 + 0.00024, 12);
  const state = createInitialState();
  state.llmProviderOverride = 'openrouter';
  state.fetchedModelPricing = { openrouter: { custom: pricing } };
  const estimate = estimateForQuestion({
    spreadsheetId: 's', documents: [], fields: [], history: [], question: '',
  }, 'custom', state);
  expect(estimate.costUsd).toBeCloseTo(estimate.tokensIn * 0.0000001 + 0.00024, 12);
});
