// モデル選択プルダウンの候補カタログ（単価表 MODEL_PRICING が正典）。
// app の S5 / S6 / S7 と Options の既定モデルセレクタが共有する
// （docs/ui-states.md §2「モデルセレクタ」）
import type { LlmProviderId } from '../../domain/llmApiLog';
import { MODEL_PRICING } from './pricing';
import { resolveProviderId } from './providerFactory';

export interface ModelCatalogGroup {
  /** optgroup の表示ラベル */
  label: 'Gemini' | 'OpenRouter';
  models: readonly string[];
}

/** 単価表のモデル ID をプロバイダ別（`/` の有無）にグループ分けする */
export function buildModelCatalog(): readonly ModelCatalogGroup[] {
  const gemini: string[] = [];
  const openrouter: string[] = [];
  for (const model of Object.keys(MODEL_PRICING)) {
    (resolveProviderId(model) === 'openrouter' ? openrouter : gemini).push(model);
  }
  return [
    { label: 'Gemini', models: gemini },
    { label: 'OpenRouter', models: openrouter },
  ];
}

/** 単価表に載っているモデルか（載っていなければセレクタは「その他」で表示する） */
export function isCatalogModel(model: string): boolean {
  return model in MODEL_PRICING;
}

/** API キー未設定エラーの共通文言（S5 / S6 / S7 のサービス層で共用） */
export function missingApiKeyMessage(provider: LlmProviderId): string {
  const label = provider === 'openrouter' ? 'OpenRouter' : 'Gemini';
  return `${label} API キーが未設定です。設定画面（Options）で保存してください`;
}
