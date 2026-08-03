// チャプター12: エクスポート。help.html #export に対応。
//
// #/export の3形式（study_wide/results_long/audit）+ Rセット、論文Methods記載例カード、
// プレビューと除外文献の注記、未検証セル残存時の警告、の順に見せる。

import { hoverSlow, hoverSequence } from './lib/gestures.mjs';
import { loadCueDurations, sleepRemainder } from './lib/pacing.mjs';

export default {
  id: '12',
  slug: 'export',
  title: 'エクスポート',
  narration: '12-export',

  async run(ctx) {
    const durations = loadCueDurations('12-export');
    async function playCue(n, action) {
      const nn = String(n).padStart(2, '0');
      const t0 = Date.now();
      ctx.cue(n);
      if (action) await action();
      await sleepRemainder(ctx, t0, (durations[nn] ?? 3) * 1000 + 500);
    }

    await ctx.openExtensionPage('app/app.html#/home');
    await ctx.page.locator('#app-nav .app__nav-link').first().waitFor({ state: 'visible', timeout: 15000 });
    await ctx.page.locator('#app-nav a[href="#/export"]').click();
    await ctx.page.locator('#export-format').waitFor({ state: 'visible', timeout: 15000 });
    await ctx.sleep(500);

    // cue 1: 3形式（study_wide/results_long/audit）
    await playCue(1, async () => {
      await hoverSequence(
        ctx.page,
        [
          ctx.page.locator('.export__format-option').nth(0),
          ctx.page.locator('.export__format-option').nth(1),
          ctx.page.locator('.export__format-option').nth(2),
        ],
        { holdMs: 350, moveMs: 350 },
      );
    });

    // cue 2: 論文 Methods 記載例カード
    await playCue(2, async () => {
      await hoverSlow(ctx.page, ctx.page.locator('#export-methods'), { durationMs: 500 });
      await ctx.page.locator('#methods-lang-ja').click().catch(() => {});
      await ctx.sleep(400);
      await ctx.page.locator('#methods-workflow-dual').click().catch(() => {});
      await ctx.sleep(400);
    });

    // cue 3: プレビューと除外文献の注記
    await playCue(3, async () => {
      await hoverSlow(ctx.page, ctx.page.locator('#export-preview'), { durationMs: 500 }).catch(() => {});
      await hoverSlow(ctx.page, ctx.page.locator('#export-skipped'), { durationMs: 500 }).catch(() => {});
    });

    // cue 4: 生成 → 未検証セル残存の警告
    await playCue(4, async () => {
      await hoverSlow(ctx.page, ctx.page.locator('#export-generate'), { durationMs: 500 });
      await ctx.page.locator('#export-generate').click();
      await ctx.page.locator('#export-warning').waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
      await hoverSlow(ctx.page, ctx.page.locator('#export-warning'), { durationMs: 500 }).catch(() => {});
    });

    // cue 5: Rセットを選び、ファイル一覧・ma.csv プレビューを見せる
    await playCue(5, async () => {
      await ctx.page.locator('input[name="export-format"][value="r_set"]').check();
      await ctx.page.locator('#export-rset-summary, .export__preview-wrap').first().waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
      await ctx.sleep(400);
      await hoverSlow(ctx.page, ctx.page.locator('.export__preview-wrap').first(), { durationMs: 600 }).catch(() => {});
    });
  },
};
