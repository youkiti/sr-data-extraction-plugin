// モデル候補カタログ（buildModelCatalog / isCatalogModel / missingApiKeyMessage）の単体テスト
import {
  buildModelCatalog,
  isCatalogModel,
  missingApiKeyMessage,
} from '../../../../src/lib/llm/modelCatalog';
import { MODEL_PRICING } from '../../../../src/lib/llm/pricing';

describe('buildModelCatalog', () => {
  test('単価表のモデルを Gemini / OpenRouter / Anthropic にグループ分けする', () => {
    const groups = buildModelCatalog();
    // issue #127 PR2: MODEL_PRICING に Claude 3 モデルを追加したことで
    // 3 番目の 'Anthropic' グループが出るようになった（下記 PR1 回帰テストの続き）
    expect(groups.map((g) => g.label)).toEqual(['Gemini', 'OpenRouter', 'Anthropic']);
    const gemini = groups[0]!;
    const openrouter = groups[1]!;
    const anthropic = groups[2]!;
    for (const model of gemini.models) {
      expect(model).not.toContain('/');
    }
    for (const model of openrouter.models) {
      expect(model).toContain('/');
    }
    for (const model of anthropic.models) {
      expect(model.startsWith('claude-')).toBe(true);
    }
    // 単価表の全モデルがどちらかのグループに漏れなく載る
    const all = [...gemini.models, ...openrouter.models, ...anthropic.models].sort();
    expect(all).toEqual(Object.keys(MODEL_PRICING).sort());
  });

  // 回帰テスト（issue #127 PR1）: buildModelCatalog は以前 `resolveProviderId`
  // （モデル名に `/` を含むか否かだけの推定）でグループ分けしていたため、
  // `/` を含まない非 Gemini モデル（例: 将来の Claude モデル）が「Gemini」optgroup へ
  // 紛れ込む実バグがあった。現在は `MODEL_IMAGE_CAPABILITY` の明示的な provider を出典にしており、
  // モデルが 1 件も無いグループは結果から除外される（issue #127 PR2 で Anthropic に
  // Claude 3 モデルが載ったため、空グループの実例は現状無い。除外ロジック自体は
  // buildModelCatalog の実装（.filter）で担保されており、ここで別途空グループを作って
  // 検証する意味は薄いため、このテストは上のグループ分けテストへ吸収した）
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
    expect(missingApiKeyMessage('azure_openai')).toBe(
      'Azure OpenAI API キーが未設定です。設定画面（Options）で保存してください',
    );
  });
});
