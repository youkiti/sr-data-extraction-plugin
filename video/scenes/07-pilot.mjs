// チャプター07: パイロット抽出。help.html #pilot に対応。
//
// #/pilot で対象試験・対象項目・コスト概算を見せたあと、実際に「パイロット抽出を実行」を
// クリックする（デモは llmFixtures.ts の固定応答を返すため実 API 呼び出しは発生しない）。
// 完了後は検証 UI がそのまま埋め込まれ、PDF 上の根拠ハイライトと accept/edit/reject/
// not_reported ボタンが見える状態になる（実測で抽出完了まで約20秒かかるため、
// cue 3 の後は「抽出が完了しました」表示を実際に待ってから cue 4 に進む）。

import { hoverSlow, hoverSequence } from './lib/gestures.mjs';
import { loadCueDurations, sleepRemainder } from './lib/pacing.mjs';

export default {
  id: '07',
  slug: 'pilot',
  title: 'パイロット抽出',
  narration: '07-pilot',

  async run(ctx) {
    const durations = loadCueDurations('07-pilot');
    async function playCue(n, action) {
      const nn = String(n).padStart(2, '0');
      const t0 = Date.now();
      ctx.cue(n);
      if (action) await action();
      await sleepRemainder(ctx, t0, (durations[nn] ?? 3) * 1000 + 500);
    }

    await ctx.openExtensionPage('app/app.html#/home');
    await ctx.page.locator('#app-nav .app__nav-link').first().waitFor({ state: 'visible', timeout: 15000 });
    await ctx.page.locator('#app-nav a[href="#/pilot"]').click();
    await ctx.page.locator('#pilot-run').waitFor({ state: 'visible', timeout: 20000 });
    await ctx.sleep(500);

    // cue 1: 対象試験を選ぶ
    await playCue(1, async () => {
      const items = ctx.page.locator('.pilot__doc-item');
      const count = await items.count();
      const list = [];
      for (let i = 0; i < count; i += 1) list.push(items.nth(i));
      await hoverSequence(ctx.page, list, { holdMs: 350, moveMs: 400 });
    });

    // cue 2: 対象項目（既定=全項目）とコスト概算
    await playCue(2, async () => {
      await hoverSlow(ctx.page, ctx.page.locator('.pilot__field-section').first(), { durationMs: 500 });
      await hoverSlow(ctx.page, ctx.page.locator('#pilot-estimate'), { durationMs: 500 });
    });

    // cue 3: 実行ボタンをクリック（進捗バーが表示される）
    await playCue(3, async () => {
      await hoverSlow(ctx.page, ctx.page.locator('#pilot-run'), { durationMs: 500 });
      await ctx.page.locator('#pilot-run').click();
      await ctx.page.locator('#pilot-progress').waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    });

    // 抽出の完了を実際に待つ（デモの固定応答でも数十秒かかる。ナレーションの尺だけでは
    // 実処理に追いつかないことがあるため、cue 4 を打つ前に完了表示を待機する）
    await ctx.page.locator('#pilot-run-done').waitFor({ state: 'visible', timeout: 60000 });

    // cue 4: 埋め込みの検証UI（PDFハイライト・AI根拠カード）
    await playCue(4, async () => {
      await ctx.page.locator('.verify__pane--pdf canvas').first()
        .waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
      await hoverSlow(ctx.page, ctx.page.locator('.verify__quote').first(), { durationMs: 600 }).catch(() => {});
      await hoverSlow(ctx.page, ctx.page.locator('.verify__ai').first(), { durationMs: 500 }).catch(() => {});
    });

    // cue 5: 表のデザインを改訂して再パイロット・過去のパイロット結果
    await playCue(5, async () => {
      await ctx.page.locator('#pilot-revise-schema').scrollIntoViewIfNeeded().catch(() => {});
      await hoverSlow(ctx.page, ctx.page.locator('#pilot-revise-schema'), { durationMs: 500 }).catch(() => {});
    });
  },
};
