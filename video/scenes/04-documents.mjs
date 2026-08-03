// チャプター04: 文献を取り込む。help.html #documents に対応。
//
// #/documents（取り込み済みの架空デモ論文3本が表示された状態）を巡回する。
// Picker は実ダイアログが出ないため、取り込み済み一覧・テキスト層バッジ・統合導線を
// ホバーで見せる構成にする（brief の指示どおり）。

import { hoverSlow, hoverSequence } from './lib/gestures.mjs';
import { loadCueDurations, sleepRemainder } from './lib/pacing.mjs';

export default {
  id: '04',
  slug: 'documents',
  title: '文献を取り込む',
  narration: '04-documents',

  async run(ctx) {
    const durations = loadCueDurations('04-documents');
    async function playCue(n, action) {
      const nn = String(n).padStart(2, '0');
      const t0 = Date.now();
      ctx.cue(n);
      if (action) await action();
      await sleepRemainder(ctx, t0, (durations[nn] ?? 3) * 1000 + 500);
    }

    await ctx.openExtensionPage('app/app.html#/home');
    await ctx.page.locator('#app-nav .app__nav-link').first().waitFor({ state: 'visible', timeout: 15000 });
    await ctx.page.locator('#app-nav a[href="#/documents"]').click();
    await ctx.page.locator('.documents__study-group').first().waitFor({ state: 'visible', timeout: 15000 });
    await ctx.sleep(500);

    // cue 1: Drive から選ぶ / PC からドラッグ&ドロップ
    await playCue(1, async () => {
      await hoverSlow(ctx.page, ctx.page.locator('#documents-import'), { durationMs: 500 });
      await hoverSlow(ctx.page, ctx.page.locator('#documents-dropzone'), { durationMs: 500 });
    });

    // cue 2: テキスト層バッジ（ok/partial/no_text_layer）
    await playCue(2, async () => {
      await hoverSlow(
        ctx.page,
        ctx.page.locator('.documents__study-group').first().locator('.documents__doc-row').first(),
        { durationMs: 600 },
      );
    });

    // cue 3: no_text_layer（スキャンPDF）の制約
    await playCue(3, async () => {
      await hoverSlow(
        ctx.page,
        ctx.page.locator('.documents__study-group').first().locator('.documents__doc-row').first(),
        { durationMs: 500 },
      );
    });

    // cue 4: 複数文書の統合
    await playCue(4, async () => {
      const firstGroup = ctx.page.locator('.documents__study-group').first();
      await hoverSlow(ctx.page, firstGroup.locator('.documents__study-check'), { durationMs: 500 });
      await hoverSlow(ctx.page, ctx.page.locator('#documents-merge'), { durationMs: 500 });
    });

    // cue 5: デモの3論文（2群・3群・2群）を順に見せる
    await playCue(5, async () => {
      const groups = ctx.page.locator('.documents__study-group');
      const count = await groups.count();
      const list = [];
      for (let i = 0; i < count; i += 1) list.push(groups.nth(i));
      await hoverSequence(ctx.page, list, { holdMs: 500, moveMs: 500 });
    });
  },
};
