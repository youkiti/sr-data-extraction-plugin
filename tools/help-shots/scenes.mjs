// ヘルプの図のシーン一覧。入口 shoot.mjs がこの配列を順に回す。
// 1 シーン = { name, file, section, title, run }。
//   name:    コマンドラインで指定する名前
//   file:    hosted/screenshots/ に書き出すファイル名（help.html の図と 1 対 1）
//   section: help.html の <section> の id
//   run(shot): 画面を目的の状態にして shot.snap() を呼ぶ。shot は { page, open, openApp, snap }
// 動画用の待ち時間は持たず、要素の表示を待ってから撮る。

async function settle(page) {
    await page.waitForLoadState('load');
    // 完了通知（トースト）が消えるのを待つ。図に通知を写さない。
    await page.locator('.toast').first().waitFor({ state: 'detached', timeout: 20000 }).catch(() => {});
    // フォーカス移動で横や縦にずれたスクロール位置を先頭へ戻す。
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.evaluate(() => document.fonts.ready);
    // 描画が落ち着くまでの最小限の間（アニメーションやキャンバス描画の完了待ち）。
    await page.waitForTimeout(400);
}

// メインビューを開き、サイドバーのリンクで目的の画面へ移る（動画収録と同じ到達手順）。
async function goTo(shot, hash, readySelector) {
    await shot.openApp();
    await shot.page.locator(`#app-nav a[href="${hash}"]`).click();
    await shot.page.locator(readySelector).first().waitFor({ state: 'visible', timeout: 20000 });
    await settle(shot.page);
}

export const scenes = [
    {
        name: 'setup',
        file: 'help-01-setup.png',
        section: 'setup',
        title: '準備（Options の API キー欄）',
        async run(shot) {
            await shot.open('options/options.html');
            await shot.page.locator('#gemini-api-key').waitFor({ state: 'visible', timeout: 15000 });
            await settle(shot.page);
            await shot.snap();
        },
    },
    {
        name: 'project',
        file: 'help-02-project.png',
        section: 'project',
        title: 'S1 プロジェクト選択',
        async run(shot) {
            await shot.open('popup/popup.html');
            await shot.page.locator('#popup-recent-section').waitFor({ state: 'visible', timeout: 15000 });
            await shot.page.locator('#popup-recent-select').waitFor({ state: 'visible', timeout: 15000 });
            // 幅 320px 固定の中央カラムなので、図で読めるよう拡大する（動画収録と同じ CSS zoom）。
            await shot.page.evaluate(() => {
                document.body.style.zoom = '1.5';
            });
            await settle(shot.page);
            await shot.snap();
        },
    },
    {
        name: 'home',
        file: 'help-02-home.png',
        section: 'project',
        title: 'Home',
        async run(shot) {
            await shot.openApp();
            await shot.page.locator('#app-nav a[href="#/home"]').click();
            await shot.page.locator('h3', { hasText: '担当セット' }).waitFor({ state: 'visible', timeout: 15000 });
            await settle(shot.page);
            // 担当セットのカードまで見えるよう、ページの下端へ送る。
            await shot.page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
            await shot.snap();
        },
    },
    {
        name: 'documents',
        file: 'help-03-documents.png',
        section: 'documents',
        title: 'S3 文献の取り込み',
        async run(shot) {
            await goTo(shot, '#/documents', '.documents__study-group');
            // 取り込み欄の下から、3 本の論文が並ぶ位置まで送る。
            await shot.page.locator('#documents-dropzone').evaluate(node => node.scrollIntoView({ block: 'start' }));
            await shot.snap();
        },
    },
    {
        name: 'protocol',
        file: 'help-04-protocol.png',
        section: 'protocol',
        title: 'S4 プロトコル登録',
        async run(shot) {
            await goTo(shot, '#/protocol', '#protocol-summary');
            await shot.snap();
        },
    },
    {
        name: 'schema',
        file: 'help-05-schema.png',
        section: 'schema',
        title: 'S5 表のデザイン',
        async run(shot) {
            await goTo(shot, '#/schema', '#schema-current-table');
            await shot.snap();
        },
    },
    {
        name: 'pilot',
        file: 'help-06-pilot.png',
        section: 'pilot',
        title: 'S6 パイロット抽出',
        async run(shot) {
            await goTo(shot, '#/pilot', '#pilot-run');
            await shot.page.locator('#pilot-run').click();
            await shot.page.locator('#pilot-run-done').waitFor({ state: 'visible', timeout: 60000 });
            await shot.page.locator('.verify__pane--pdf canvas').first()
                .waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
            await settle(shot.page);
            await shot.snap();
        },
    },
    {
        name: 'extract',
        file: 'help-07-extract.png',
        section: 'extract',
        title: 'S7 一括抽出',
        async run(shot) {
            await goTo(shot, '#/extract', '#extract-run');
            await shot.page.locator('#extract-run').click();
            await shot.page.locator('#extract-confirm').waitFor({ state: 'visible', timeout: 5000 });
            await shot.page.locator('#extract-confirm-run').click();
            await shot.page.locator('#extract-run-done').waitFor({ state: 'visible', timeout: 90000 });
            await settle(shot.page);
            // 実行結果（進捗）が見える位置へ送る。
            await shot.page.locator('#extract-run-done').evaluate(node => node.scrollIntoView({ block: 'center' }));
            await shot.snap();
        },
    },
    {
        name: 'verify',
        file: 'help-08-verify.png',
        section: 'verify',
        title: 'S8 検証',
        async run(shot) {
            await goTo(shot, '#/verify', '.verify__pane--pdf canvas');
            await shot.page.locator('.pdf-viewer__hl').first().waitFor({ state: 'visible', timeout: 20000 });
            await settle(shot.page);
            await shot.snap();
        },
    },
    {
        name: 'dashboard',
        file: 'help-09-dashboard.png',
        section: 'dashboard',
        title: 'S9 ダッシュボード',
        async run(shot) {
            await goTo(shot, '#/dashboard', '#dashboard-matrix');
            await shot.snap();
        },
    },
    {
        name: 'dual-review',
        file: 'help-10-dual-review.png',
        section: 'dual-review',
        title: 'S12 裁定',
        async run(shot) {
            await goTo(shot, '#/adjudicate', '#adjudicate-list');
            await shot.page.getByRole('button', { name: '裁定を開始' }).first().click();
            await shot.page.locator('#adjudicate-cells').waitFor({ state: 'visible', timeout: 10000 });
            await shot.page.locator('canvas').first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
            await settle(shot.page);
            await shot.snap();
        },
    },
    {
        name: 'export',
        file: 'help-11-export.png',
        section: 'export',
        title: 'S10 エクスポート',
        async run(shot) {
            await goTo(shot, '#/export', '#export-format');
            await shot.snap();
        },
    },
    {
        name: 'options',
        file: 'help-12-options.png',
        section: 'options',
        title: 'Options の下の方（接続方式・レート制限）',
        async run(shot) {
            await shot.open('options/options.html');
            await shot.page.locator('#llm-provider').waitFor({ state: 'visible', timeout: 15000 });
            await settle(shot.page);
            await shot.page.locator('#rate-limit-tier').scrollIntoViewIfNeeded();
            await shot.snap();
        },
    },
];
