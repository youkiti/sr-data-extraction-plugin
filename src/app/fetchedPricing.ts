// 実行前の見積もりに使う「取得した単価」の選び方（docs/ui-states.md §2「取得した単価で見積もる」）。
// 単価表に無いモデルだけが対象で、単価表を優先する判断は estimateCostUsd 側が持つ。
import type { ModelPricing } from '../lib/llm/pricing';
import type { AppState } from './store';

/** 保存済みの接続方式が一致する場合だけ取得単価を使う。 */
export function resolveFetchedPricing(
  state: Pick<AppState, 'llmProviderOverride' | 'fetchedModelPricing'>,
  model: string,
): ModelPricing | undefined {
  return state.llmProviderOverride === 'openrouter' ? state.fetchedModelPricing.openrouter?.[model] : undefined;
}
