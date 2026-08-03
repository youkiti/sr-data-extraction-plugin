// デモビルド疎通確認シーン（PR2: デモビルド層の実装）。
//
// dist-demo/（npm run build:demo の出力）を対象に、プロジェクト選択済み・OAuth 画面なしで
// ホーム → 文献取り込み → 表のデザイン → 検証（実 PDF 上に quote ハイライトが光るところ）→
// ダッシュボード → 裁定 → エクスポートを巡回し、各画面が意味のある内容（0 件ではない）を
// 表示することを確認する。00-smoke.mjs（examples/ 直下・プロジェクト未選択の素の dist/ 向け）の
// 後継として、デモビルドの録画パイプライン疎通を兼ねる。
//
// examples/ 配下に置く理由は 00-smoke.mjs と同じ（record.mjs のシーン列挙が examples/ を
// 無視するため、一括収録には含まれない。単体実行は
// `node video/scripts/record.mjs 00-demo` で行う）。実チャプター用シーンを書く際は
// 00-smoke.mjs と本ファイルの両方を土台にしてよい。

import { hoverSlow } from '../lib/gestures.mjs';

export default {
    id: '00',
    slug: 'demo',
    title: 'デモビルド疎通確認',
    narration: '00-demo',

    async run(ctx) {
        // --- ホーム ---
        await ctx.openExtensionPage('app/app.html#/home');
        await ctx.page.locator('#app-nav .app__nav-link').first().waitFor({ state: 'visible', timeout: 15000 });
        await ctx.sleep(800);
        ctx.cue(1);
        await ctx.sleep(3000);

        // --- 文献取り込み ---
        await ctx.page.locator('#app-nav a[href="#/documents"]').click();
        await ctx.page.waitForTimeout(1500);
        ctx.cue(2);
        await ctx.sleep(3000);

        // --- 表のデザイン ---
        await ctx.page.locator('#app-nav a[href="#/schema"]').click();
        await ctx.page.waitForTimeout(1500);
        ctx.cue(3);
        await ctx.sleep(3000);

        // --- 検証（実 PDF 上に quote ハイライトが光るところ。本 PR の最重要成果） ---
        await ctx.page.locator('#app-nav a[href="#/verify"]').click();
        // PDF ビューア（pdf.js）の描画完了を待つ（キャンバス要素が現れるまで）
        await ctx.page.locator('canvas').first().waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
        await ctx.page.waitForTimeout(1500);
        ctx.cue(4);
        await ctx.sleep(4000);

        // --- ダッシュボード ---
        await ctx.page.locator('#app-nav a[href="#/dashboard"]').click();
        await ctx.page.waitForTimeout(1500);
        ctx.cue(5);
        await ctx.sleep(3000);

        // --- 裁定 ---
        await ctx.page.locator('#app-nav a[href="#/adjudicate"]').click();
        await ctx.page.waitForTimeout(1500);
        ctx.cue(6);
        await ctx.sleep(3000);

        // --- エクスポート ---
        await ctx.page.locator('#app-nav a[href="#/export"]').click();
        await ctx.page.waitForTimeout(1500);
        ctx.cue(7);
        await hoverSlow(ctx.page, ctx.page.locator('#app-nav a[href="#/export"]'), { durationMs: 500 });
        await ctx.sleep(3000);
    },
};
