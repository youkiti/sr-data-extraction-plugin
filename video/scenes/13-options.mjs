// チャプター13: 設定（BYOK・接続方式・レート制限）。help.html #options に対応。
//
// チャプター02（準備）は「初回セットアップとしてAPIキーを入れる」話に絞っているため、本章は
// 内容を重複させず、設定画面そのものの機能（接続方式の切替・reasoning effort・既定モデル・
// レート制限tier・表示言語）に寄せる。standalone の options/options.html を使う（02と同様）。

import { hoverSlow } from './lib/gestures.mjs';
import { loadCueDurations, sleepRemainder } from './lib/pacing.mjs';

export default {
  id: '13',
  slug: 'options',
  title: '設定（BYOK・接続方式・レート制限）',
  narration: '13-options',

  async run(ctx) {
    const durations = loadCueDurations('13-options');
    async function playCue(n, action) {
      const nn = String(n).padStart(2, '0');
      const t0 = Date.now();
      ctx.cue(n);
      if (action) await action();
      await sleepRemainder(ctx, t0, (durations[nn] ?? 3) * 1000 + 500);
    }

    await ctx.openExtensionPage('options/options.html');
    await ctx.page.locator('#llm-provider').waitFor({ state: 'visible', timeout: 15000 });
    await ctx.sleep(500);

    // cue 1: 接続方式を Gemini → OpenAI 互換 API へ切り替え、追加フィールドを見せる
    await playCue(1, async () => {
      await hoverSlow(ctx.page, ctx.page.locator('#llm-provider'), { durationMs: 500 });
      await ctx.page.locator('#llm-provider').selectOption('openai_compatible');
      await ctx.page.locator('#openai-compatible-fields').waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
      await hoverSlow(ctx.page, ctx.page.locator('#openai-compatible-fields'), { durationMs: 600 }).catch(() => {});
    });

    // cue 2: reasoning effort の既定値 + 既定モデル
    await playCue(2, async () => {
      await ctx.page.locator('#default-reasoning-effort').scrollIntoViewIfNeeded().catch(() => {});
      await hoverSlow(ctx.page, ctx.page.locator('#default-reasoning-effort'), { durationMs: 500 });
      await ctx.page.locator('#default-reasoning-effort').selectOption('medium').catch(() => {});
      await ctx.sleep(300);
      await hoverSlow(ctx.page, ctx.page.locator('#default-model'), { durationMs: 500 }).catch(() => {});
      await ctx.page.locator('#default-model').selectOption('gemini-3.5-flash').catch(() => {});
    });

    // cue 3: レート制限 tier を切り替え
    await playCue(3, async () => {
      await ctx.page.locator('#rate-limit-tier').scrollIntoViewIfNeeded().catch(() => {});
      await hoverSlow(ctx.page, ctx.page.locator('#rate-limit-tier'), { durationMs: 500 });
      await ctx.page.locator('#rate-limit-tier').selectOption('gemini_tier1').catch(() => {});
      await ctx.sleep(400);
      await hoverSlow(ctx.page, ctx.page.locator('#rate-limit-tier-desc'), { durationMs: 500 }).catch(() => {});
    });

    // cue 4: 表示言語を切り替え
    await playCue(4, async () => {
      await ctx.page.locator('#ui-language').scrollIntoViewIfNeeded().catch(() => {});
      await hoverSlow(ctx.page, ctx.page.locator('#ui-language'), { durationMs: 500 });
      await ctx.page.locator('#ui-language').selectOption('en').catch(() => {});
      await ctx.sleep(800);
    });
  },
};
