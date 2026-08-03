// チャプター01: イントロ（ツール概要・SR 3 部作での位置づけ）。help.html 冒頭に対応。
//
// タイトルカード（video/assets/title-card.html）を file:// で表示してから、
// #/home のサイドナビ（工程一覧）をゆっくりホバーして本編へつなげる構成。
// cue の間（ま）はナレーション音声の実測尺（loadCueDurations）に合わせる
// （video/README.md の CONTRACT・タイミング精度についての注意を参照）。

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { hoverSequence } from './lib/gestures.mjs';
import { loadCueDurations, sleepRemainder } from './lib/pacing.mjs';
import { ASSETS_DIR, REPO_ROOT } from '../scripts/config.mjs';

export default {
  id: '01',
  slug: 'intro',
  title: 'イントロ',
  narration: '01-intro',

  async run(ctx) {
    const durations = loadCueDurations('01-intro');
    /** cue n を打刻し、action 実行後、そのナレーション尺 + 0.5秒までこの画面を保持する */
    async function playCue(n, action) {
      const nn = String(n).padStart(2, '0');
      const t0 = Date.now();
      ctx.cue(n);
      if (action) await action();
      await sleepRemainder(ctx, t0, (durations[nn] ?? 3) * 1000 + 500);
    }

    // --- タイトルカード（cue 1-2） ---
    const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
    const titleCardPath = path.join(ASSETS_DIR, 'title-card.html');
    await ctx.page.goto(`file://${titleCardPath}?version=${encodeURIComponent(pkg.version)}`);
    await ctx.page.waitForTimeout(800); // SCENE_LEAD_IN_SEC 目安

    await playCue(1);
    await playCue(2);

    // --- 本編（#/home のサイドナビ。cue 3-4） ---
    await ctx.openExtensionPage('app/app.html#/home');
    await ctx.page.locator('#app-nav .app__nav-link').first().waitFor({ state: 'visible', timeout: 15000 });
    await ctx.sleep(500);

    const navHref = (h) => ctx.page.locator(`#app-nav a[href="${h}"]`);
    await playCue(3, async () => {
      await hoverSequence(
        ctx.page,
        [navHref('#/home'), navHref('#/documents'), navHref('#/protocol')],
        { holdMs: 400, moveMs: 600 },
      );
    });
    await playCue(4, async () => {
      await hoverSequence(
        ctx.page,
        [navHref('#/schema'), navHref('#/pilot'), navHref('#/extract')],
        { holdMs: 400, moveMs: 600 },
      );
    });
  },
};
