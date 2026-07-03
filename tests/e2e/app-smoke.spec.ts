// 配管 smoke（test-strategy.md §3 フェーズ 0）: app.html が開いて #/home が描画されること + axe。
// chrome スタブと状態注入 seam（§2.1）はここで配線し、以後のルート別 E2E の土台とする
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const win = window as unknown as Record<string, unknown>;
    // chrome スタブ。runtime.getURL は dist/ 静的配信のルート相対パスへ解決する（worker seam）
    win.chrome = {
      storage: {
        local: {
          get: async () => ({}),
          set: async () => undefined,
          remove: async () => undefined,
        },
      },
      runtime: { getURL: (p: string) => `/${p}` },
      tabs: { create: async () => ({}) },
    };
    // 状態注入 seam: ストアのシードに使われる（全ガード充足の状態で smoke する）
    win.__E2E_PRELOADED_STATE__ = {
      currentProject: { projectId: 'e2e-project', spreadsheetId: 'e2e-sheet', driveFolderId: 'e2e-folder', name: 'E2E プロジェクト' },
      counts: {
        documents: 2,
        protocolVersions: 1,
        schemaVersions: 1,
        pilotRuns: 1,
        evidenceRows: 10,
        dataRows: 10,
      },
    };
  });
});

test('app.html が開いて #/home が描画される', async ({ page }) => {
  await page.goto('/app/app.html#/home');
  await expect(page.locator('#app-status')).toHaveText('プロジェクト: E2E プロジェクト');
  await expect(page.locator('#app-content h2')).toHaveText('プロジェクト概要');
  await expect(page.locator('#app-nav a')).toHaveCount(9);
  await expect(page.locator('#app-context')).toHaveText('Home 画面を表示しています');
});

test('サイドバーから #/documents へ遷移できる（注意書きの常時表示を含む）', async ({ page }) => {
  await page.goto('/app/app.html#/home');
  await page.locator('#app-nav a[href="#/documents"]').click();
  await expect(page.locator('#app-content h2')).toHaveText('文献取り込み');
  await expect(page.locator('#app-content')).toContainText(
    '取り込んだ PDF が外部へ送信されるのは LLM API への抽出リクエストのみです',
  );
});

test('アクセシビリティ違反がない（axe）', async ({ page }) => {
  await page.goto('/app/app.html#/home');
  await expect(page.locator('#app-content h2')).toHaveText('プロジェクト概要');
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
