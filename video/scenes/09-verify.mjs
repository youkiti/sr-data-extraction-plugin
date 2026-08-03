// チャプター09: 検証（中核の工程）。help.html #verify に対応。最重要の章。
//
// study 1（Halvorsen 2026）を開き、2ペイン全体像 → PDF 上の quote ハイライト → 4判定の意味 →
// キーボード操作（a/e/x/n/j/k/z/f を実際に押す）→ study/群/アウトカムのタブ構成 →
// anchor_status = failed のセル（効果量 × 群1）での relocate-quote 導線、の順に見せる。
// study 1 は「独立二重レビュー済み・裁定待ち・owner 自身の判定行は無い」状態でシードされて
// いるため、owner から見るとどの項目も未検証（0/24）から判定を始められる（seed.ts 参照）。

import { hoverSlow, hoverSequence } from './lib/gestures.mjs';
import { loadCueDurations, sleepRemainder } from './lib/pacing.mjs';

/** キー入力の後、画面に変化が反映されるまでの短い間（視聴者が結果を追えるようにする） */
async function pressKey(page, key, waitMs = 700) {
  await page.keyboard.press(key);
  await page.waitForTimeout(waitMs);
}

export default {
  id: '09',
  slug: 'verify',
  title: '検証（中核の工程）',
  narration: '09-verify',

  async run(ctx) {
    const durations = loadCueDurations('09-verify');
    async function playCue(n, action) {
      const nn = String(n).padStart(2, '0');
      const t0 = Date.now();
      ctx.cue(n);
      if (action) await action();
      await sleepRemainder(ctx, t0, (durations[nn] ?? 3) * 1000 + 500);
    }

    await ctx.openExtensionPage('app/app.html#/home');
    await ctx.page.locator('#app-nav .app__nav-link').first().waitFor({ state: 'visible', timeout: 15000 });
    await ctx.page.locator('#app-nav a[href="#/verify"]').click();
    await ctx.page.locator('.verify__pane--pdf canvas').first().waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
    await ctx.sleep(1500);

    // cue 1: 2ペイン全体像（Halvorsen 2026）
    await playCue(1, async () => {
      await hoverSlow(ctx.page, ctx.page.locator('.verify__pane--pdf'), { durationMs: 500 });
      await hoverSlow(ctx.page, ctx.page.locator('.verify__panes > *').last(), { durationMs: 500 }).catch(() => {});
    });

    // cue 2: quoteハイライト（国=Portugal の根拠が本文上でハイライトされている）
    await playCue(2, async () => {
      await hoverSlow(ctx.page, ctx.page.locator('.pdf-viewer__hl').first(), { durationMs: 600 }).catch(() => {});
      await hoverSlow(ctx.page, ctx.page.locator('.verify__quote').first(), { durationMs: 600 }).catch(() => {});
    });

    // cue 3: 4判定の意味（承認/修正/棄却/未報告ボタンをホバー）
    await playCue(3, async () => {
      await hoverSequence(
        ctx.page,
        [
          ctx.page.locator('.verify__action--accept').first(),
          ctx.page.locator('.verify__action--edit').first(),
          ctx.page.locator('.verify__action--reject').first(),
          ctx.page.locator('.verify__action--not-reported').first(),
        ],
        { holdMs: 350, moveMs: 300 },
      );
    });

    // cue 4: キーボードで a（承認）→ e（修正）→ x（棄却）→ n（未報告）を実際に押す
    // 対象は unit 1「試験概要」の4項目（国 → デザイン → 登録期間 → 追跡期間）。
    await playCue(4, async () => {
      // a: 国（Portugal）をそのまま承認
      await pressKey(ctx.page, 'a');
      // e: デザインを修正して確定
      await pressKey(ctx.page, 'e', 400);
      const editInput = ctx.page.locator('.verify__edit-input');
      await editInput.waitFor({ state: 'visible', timeout: 3000 });
      await editInput.fill('Randomized controlled trial (two-arm, parallel-group)');
      await pressKey(ctx.page, 'Enter');
      // x: 登録期間を棄却し、書式を統一した値を入力して確定
      await pressKey(ctx.page, 'x', 400);
      const rejectInput = ctx.page.locator('.verify__edit-input');
      await rejectInput.waitFor({ state: 'visible', timeout: 3000 });
      await rejectInput.fill('2025年4月〜2026年3月');
      await pressKey(ctx.page, 'Enter');
      // n: 追跡期間を未報告として判定
      await pressKey(ctx.page, 'n');
    });

    // cue 5: j/k で移動 → z で直前の判定を取り消す → f でハイライトへ移動
    await playCue(5, async () => {
      await pressKey(ctx.page, 'k', 500);
      await pressKey(ctx.page, 'k', 500);
      await pressKey(ctx.page, 'j', 500);
      await pressKey(ctx.page, 'j', 500); // 追跡期間（直前に n で判定した行）へ戻る
      await pressKey(ctx.page, 'z', 700); // 直前の判定（追跡期間の未報告）を取り消す
      await pressKey(ctx.page, 'f', 1000); // ハイライトへ移動
    });

    // cue 6: study/群/アウトカムのタブ構成（群タブの群構成確定 → アウトカムタブへ）
    await playCue(6, async () => {
      const tabs = ctx.page.locator('.verify__tab');
      await tabs.nth(1).click();
      await ctx.sleep(600);
      await hoverSlow(ctx.page, ctx.page.locator('.adjudicate__arm-card, #verify-arm-card, .verify__arm-card').first(), { durationMs: 400 }).catch(() => {});
      await hoverSlow(ctx.page, ctx.page.locator('.verify__panes').first(), { durationMs: 400 }).catch(() => {});
      await tabs.nth(2).click();
      await ctx.sleep(600);
    });

    // cue 7: anchor_status = failed のセル（効果量 × 群1）を開き、再特定の導線を見せる
    await playCue(7, async () => {
      await ctx.page
        .locator('button.focus-card__matrix-btn[aria-label^="効果量 × Structured"]')
        .click({ timeout: 5000 })
        .catch(() => {});
      await ctx.sleep(500);
      await hoverSlow(ctx.page, ctx.page.locator('.verify__quote-unanchored').first(), { durationMs: 500 }).catch(() => {});
      await hoverSlow(ctx.page, ctx.page.locator('.verify__quote-search').first(), { durationMs: 500 }).catch(() => {});
    });

    // cue 8: 「AI で再特定」を実際に押す
    await playCue(8, async () => {
      await hoverSlow(ctx.page, ctx.page.locator('.verify__quote-relocate').first(), { durationMs: 500 }).catch(() => {});
      await ctx.page.locator('.verify__quote-relocate').first().click({ timeout: 5000 }).catch(() => {});
      await ctx.sleep(2500);
    });

    // cue 9: automation bias対策（保存は即時・人の判定は空欄から・acceptにも1操作必須）
    await playCue(9, async () => {
      await hoverSlow(ctx.page, ctx.page.locator('#verify-progress'), { durationMs: 500 }).catch(() => {});
    });
  },
};
