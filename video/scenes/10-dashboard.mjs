// チャプター10: ダッシュボード。help.html #dashboard に対応。
//
// #/dashboard のサマリ行（検証進捗・AI採用率・AI精度内訳・anchor失敗率・not_reported率）と
// study×section の進捗マトリクスを見せ、最後にセルをクリックして検証画面へ飛ぶところまで。

import { hoverSlow } from './lib/gestures.mjs';
import { loadCueDurations, sleepRemainder } from './lib/pacing.mjs';

export default {
  id: '10',
  slug: 'dashboard',
  title: 'ダッシュボード',
  narration: '10-dashboard',

  async run(ctx) {
    const durations = loadCueDurations('10-dashboard');
    async function playCue(n, action) {
      const nn = String(n).padStart(2, '0');
      const t0 = Date.now();
      ctx.cue(n);
      if (action) await action();
      await sleepRemainder(ctx, t0, (durations[nn] ?? 3) * 1000 + 500);
    }

    await ctx.openExtensionPage('app/app.html#/home');
    await ctx.page.locator('#app-nav .app__nav-link').first().waitFor({ state: 'visible', timeout: 15000 });
    await ctx.page.locator('#app-nav a[href="#/dashboard"]').click();
    await ctx.page.locator('#dashboard-matrix').waitFor({ state: 'visible', timeout: 15000 });
    await ctx.sleep(500);

    // cue 1: サマリ行
    await playCue(1, async () => {
      await hoverSlow(ctx.page, ctx.page.locator('#dashboard-summary'), { durationMs: 700 });
    });

    // cue 2: study×section の進捗マトリクス
    await playCue(2, async () => {
      await hoverSlow(ctx.page, ctx.page.locator('#dashboard-matrix'), { durationMs: 700 });
    });

    // cue 3: セルをクリックして検証画面へ
    await playCue(3, async () => {
      const cellLink = ctx.page.locator('#dashboard-matrix a').first();
      await hoverSlow(ctx.page, cellLink, { durationMs: 500 });
      await cellLink.click().catch(() => {});
      await ctx.sleep(1200);
    });
  },
};
