// ステップ 5: MV3 ハーネスの自動実行（インストール済み Chrome + playwright-core）
// - --load-extension で mv3-harness を読み込み、app.html の実行結果を回収する
// - ブラウザ側テキスト層と Node（extract-text.ts）出力の一致も検証する
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const spikeRoot = path.resolve(here, '..');
const extDir = path.join(spikeRoot, 'mv3-harness');

interface HarnessResult {
  ok: boolean;
  pdfjsVersion?: string;
  pageCount?: number;
  renderedPage1?: boolean;
  fakeWorker?: boolean;
  warnings?: string[];
  page1TextLength?: number;
  page1Text?: string;
  error?: string;
}

async function main(): Promise<void> {
  const userDataDir = path.join(os.tmpdir(), `anchor-spike-mv3-${Date.now()}`);
  const context = await chromium.launchPersistentContext(userDataDir, {
    // branded Chrome は 137+ で --load-extension を無効化したため Playwright の Chromium を使う
    headless: false,
    args: [
      `--disable-extensions-except=${extDir}`,
      `--load-extension=${extDir}`,
      '--no-first-run',
    ],
  });
  try {
    let sw = context.serviceWorkers()[0];
    if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 30000 });
    const extId = new URL(sw.url()).host;
    console.log(`拡張 ID: ${extId}`);

    const page = await context.newPage();
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    await page.goto(`chrome-extension://${extId}/app.html`);
    await page.waitForSelector('#result[data-done="1"]', { timeout: 60000 });
    const raw = (await page.textContent('#result')) ?? '{}';
    const result = JSON.parse(raw) as HarnessResult;

    // Node 側テキスト層との突き合わせ（1 ページ目）
    const nodeJson = JSON.parse(
      await readFile(path.join(spikeRoot, 'outputs', 'textlayer', 'udca.json'), 'utf8'),
    ) as { pages: Array<{ page: number; text: string }> };
    const nodePage1 = nodeJson.pages[0]?.text ?? '';
    const browserPage1 = result.page1Text ?? '';
    const identical = nodePage1 === browserPage1;

    const summary = {
      checkedAt: new Date().toISOString(),
      extensionLoaded: true,
      ...result,
      page1Text: undefined, // 全文は保存しない（長さと一致判定のみ残す）
      consoleErrors,
      nodeVsBrowser: {
        identical,
        nodeLength: nodePage1.length,
        browserLength: browserPage1.length,
        firstDiffIndex: identical
          ? null
          : [...Array(Math.min(nodePage1.length, browserPage1.length)).keys()].find(
              (i) => nodePage1[i] !== browserPage1[i],
            ) ?? Math.min(nodePage1.length, browserPage1.length),
      },
    };
    await mkdir(path.join(spikeRoot, 'outputs'), { recursive: true });
    await writeFile(
      path.join(spikeRoot, 'outputs', 'mv3-harness-result.json'),
      JSON.stringify(summary, null, 1),
      'utf8',
    );
    console.log(JSON.stringify(summary, null, 1));
  } finally {
    await context.close();
  }
}

await main();
