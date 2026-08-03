// チャプター08: 一括抽出。help.html #extract に対応。
//
// #/extract で study 2（Bergstrom 2026、未抽出）に対して実際に一括抽出を走らせ、
// 進捗が動いて完了するところまでを収録する（デモは llmFixtures.ts の固定応答を返すため
// 実 API 呼び出しは発生しない）。レート制限（tier 設定で自動調整）にも触れる。

import { hoverSlow, hoverSequence } from './lib/gestures.mjs';
import { loadCueDurations, sleepRemainder } from './lib/pacing.mjs';

export default {
  id: '08',
  slug: 'extract',
  title: '一括抽出',
  narration: '08-extract',

  async run(ctx) {
    const durations = loadCueDurations('08-extract');
    async function playCue(n, action) {
      const nn = String(n).padStart(2, '0');
      const t0 = Date.now();
      ctx.cue(n);
      if (action) await action();
      await sleepRemainder(ctx, t0, (durations[nn] ?? 3) * 1000 + 500);
    }

    await ctx.openExtensionPage('app/app.html#/home');
    await ctx.page.locator('#app-nav .app__nav-link').first().waitFor({ state: 'visible', timeout: 15000 });
    await ctx.page.locator('#app-nav a[href="#/extract"]').click();
    await ctx.page.locator('#extract-run').waitFor({ state: 'visible', timeout: 15000 });
    await ctx.sleep(500);

    // cue 1: 対象試験（既定 = 未抽出の全件。Bergstrom 2026 が対象）
    await playCue(1, async () => {
      await hoverSequence(
        ctx.page,
        [
          ctx.page.locator('.extract__study-item', { hasText: 'Halvorsen' }),
          ctx.page.locator('.extract__study-item', { hasText: 'Bergstrom' }),
          ctx.page.locator('.extract__study-item', { hasText: 'Moreau' }),
        ],
        { holdMs: 300, moveMs: 350 },
      );
    });

    // cue 2: 対象項目・モデル・コスト概算
    await playCue(2, async () => {
      await hoverSlow(ctx.page, ctx.page.locator('#extract-model'), { durationMs: 500 });
      await hoverSlow(ctx.page, ctx.page.locator('#extract-estimate'), { durationMs: 600 });
    });

    // cue 3: 実行 → 確認ダイアログ → 実行する → 進捗バー（レート制限にも言及）
    await playCue(3, async () => {
      await hoverSlow(ctx.page, ctx.page.locator('#extract-run'), { durationMs: 500 });
      await ctx.page.locator('#extract-run').click();
      await ctx.page.locator('#extract-confirm').waitFor({ state: 'visible', timeout: 5000 });
      await hoverSlow(ctx.page, ctx.page.locator('#extract-confirm-run'), { durationMs: 500 });
      await ctx.page.locator('#extract-confirm-run').click();
      await ctx.page.locator('#extract-progress').waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    });

    // 抽出の完了を実際に待つ（デモの固定応答でも数秒〜十数秒かかりうる。ナレーションの尺だけでは
    // 実処理に追いつかないことがあるため、cue 4 を打つ前に完了表示を待機する。07-pilot.mjs と
    // 同じ方針）
    await ctx.page.locator('#extract-run-done').waitFor({ state: 'visible', timeout: 90000 });

    // cue 4: 完了 → 検証へ進むリンク
    await playCue(4, async () => {
      await hoverSlow(ctx.page, ctx.page.locator('#extract-verify-link'), { durationMs: 600 }).catch(() => {});
    });
  },
};
