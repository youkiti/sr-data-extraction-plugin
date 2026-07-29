// モデル候補カタログ（buildModelCatalog / isCatalogModel / missingApiKeyMessage）の単体テスト
import {
  buildModelCatalog,
  isCatalogModel,
  missingApiKeyMessage,
} from '../../../../src/lib/llm/modelCatalog';
import { MODEL_PRICING } from '../../../../src/lib/llm/pricing';

describe('buildModelCatalog', () => {
  test('単価表のモデルを Gemini / OpenRouter にグループ分けする', () => {
    const groups = buildModelCatalog();
    expect(groups.map((g) => g.label)).toEqual(['Gemini', 'OpenRouter']);
    const gemini = groups[0]!;
    const openrouter = groups[1]!;
    for (const model of gemini.models) {
      expect(model).not.toContain('/');
    }
    for (const model of openrouter.models) {
      expect(model).toContain('/');
    }
    // 単価表の全モデルがどちらかのグループに漏れなく載る
    const all = [...gemini.models, ...openrouter.models].sort();
    expect(all).toEqual(Object.keys(MODEL_PRICING).sort());
  });

  // 回帰テスト（issue #127 PR1）: buildModelCatalog は以前 `resolveProviderId`
  // （モデル名に `/` を含むか否かだけの推定）でグループ分けしていたため、
  // `/` を含まない非 Gemini モデル（例: 将来の Claude モデル）が「Gemini」optgroup へ
  // 紛れ込む実バグがあった。現在は `MODEL_IMAGE_CAPABILITY` の明示的な provider を出典にしており、
  // かつモデルが 1 件も無いグループ（PR1 時点の Anthropic）は結果から除外される。
  // PR2 で MODEL_PRICING に Claude モデルが追加されれば、このテストを変更しなくても
  // 自動的に 3 番目の 'Anthropic' グループが出るようになる（このテストはそれまで
  // 'Anthropic' が出ない = 空グループが描画されないことを固定する）
  test('空グループ（現状は Anthropic — 単価表にモデルが無い）は結果から除外される', () => {
    const groups = buildModelCatalog();
    expect(groups.find((g) => g.label === 'Anthropic')).toBeUndefined();
    expect(groups.every((g) => g.models.length > 0)).toBe(true);
  });
});

describe('isCatalogModel', () => {
  test('単価表のモデルは true、載っていないモデルと空文字は false', () => {
    expect(isCatalogModel('gemini-2.5-pro')).toBe(true);
    expect(isCatalogModel('qwen/qwen3-235b-a22b-2507')).toBe(true);
    expect(isCatalogModel('gemini-unknown')).toBe(false);
    expect(isCatalogModel('')).toBe(false);
  });
});

describe('missingApiKeyMessage', () => {
  test('プロバイダ別の未設定文言を返す', () => {
    expect(missingApiKeyMessage('gemini')).toBe(
      'Gemini API キーが未設定です。設定画面（Options）で保存してください',
    );
    expect(missingApiKeyMessage('openrouter')).toBe(
      'OpenRouter API キーが未設定です。設定画面（Options）で保存してください',
    );
    expect(missingApiKeyMessage('openai_compatible')).toBe(
      'OpenAI 互換 API キーが未設定です。設定画面（Options）で保存してください',
    );
    expect(missingApiKeyMessage('anthropic')).toBe(
      'Anthropic API キーが未設定です。設定画面（Options）で保存してください',
    );
  });
});
