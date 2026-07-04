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
  });
});
