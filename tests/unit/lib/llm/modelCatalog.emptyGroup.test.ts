// buildModelCatalog の「モデルが 1 件も無いグループは空の optgroup を作らず除外する」仕様の
// 回帰テスト（issue #127 PR2 レビュー対応）。
//
// PR1 時点ではこの除外ロジックは Anthropic グループ（当時は単価表に Claude モデルが無かった）で
// 常に踏まれていたが、PR2 で単価表に Claude 3 モデルを追加したことで 3 グループとも常に
// 非空になり、modelCatalog.test.ts 側では除外分岐（.filter で false になるケース）を
// 実運用データで再現できなくなった。この分岐は PR3（`azure_openai` グループを追加する。
// 追加直後はモデルが 0 件）で再び load-bearing になるため、単価表を差し替えたスタブで
// 分岐そのものを別ファイルとして固定しておく（このファイル専用に pricing.ts をモックするため、
// 他テストファイルの実データ検証とは影響し合わない）
jest.mock('../../../../src/lib/llm/pricing', () => ({
  MODEL_PRICING: {
    'gemini-x': { inputPerMillion: 1, outputPerMillion: 1 },
    'org/model': { inputPerMillion: 1, outputPerMillion: 1 },
  },
  MODEL_IMAGE_CAPABILITY: {
    'gemini-x': { provider: 'gemini', support: 'supported' },
    'org/model': { provider: 'openrouter', support: 'unsupported' },
  },
}));

import { buildModelCatalog } from '../../../../src/lib/llm/modelCatalog';

describe('buildModelCatalog（空グループの除外。PR3 の azure_openai 追加に向けた回帰保護）', () => {
  test('該当モデルが 1 件も無い Anthropic グループは空の optgroup を作らず結果から除外する', () => {
    const groups = buildModelCatalog();
    expect(groups.map((g) => g.label)).toEqual(['Gemini', 'OpenRouter']);
    expect(groups.find((g) => g.label === 'Anthropic')).toBeUndefined();
    expect(groups.every((g) => g.models.length > 0)).toBe(true);
  });
});
