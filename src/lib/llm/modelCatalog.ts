// モデル選択プルダウンの候補カタログ（単価表 MODEL_PRICING が正典）。
// app の S5 / S6 / S7 と Options の既定モデルセレクタが共有する
// （docs/ui-states.md §2「モデルセレクタ」）
import type { LlmProviderId } from '../../domain/llmApiLog';
import { MODEL_IMAGE_CAPABILITY, MODEL_PRICING } from './pricing';

// モデル単位の画像入力対応可否（画像非対応モデルの実行ブロック）は lib/llm/pricing.ts の
// `resolveModelImageInputSupport` / `MODEL_IMAGE_CAPABILITY`（MODEL_PRICING と同じ「カタログ」）を
// 直接 import する（providerFactory.ts / planRun.ts / extractService.ts）。ここでは re-export しない
// （誰も経由しない re-export はカバレッジ 100% 強制のもとで到達不能な余剰コードになるため）

export interface ModelCatalogGroup {
  /** optgroup の表示ラベル */
  label: 'Gemini' | 'OpenRouter' | 'Anthropic';
  models: readonly string[];
}

/**
 * optgroup のグループ分け順序（表示順そのもの）。
 * 以前は `resolveProviderId`（モデル名に `/` を含むか否かだけの推定）でグループ分けしていたが、
 * `resolveProviderId('claude-opus-5')` は `/` を含まないため `'gemini'` を返してしまい、
 * 単価表に Claude モデルを足した瞬間に「Gemini」optgroup へ紛れ込む実バグがあった（issue #127）。
 * ここでは `MODEL_IMAGE_CAPABILITY`（`MODEL_PRICING` と 1:1 対応することを pricing.test.ts が保証
 * 済みのカタログ）が持つ実測 provider を、モデル名からの推定ではなく明示的な出典として使う。
 * `'anthropic'` は PR1 時点では単価表にモデルが無いため常に空グループになり、
 * `buildModelCatalog` 側で除外される（下記）。PR2 で `MODEL_PRICING` に Claude モデルが載れば
 * このコードを変更しなくても自動的に Anthropic optgroup が出るようになる
 */
const CATALOG_GROUP_ORDER: ReadonlyArray<{
  provider: LlmProviderId;
  label: ModelCatalogGroup['label'];
}> = [
  { provider: 'gemini', label: 'Gemini' },
  { provider: 'openrouter', label: 'OpenRouter' },
  { provider: 'anthropic', label: 'Anthropic' },
];

/**
 * 単価表のモデル ID を `MODEL_IMAGE_CAPABILITY` の実測 provider でグループ分けする。
 * モデルが 1 件も無いグループ（現状は Anthropic。PR1 時点では単価表未収載）は
 * 空の `<optgroup>` を描画しないよう結果から除外する
 */
export function buildModelCatalog(): readonly ModelCatalogGroup[] {
  return CATALOG_GROUP_ORDER.map(({ provider, label }) => ({
    label,
    models: Object.keys(MODEL_PRICING).filter(
      (model) => MODEL_IMAGE_CAPABILITY[model]?.provider === provider,
    ),
  })).filter((group) => group.models.length > 0);
}

/** 単価表に載っているモデルか（載っていなければセレクタは「その他」で表示する） */
export function isCatalogModel(model: string): boolean {
  return model in MODEL_PRICING;
}

/** API キー未設定エラーの共通文言（S5 / S6 / S7 のサービス層で共用） */
export function missingApiKeyMessage(provider: LlmProviderId): string {
  const label =
    provider === 'openrouter'
      ? 'OpenRouter'
      : provider === 'openai_compatible'
        ? 'OpenAI 互換'
        : provider === 'anthropic'
          ? 'Anthropic'
          : provider === 'azure_openai'
            ? 'Azure OpenAI'
            : 'Gemini';
  return `${label} API キーが未設定です。設定画面（Options）で保存してください`;
}
