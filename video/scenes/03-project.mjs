// チャプター03: プロジェクトを作る・開く。help.html #project に対応。
//
// popup.html（プロジェクト選択画面）で新規作成・最近のプロジェクト・スプレッドシート
// ID/URL で開く・tiab-review 引き継ぎの導線を見せたあと、最近のプロジェクトをクリックして
// 実際にメインビュー（#/home）へ遷移するところまでを収録する。

import { hoverSlow } from './lib/gestures.mjs';
import { loadCueDurations, sleepRemainder } from './lib/pacing.mjs';

export default {
  id: '03',
  slug: 'project',
  title: 'プロジェクトを作る・開く',
  narration: '03-project',

  async run(ctx) {
    const durations = loadCueDurations('03-project');
    async function playCue(n, action) {
      const nn = String(n).padStart(2, '0');
      const t0 = Date.now();
      ctx.cue(n);
      if (action) await action();
      await sleepRemainder(ctx, t0, (durations[nn] ?? 3) * 1000 + 500);
    }

    await ctx.openExtensionPage('popup/popup.html');
    await ctx.page.locator('#popup-recent-section').waitFor({ state: 'visible', timeout: 15000 });
    await ctx.sleep(500);

    // cue 1: 1プロジェクト = 1 SR（画面全体を俯瞰させるため account セクションをホバー）
    await playCue(1, async () => {
      await hoverSlow(ctx.page, ctx.page.locator('#popup-account'), { durationMs: 600 });
    });

    // cue 2: 新規プロジェクト
    await playCue(2, async () => {
      await hoverSlow(ctx.page, ctx.page.locator('#popup-create-title'), { durationMs: 600 });
    });

    // cue 3: 最近のプロジェクト
    await playCue(3, async () => {
      await hoverSlow(ctx.page, ctx.page.locator('#popup-recent li').first(), { durationMs: 600 });
    });

    // cue 4: スプレッドシート ID / URL で開く
    await playCue(4, async () => {
      await hoverSlow(ctx.page, ctx.page.locator('#popup-open-id'), { durationMs: 600 });
    });

    // cue 5: tiab-review から引き継いで作成
    await playCue(5, async () => {
      await hoverSlow(ctx.page, ctx.page.locator('#tiab-pick'), { durationMs: 600 });
    });

    // cue 6: 最近のプロジェクトをクリックしてメインビューへ（同一タブ遷移。#/home のサイドバー）
    await playCue(6, async () => {
      await ctx.page.locator('#popup-recent li').first().locator('button').click();
      await ctx.page.locator('#app-nav .app__nav-link').first().waitFor({ state: 'visible', timeout: 15000 });
      await ctx.sleep(400);
      const navHref = (h) => ctx.page.locator(`#app-nav a[href="${h}"]`);
      await hoverSlow(ctx.page, navHref('#/home'), { durationMs: 400 });
      await hoverSlow(ctx.page, navHref('#/documents'), { durationMs: 400 });
      await hoverSlow(ctx.page, navHref('#/protocol'), { durationMs: 400 });
      await hoverSlow(ctx.page, navHref('#/schema'), { durationMs: 400 });
    });
  },
};
