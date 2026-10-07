import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';
import { resolveChromiumExecutable } from '../../../video/scripts/config.mjs';
import { Run } from './run.mjs';

export async function withFreshBrowser(scenario, options, extensionDir, warnings) {
    const profile = mkdtempSync(path.join(os.tmpdir(), 'sr-tour-check-'));
    let context;
    try {
        context = await chromium.launchPersistentContext(profile, {
            headless: false,
            executablePath: resolveChromiumExecutable(),
            viewport: options.size,
            locale: options.lang,
            args: [
                `--disable-extensions-except=${extensionDir}`,
                `--load-extension=${extensionDir}`,
                `--window-size=${options.size.width},${options.size.height}`,
                `--lang=${options.lang}`,
            ],
        });
        const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 20000 });
        const page = await context.newPage();
        page.setDefaultTimeout(20000);
        const run = new Run(scenario.name, page, new URL(worker.url()).host, options.lang, extensionDir, warnings);
        await scenario.run(run);
    } finally {
        try {
            if (context) await context.close();
        } finally {
            // mkdtemp が作った、この実行専用の OS 一時ディレクトリだけを削除する。
            const resolved = path.resolve(profile);
            if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('sr-tour-check-')) {
                throw new Error(`一時プロファイルの削除対象が不正です: ${resolved}`);
            }
            rmSync(resolved, { recursive: true, force: true });
        }
    }
}
