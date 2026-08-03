// チャプター11: 独立二重レビューと裁定。help.html #dual-review に対応。
//
// #/home のレビュアー管理カード → #/adjudicate の一覧 → 裁定開始（群構成突き合わせ・
// 不一致セルの個別裁定・一括採用）→ レビュアー間一致度（κ）の順に見せる。
// study 1（Halvorsen 2026）が独立二重レビュー済み・裁定 ready（κ 0.96・不一致1件）。

import { hoverSlow } from './lib/gestures.mjs';
import { loadCueDurations, sleepRemainder } from './lib/pacing.mjs';

export default {
  id: '11',
  slug: 'dual-review',
  title: '独立二重レビューと裁定',
  narration: '11-dual-review',

  async run(ctx) {
    const durations = loadCueDurations('11-dual-review');
    async function playCue(n, action) {
      const nn = String(n).padStart(2, '0');
      const t0 = Date.now();
      ctx.cue(n);
      if (action) await action();
      await sleepRemainder(ctx, t0, (durations[nn] ?? 3) * 1000 + 500);
    }

    await ctx.openExtensionPage('app/app.html#/home');
    await ctx.page.locator('#app-nav .app__nav-link').first().waitFor({ state: 'visible', timeout: 15000 });
    await ctx.sleep(500);

    // cue 1: Home のレビュアー管理カード（登録済み2名・review_mode）
    await playCue(1, async () => {
      await hoverSlow(ctx.page, ctx.page.locator('h3', { hasText: 'レビュアー管理' }).locator('..'), {
        durationMs: 700,
      }).catch(async () => {
        await hoverSlow(ctx.page, ctx.page.locator('table').first(), { durationMs: 700 });
      });
    });

    // cue 2: 裁定一覧 → 裁定を開始 → 群構成の突き合わせ
    await playCue(2, async () => {
      await ctx.page.locator('#app-nav a[href="#/adjudicate"]').click();
      await ctx.page.locator('#adjudicate-list').waitFor({ state: 'visible', timeout: 15000 });
      await hoverSlow(ctx.page, ctx.page.locator('#adjudicate-list tr', { hasText: 'Halvorsen' }), {
        durationMs: 500,
      });
      await ctx.page.getByRole('button', { name: '裁定を開始' }).click();
      await ctx.page.locator('#adjudicate-arm-card').waitFor({ state: 'visible', timeout: 10000 });
      await hoverSlow(ctx.page, ctx.page.locator('#adjudicate-arm-card'), { durationMs: 600 });
    });

    // cue 3: 不一致セル一覧 → 一括採用ボタン
    await playCue(3, async () => {
      await ctx.page.locator('#adjudicate-cells').waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
      await hoverSlow(ctx.page, ctx.page.locator('#adjudicate-cells'), { durationMs: 600 }).catch(() => {});
      await hoverSlow(ctx.page, ctx.page.locator('#adjudicate-accept-all'), { durationMs: 500 }).catch(() => {});
    });

    // cue 4: 一覧に戻る → 一致度を計算 → κ・不一致セル一覧
    await playCue(4, async () => {
      await ctx.page.locator('#adjudicate-back').click().catch(() => {});
      await ctx.sleep(500);
      await ctx.page.getByRole('button', { name: '一致度を計算' }).click();
      await ctx.page.locator('#agreement-table').waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
      await hoverSlow(ctx.page, ctx.page.locator('#agreement-table'), { durationMs: 600 }).catch(() => {});
      await hoverSlow(ctx.page, ctx.page.locator('#agreement-disagreements'), { durationMs: 500 }).catch(() => {});
    });
  },
};
