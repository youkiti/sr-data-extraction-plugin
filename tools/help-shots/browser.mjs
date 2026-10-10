// 撮影用ブラウザの起動と後始末。
// 拡張の読み込み・一時プロファイル・service worker からの拡張 ID の取得は
// tools/guide-tour-check/lib/browser.mjs の withFreshBrowser と同じ手順で、画面サイズは固定（1280x800）。
// ヘッドレス（新ヘッドレス。拡張を読み込める）が既定で、--headed のときだけウィンドウありにする。
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';
import { resolveChromiumExecutable } from '../../video/scripts/config.mjs';
import { stopProfileProcesses } from '../guide-tour-check/lib/browser.mjs';

export const SHOT_SIZE = { width: 1280, height: 800 };
const PROFILE_PREFIX = 'sr-help-shots-';

export async function withShotBrowser(extensionDir, { headed = false, warn = console.warn } = {}, body) {
    const profile = mkdtempSync(path.join(os.tmpdir(), PROFILE_PREFIX));
    const args = [
        `--disable-extensions-except=${extensionDir}`,
        `--load-extension=${extensionDir}`,
        `--window-size=${SHOT_SIZE.width},${SHOT_SIZE.height}`,
        '--lang=ja',
    ];
    if (headed) {
        // 利用者の作業を邪魔しないよう、ウィンドウを画面の端へ寄せる。
        args.push('--window-position=2400,1400');
    }
    const settings = {
        headless: !headed,
        viewport: SHOT_SIZE,
        deviceScaleFactor: 1,
        locale: 'ja',
        args,
    };
    const executablePath = resolveChromiumExecutable();
    if (executablePath) {
        settings.executablePath = executablePath;
    } else if (!headed) {
        // 新ヘッドレスは Playwright 同梱の headless shell ではなく、フルの Chromium でないと拡張を読み込めない。
        settings.channel = 'chromium';
    }
    let context;
    try {
        context = await chromium.launchPersistentContext(profile, settings);
        const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 20000 });
        const page = await context.newPage();
        page.setDefaultTimeout(20000);
        await body({ context, page, extensionId: new URL(worker.url()).host });
    } finally {
        if (context) {
            let timer;
            try {
                const closed = await Promise.race([
                    Promise.resolve().then(() => context.close()).then(() => true),
                    new Promise(resolve => { timer = setTimeout(() => resolve(false), 15000); }),
                ]);
                if (!closed) {
                    warn('警告: ブラウザの終了が 15 秒以内に戻らなかったので、プロセスを停止します');
                    stopProfileProcesses(profile, warn);
                }
            } catch {
                warn('警告: ブラウザの終了に失敗しました');
            } finally {
                clearTimeout(timer);
            }
        }
        // mkdtemp が作った、この実行専用の OS 一時ディレクトリだけを削除する。
        const resolved = path.resolve(profile);
        if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith(PROFILE_PREFIX)) {
            throw new Error(`一時プロファイルの削除対象が不正です: ${resolved}`);
        }
        try {
            rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
        } catch {
            warn(`警告: 一時プロファイルを削除できませんでした: ${resolved}`);
        }
    }
}
