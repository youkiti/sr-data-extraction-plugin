// チャプター05: プロトコルを登録する。help.html #protocol に対応。
//
// #/protocol（デモでは v1 のプロトコルが登録済み）を表示し、本文カードと
// 「新しい版を入力」ボタンをホバーする。

import { hoverSlow } from './lib/gestures.mjs';
import { loadCueDurations, sleepRemainder } from './lib/pacing.mjs';

export default {
  id: '05',
  slug: 'protocol',
  title: 'プロトコルを登録する',
  narration: '05-protocol',

  async run(ctx) {
    const durations = loadCueDurations('05-protocol');
    async function playCue(n, action) {
      const nn = String(n).padStart(2, '0');
      const t0 = Date.now();
      ctx.cue(n);
      if (action) await action();
      await sleepRemainder(ctx, t0, (durations[nn] ?? 3) * 1000 + 500);
    }

    await ctx.openExtensionPage('app/app.html#/home');
    await ctx.page.locator('#app-nav .app__nav-link').first().waitFor({ state: 'visible', timeout: 15000 });
    await ctx.page.locator('#app-nav a[href="#/protocol"]').click();
    await ctx.page.locator('#protocol-summary').waitFor({ state: 'visible', timeout: 15000 });
    await ctx.sleep(500);

    // cue 1: プロトコル本文（RQ・組入/除外基準など）を見せる
    await playCue(1, async () => {
      await hoverSlow(ctx.page, ctx.page.locator('#protocol-summary'), { durationMs: 700 });
    });

    // cue 2: 表のデザインの参照元になる
    await playCue(2, async () => {
      await hoverSlow(ctx.page, ctx.page.locator('#protocol-summary dd').nth(2), { durationMs: 700 });
    });

    // cue 3: 追記型のバージョン管理
    await playCue(3, async () => {
      await hoverSlow(ctx.page, ctx.page.locator('#protocol-edit'), { durationMs: 600 });
    });
  },
};
