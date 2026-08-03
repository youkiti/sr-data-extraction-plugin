// チャプター02: 準備（インストール・BYOK・ログイン）。help.html #setup に対応。
//
// デモビルドは OAuth 画面を出さないため、ログイン画面そのものは撮れない
// （brief 冒頭の注意）。そのため popup.html（プロジェクト選択画面。ログイン中の表示）と
// options/options.html（BYOK の API キー・接続方式・既定モデル・レート制限）を主軸にし、
// インストールと Google ログインの手順はナレーションで補う。

import { hoverSlow } from './lib/gestures.mjs';
import { loadCueDurations, sleepRemainder } from './lib/pacing.mjs';
import { applyPageZoom } from './lib/zoom.mjs';

// popup.html は幅 320px 固定の中央カラムのため、1920x1080 では文字が小さすぎて読めない
// （lib/zoom.mjs 冒頭コメント参照）。options.html / app.html は十分に画面を埋めるため対象外。
const POPUP_ZOOM = 1.8;

export default {
  id: '02',
  slug: 'setup',
  title: '準備（インストール・BYOK・ログイン）',
  narration: '02-setup',

  async run(ctx) {
    const durations = loadCueDurations('02-setup');
    async function playCue(n, action) {
      const nn = String(n).padStart(2, '0');
      const t0 = Date.now();
      ctx.cue(n);
      if (action) await action();
      await sleepRemainder(ctx, t0, (durations[nn] ?? 3) * 1000 + 500);
    }

    // --- cue 1: インストール（popup.html のブランド表示を見せる） ---
    await ctx.openExtensionPage('popup/popup.html');
    await ctx.page.locator('#popup-account').waitFor({ state: 'visible', timeout: 15000 });
    await applyPageZoom(ctx.page, POPUP_ZOOM);
    await ctx.sleep(500);
    await playCue(1, async () => {
      await hoverSlow(ctx.page, ctx.page.locator('.popup__title, h1').first(), { durationMs: 600 });
    });

    // --- cue 2-3: BYOK（options.html の Gemini API キーカード） ---
    await ctx.openExtensionPage('options/options.html');
    await ctx.page.locator('#gemini-api-key').waitFor({ state: 'visible', timeout: 15000 });
    await ctx.sleep(400);
    await playCue(2, async () => {
      await hoverSlow(ctx.page, ctx.page.locator('#gemini-api-key'), { durationMs: 700 });
    });
    await playCue(3, async () => {
      await hoverSlow(ctx.page, ctx.page.locator('#save-keys'), { durationMs: 500 });
    });

    // --- cue 4: ログイン（popup.html のログイン中表示） ---
    await ctx.openExtensionPage('popup/popup.html');
    await ctx.page.locator('#popup-account').waitFor({ state: 'visible', timeout: 15000 });
    await applyPageZoom(ctx.page, POPUP_ZOOM);
    await ctx.sleep(400);
    await playCue(4, async () => {
      await hoverSlow(ctx.page, ctx.page.locator('#popup-account'), { durationMs: 700 });
    });

    // --- cue 5-6: 接続方式・既定モデル・レート制限（再び options.html） ---
    await ctx.openExtensionPage('options/options.html');
    await ctx.page.locator('#llm-provider').waitFor({ state: 'visible', timeout: 15000 });
    await ctx.sleep(400);
    await playCue(5, async () => {
      await hoverSlow(ctx.page, ctx.page.locator('#llm-provider'), { durationMs: 700 });
    });
    await playCue(6, async () => {
      await ctx.page.locator('#default-model-container').scrollIntoViewIfNeeded().catch(() => {});
      await hoverSlow(ctx.page, ctx.page.locator('#rate-limit-tier'), { durationMs: 700 });
    });

    // --- cue 7: 送信先についての注意（Gemini API キーカードへ戻る） ---
    await playCue(7, async () => {
      await ctx.page.locator('#gemini-api-key').scrollIntoViewIfNeeded().catch(() => {});
      await hoverSlow(ctx.page, ctx.page.locator('#gemini-api-key'), { durationMs: 600 });
    });
  },
};
