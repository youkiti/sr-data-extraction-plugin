// モデル別単価表と概算コスト計算の単体テスト（sr-query-builder から流用）
import {
  APPROX_IMAGE_TOKENS_PER_PAGE,
  estimateCostUsd,
  MODEL_IMAGE_CAPABILITY,
  MODEL_PRICING,
  resolveModelImageInputSupport,
} from '../../../../src/lib/llm/pricing';

describe('estimateCostUsd', () => {
  it('gemini-2.5-pro は入力 $1.25 / 出力 $10.00 per 1M で概算する', () => {
    // 1,000,000 入力 + 500,000 出力 = 1.25 + 5.00 = 6.25 USD
    expect(estimateCostUsd('gemini-2.5-pro', 1_000_000, 500_000)).toBeCloseTo(6.25, 10);
  });

  it('単価表に無いモデルは null', () => {
    expect(estimateCostUsd('gpt-5', 1000, 1000)).toBeNull();
  });

  it('トークン数が両方 null なら null', () => {
    expect(estimateCostUsd('gemini-2.5-pro', null, null)).toBeNull();
  });

  it('片方だけ取れていれば取れた側のみで概算する', () => {
    // 入力のみ 1M → 1.25 USD
    expect(estimateCostUsd('gemini-2.5-pro', 1_000_000, null)).toBeCloseTo(1.25, 10);
    // 出力のみ 1M → 10.00 USD
    expect(estimateCostUsd('gemini-2.5-pro', null, 1_000_000)).toBeCloseTo(10.0, 10);
  });

  it('gemini-3.5-flash は概算コストを返す', () => {
    expect(estimateCostUsd('gemini-3.5-flash', 1_000_000, 1_000_000)).not.toBeNull();
  });

  it('gemini-3.6-flash は概算コストを返す', () => {
    expect(estimateCostUsd('gemini-3.6-flash', 1_000_000, 1_000_000)).not.toBeNull();
  });

  it('gemini-3.5-flash-lite は概算コストを返す', () => {
    expect(estimateCostUsd('gemini-3.5-flash-lite', 1_000_000, 1_000_000)).not.toBeNull();
  });

  it('qwen/qwen3-235b-a22b-2507 は概算コストを返す', () => {
    expect(estimateCostUsd('qwen/qwen3-235b-a22b-2507', 1_000_000, 0)).not.toBeNull();
  });

  it('deepseek/deepseek-v4-flash は概算コストを返す', () => {
    expect(estimateCostUsd('deepseek/deepseek-v4-flash', 0, 1_000_000)).not.toBeNull();
  });

  it('gemini-2.5-pro が単価表に存在する', () => {
    expect(MODEL_PRICING['gemini-2.5-pro']).toEqual({
      inputPerMillion: 1.25,
      outputPerMillion: 10.0,
    });
  });

  it('画像 1 ページあたりの概算トークン単価（pdf_native）は 1,100', () => {
    expect(APPROX_IMAGE_TOKENS_PER_PAGE).toBe(1_100);
  });

  // issue #127 PR2: docs/requirements.md §10 Q11 で確認済みの Anthropic 3 モデルの単価転記
  it('claude-opus-5 は入力 $5.00 / 出力 $25.00 per 1M で概算する', () => {
    expect(MODEL_PRICING['claude-opus-5']).toEqual({ inputPerMillion: 5.0, outputPerMillion: 25.0 });
    // 1,000,000 入力 + 1,000,000 出力 = 5.00 + 25.00 = 30.00 USD
    expect(estimateCostUsd('claude-opus-5', 1_000_000, 1_000_000)).toBeCloseTo(30.0, 10);
  });

  it('claude-sonnet-5 は入力 $3.00 / 出力 $15.00 per 1M（導入価格ではなく通常価格）で概算する', () => {
    expect(MODEL_PRICING['claude-sonnet-5']).toEqual({ inputPerMillion: 3.0, outputPerMillion: 15.0 });
    expect(estimateCostUsd('claude-sonnet-5', 1_000_000, 1_000_000)).toBeCloseTo(18.0, 10);
  });

  it('claude-haiku-4-5 は入力 $1.00 / 出力 $5.00 per 1M で概算する', () => {
    expect(MODEL_PRICING['claude-haiku-4-5']).toEqual({ inputPerMillion: 1.0, outputPerMillion: 5.0 });
    expect(estimateCostUsd('claude-haiku-4-5', 1_000_000, 1_000_000)).toBeCloseTo(6.0, 10);
  });
});

describe('resolveModelImageInputSupport（画像非対応モデルの実行ブロック）', () => {
  it('MODEL_PRICING の全モデルが MODEL_IMAGE_CAPABILITY に明示エントリを持つ（新モデル追加時の更新漏れ防止）', () => {
    for (const model of Object.keys(MODEL_PRICING)) {
      expect(MODEL_IMAGE_CAPABILITY[model]).toBeDefined();
    }
    // カタログの件数も一致させる（余剰エントリの検出）
    expect(Object.keys(MODEL_IMAGE_CAPABILITY).sort()).toEqual(Object.keys(MODEL_PRICING).sort());
  });

  it('Gemini 系モデルは gemini provider で supported', () => {
    expect(resolveModelImageInputSupport('gemini', 'gemini-2.5-pro')).toBe('supported');
    expect(resolveModelImageInputSupport('gemini', 'gemini-3.5-flash')).toBe('supported');
  });

  it('実測 404 の qwen3-235b / deepseek-v4-flash は openrouter provider で unsupported', () => {
    expect(resolveModelImageInputSupport('openrouter', 'qwen/qwen3-235b-a22b-2507')).toBe(
      'unsupported',
    );
    expect(resolveModelImageInputSupport('openrouter', 'deepseek/deepseek-v4-flash')).toBe(
      'unsupported',
    );
  });

  it('Anthropic 3 モデルは anthropic provider で supported（issue #127 PR2）', () => {
    expect(resolveModelImageInputSupport('anthropic', 'claude-opus-5')).toBe('supported');
    expect(resolveModelImageInputSupport('anthropic', 'claude-sonnet-5')).toBe('supported');
    expect(resolveModelImageInputSupport('anthropic', 'claude-haiku-4-5')).toBe('supported');
  });

  it('カタログ外のモデルは unknown', () => {
    expect(resolveModelImageInputSupport('gemini', 'mystery-model')).toBe('unknown');
    expect(resolveModelImageInputSupport('openrouter', 'mystery/model')).toBe('unknown');
  });

  it('接続方式 override で実測と異なる provider から呼ばれた場合は unknown（実測が無いため断定しない）', () => {
    // qwen3-235b は openrouter での実測（404）のみ。openai_compatible 経由で同じモデル名を
    // 叩いても実測が無いため unknown に倒す
    expect(resolveModelImageInputSupport('openai_compatible', 'qwen/qwen3-235b-a22b-2507')).toBe(
      'unknown',
    );
    // gemini-2.5-pro を openrouter 経由（google/gemini-2.5-pro 等ではなくモデル名そのまま送る
    // ローカル互換サーバ等を想定）で叩く場合も実測が無いため unknown
    expect(resolveModelImageInputSupport('openrouter', 'gemini-2.5-pro')).toBe('unknown');
  });
});
