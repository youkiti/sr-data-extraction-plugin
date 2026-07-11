// #/home の進捗カウント起動時読込の E2E（test-strategy.md §3 + ui-states.md §3）。
// 他ルートの spec と違い counts を注入せず、Sheets values:batchGet の stub から
// 実データでサマリ表示 + ガードのディム解除まで通す。失敗 → 再読み込みの復帰も検証する
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/** batchGet 応答（progressCounts の 7 範囲順） */
const BATCH_VALUE_RANGES = [
  { values: [['doc-1'], ['doc-2'], ['doc-3']] }, // Documents
  { values: [['1']] }, // Protocol
  { values: [['1']] }, // SchemaVersions
  // ExtractionRuns run_type〜status（完了行のみ pilot に数える）
  {
    values: [
      ['pilot', '1', 'doc-1', 'gemini', 'gemini-test', '', 'text_only', 'done'],
      ['full', '1', 'doc-1', 'gemini', 'gemini-test', '', 'text_only', 'done'],
    ],
  },
  { values: [['ev-1'], ['ev-2'], ['ev-3'], ['ev-4']] }, // Evidence
  { values: [['doc-1']] }, // StudyData
  { values: [['r-1'], ['r-2']] }, // ResultsData
];

interface RouteCounters {
  batchGetCount: number;
}

/** Sheets stub。failFirst = true なら 1 回目の batchGet だけ HTTP 500 を返す */
async function setupRoutes(page: Page, options: { failFirst?: boolean } = {}): Promise<RouteCounters> {
  const counters: RouteCounters = { batchGetCount: 0 };
  await page.route('https://sheets.googleapis.com/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/values:batchGet')) {
      counters.batchGetCount++;
      if (options.failFirst === true && counters.batchGetCount === 1) {
        await route.fulfill({ status: 500, body: 'boom' });
        return;
      }
      await route.fulfill({ json: { valueRanges: BATCH_VALUE_RANGES } });
      return;
    }
    await route.fulfill({ json: { values: [] } });
  });
  return counters;
}

async function initApp(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const win = window as unknown as Record<string, unknown>;
    win.chrome = {
      storage: {
        local: {
          get: async () => ({}),
          set: async () => undefined,
          remove: async () => undefined,
        },
      },
      runtime: { id: 'e2e-extension-id', getURL: (p: string) => `/${p}` },
      tabs: { create: async () => ({ id: 1 }) },
      identity: {
        getAuthToken: (_opts: unknown, cb: (token?: string) => void) => {
          cb('e2e-token');
        },
        removeCachedAuthToken: (_details: unknown, cb: () => void) => {
          cb();
        },
      },
    };
    // counts は注入しない（起動時の Sheets 読込を実弾で通す）
    win.__E2E_PRELOADED_STATE__ = {
      currentProject: {
        projectId: 'e2e-project',
        spreadsheetId: 'e2e-sheet',
        driveFolderId: 'e2e-folder',
        name: 'E2E プロジェクト',
      },
    };
  });
  await page.goto('/app/app.html#/home');
}

test('起動時に batchGet で進捗カウントを読み、サマリ + ガードのディム解除に反映する', async ({ page }) => {
  const counters = await setupRoutes(page);
  await initApp(page);

  // サマリが実データで出る（文献数 3 / プロトコル 1 / スキーマ 1 / Evidence 4 / データ行 3）
  const summary = page.locator('.home__summary');
  await expect(summary).toBeVisible({ timeout: 15_000 });
  const values = page.locator('.home__summary-value');
  await expect(values).toHaveText(['3', '1', '1', '4', '3']);
  expect(counters.batchGetCount).toBe(1);

  // プロジェクト切替リンク: S1 プロジェクト選択ページへ同一タブで遷移できる
  const switchLink = page.locator('#home-switch-project');
  await expect(switchLink).toHaveText('別のプロジェクトを開く');
  await expect(switchLink).toHaveAttribute('href', '../popup/popup.html');

  // ヘッダ: プロジェクト名もプロジェクト選択ページへのリンク + 歯車はアプリ内設定へのハッシュリンク
  await expect(page.locator('#app-status a')).toHaveText('プロジェクト: E2E プロジェクト');
  await expect(page.locator('#app-status a')).toHaveAttribute('href', '../popup/popup.html');
  await expect(page.locator('#app-open-options')).toHaveAttribute('href', '#/options');

  // ガード: protocolVersions = 1 で #/schema のディムが解除され、遷移できる
  const schemaLink = page.locator('#app-nav a[href="#/schema"]');
  await expect(schemaLink).not.toHaveAttribute('aria-disabled', 'true');
  await schemaLink.click();
  await expect(page.locator('#app-context')).toHaveText('表のデザイン 画面を表示しています');

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);

  // 実際に同一タブで popup.html へ遷移する（新規タブを開かない）
  await page.locator('#app-nav a[href="#/home"]').click();
  await switchLink.click();
  await expect(page).toHaveURL(/\/popup\/popup\.html$/);
});

test('歯車から設定（#/options）へ同一タブで入り、戻る導線で #/home へ帰れる', async ({
  page,
}) => {
  await setupRoutes(page);
  await initApp(page);
  await expect(page.locator('.home__summary')).toBeVisible({ timeout: 15_000 });

  // ヘッダの歯車をクリック = 別タブ・別ページではなくアプリ内 #/options へ遷移する
  await page.locator('#app-open-options').click();
  await expect(page).toHaveURL(/#\/options$/);
  await expect(page.locator('#app-content .settings__header h2')).toHaveText('設定');
  // options.html と同じ設定本文がアプリ内に組み上がり配線される
  await expect(page.locator('#app-content #gemini-api-key')).toBeVisible();
  await expect(page.locator('#app-content #default-model-status')).toHaveText('既定モデル: 未設定');
  // サイドバー（ステップナビ + 裁定）は設定表示中も維持される
  await expect(page.locator('#app-nav a')).toHaveCount(10);

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);

  // 「前の画面へ戻る」で #/home へ帰る（#/options には #/home から入ったため）
  await page.locator('#app-content .settings__back').click();
  await expect(page).toHaveURL(/#\/home$/);
  await expect(page.locator('.home__summary')).toBeVisible();
});

test('読込失敗は #home-counts-error を出し、再読み込みで復帰する', async ({ page }) => {
  const counters = await setupRoutes(page, { failFirst: true });
  await initApp(page);

  const error = page.locator('#home-counts-error');
  await expect(error).toBeVisible({ timeout: 15_000 });
  await expect(error).toContainText('進捗を読み込めませんでした');
  // 失敗中のガードはシード値（全 0）のまま = #/schema はディム
  await expect(page.locator('#app-nav a[href="#/schema"]')).toHaveAttribute('aria-disabled', 'true');

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);

  await page.locator('#home-counts-reload').click();
  await expect(page.locator('.home__summary')).toBeVisible({ timeout: 15_000 });
  await expect(error).toBeHidden();
  expect(counters.batchGetCount).toBe(2);
  await expect(page.locator('#app-nav a[href="#/schema"]')).not.toHaveAttribute(
    'aria-disabled',
    'true',
  );
});
