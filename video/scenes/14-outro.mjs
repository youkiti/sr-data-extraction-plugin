// チャプター14: アウトロ。help.html対応なし（締めの画面）。
//
// video/assets/end-card.html を file:// で表示し、ヘルプページ・Chrome Web Store・GitHub の
// 導線を案内して締める（01-intro.mjs のタイトルカード表示と同じ方式）。

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { hoverSlow } from './lib/gestures.mjs';
import { loadCueDurations, sleepRemainder } from './lib/pacing.mjs';
import { ASSETS_DIR, REPO_ROOT } from '../scripts/config.mjs';

export default {
  id: '14',
  slug: 'outro',
  title: 'アウトロ',
  narration: '14-outro',

  async run(ctx) {
    const durations = loadCueDurations('14-outro');
    async function playCue(n, action) {
      const nn = String(n).padStart(2, '0');
      const t0 = Date.now();
      ctx.cue(n);
      if (action) await action();
      await sleepRemainder(ctx, t0, (durations[nn] ?? 3) * 1000 + 500);
    }

    const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
    const endCardPath = path.join(ASSETS_DIR, 'end-card.html');
    await ctx.page.goto(`file://${endCardPath}?version=${encodeURIComponent(pkg.version)}`);
    await ctx.page.waitForTimeout(800); // SCENE_LEAD_IN_SEC 目安

    // cue 1: お礼 + ヘルプページ案内
    await playCue(1, async () => {
      await hoverSlow(ctx.page, ctx.page.locator('.thanks'), { durationMs: 600 }).catch(() => {});
    });

    // cue 2: GitHub / issue 案内
    await playCue(2, async () => {
      await hoverSlow(ctx.page, ctx.page.locator('.links div').last(), { durationMs: 600 }).catch(() => {});
    });
  },
};
