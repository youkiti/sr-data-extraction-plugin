// スモークテスト用シーン（シーンスクリプトの CONTRACT 例。PR1: 基盤 + スモークシーン1本）
//
// video/scripts/record.mjs のヘッダーコメントに書かれた CONTRACT に沿った最小構成のシーン。
// デモビルド（dist-demo/）はまだ無いため、素の `dist/`（npm run dev の出力。プロジェクト
// 未選択状態）で撮れる内容にしている。具体的には:
//   1. app/app.html を #/home で開く（ctx.openExtensionPage、本リポジトリ固有の適応点）
//   2. サイドナビ（文献取り込み〜裁定）をゆっくりホバー
//   3. ヘッダーの「ヘルプ」「設定」ボタンをゆっくりホバー
// を行い、収録→TTS→合成の一連のパイプラインを音声付きで最後まで通す検証と、
// 可視カーソル（scenes/lib/cursor.mjs）が実際に映像へ映ることの確認を兼ねる。
//
// 実際のチャプター（14本、デモビルド前提）は後続 PR で追加される。
// 実際のチャプター用シーンを書く際はこのファイルを土台にしてよい。
//
// `video/scenes/` 直下ではなく `examples/` サブディレクトリに置いているのは、
// record.mjs のシーン列挙が拡張子 `.mjs` のファイルのみを対象とし、サブディレクトリを
// 無視するため（`npm run video:record` を引数無しで実行してもスモークテストは
// 収録対象に含まれない。単体で回すときは `node video/scripts/record.mjs 00-smoke` のように
// examples/ 配下のファイルも直接指定すれば収録できる）。

import { hoverSequence, hoverSlow } from '../lib/gestures.mjs';

export default {
    id: '00',
    slug: 'smoke',
    title: 'スモークテスト',
    // このシーン専用の原稿（narration/00-smoke.md, subtitles/00-smoke.md）を使う。
    // 省略時も `${id}-${slug}` = '00-smoke' と同じキーになるため必須ではないが、
    // 意図を明確にするため明示している。
    narration: '00-smoke',
    // デモビルドが無く、プロジェクト未選択状態でも #/home のナビは一通り描画される
    // （src/app/bootstrap.ts の roleBlockOf は currentProject === null のとき常に null を
    // 返すため）ので、storageSeed（ログイン状態の投入）は不要。

    async run(ctx) {
        // 本リポジトリ固有の適応点: tiab-review-plugin の sidepanel.html 決め打ちと異なり、
        // どの拡張内ページ・どの hash を開くかをシーン側が明示する。
        await ctx.openExtensionPage('app/app.html#/home');
        await ctx.page.locator('#app-nav .app__nav-link').first().waitFor({ state: 'visible', timeout: 15000 });
        await ctx.sleep(800); // 画面が落ち着くまでの「間」（config.mjs の SCENE_LEAD_IN_SEC 目安）

        ctx.cue(1);
        // サイドナビ（文献取り込み〜裁定）を先頭から順にゆっくりホバーする。
        // 可視カーソルの動作確認を兼ねるため、必ずマウス移動を伴う操作にしている。
        const navLinkCount = await ctx.page.locator('#app-nav .app__nav-link').count();
        const navLinks = [];
        for (let i = 0; i < navLinkCount; i += 1) {
            navLinks.push(ctx.page.locator('#app-nav .app__nav-link').nth(i));
        }
        await hoverSequence(ctx.page, navLinks, { holdMs: 350, moveMs: 450 });

        ctx.cue(2);
        // ヘッダーの「ヘルプ」ボタン（新しいタブで使い方ガイドを開く導線）をホバー
        await hoverSlow(ctx.page, ctx.page.locator('#app-open-help'), { durationMs: 600 });
        await ctx.sleep(1500);

        ctx.cue(3);
        // ヘッダーの「設定」ボタン（#/options への遷移導線）をホバー
        await hoverSlow(ctx.page, ctx.page.locator('#app-open-options'), { durationMs: 600 });
        await ctx.sleep(1500);
    },
};
