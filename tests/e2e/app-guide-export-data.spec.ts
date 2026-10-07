import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const win = window as unknown as Record<string, unknown>;
    win.chrome = {
      storage: {
        local: { get: async () => ({}), set: async () => undefined, remove: async () => undefined },
        onChanged: { addListener: () => undefined, removeListener: () => undefined },
      },
      runtime: { getURL: (path: string) => `/${path}` },
      tabs: { create: async () => ({}) },
    };
    win.__E2E_PRELOADED_STATE__ = {
      currentProject: { projectId: 'tour-project', spreadsheetId: 'tour-sheet', driveFolderId: 'tour-folder', name: 'ツアーテスト' },
      counts: { documents: 0, protocolVersions: 0, schemaVersions: 0, pilotRuns: 0, evidenceRows: 0, dataRows: 1 },
      role: { role: 'owner', resolving: false, error: null },
      documents: { records: [], studies: [] },
    };
  });
});

test('エクスポートの一覧から開始し、カード表示中の axe と終了を確認する', async ({ page }) => {
  await page.goto('/app/app.html#/home');
  await page.locator('#app-open-tours').click();
  await page.locator('#guide-tour-list [data-guide-action="start"][data-guide-tour="export-data"]').click();
  const card = page.locator('.guide-tour-card');
  await expect(card).toHaveAttribute('data-guide-step', 'open-dashboard');
  await expect(card).toHaveAttribute('data-guide-waiting', 'false');
  const nav = page.locator('[data-tour="nav-dashboard"]');
  const rect = await nav.boundingBox();
  await expect(page.locator('.guide-tour-highlight')).toBeVisible();
  const frame = await page.locator('.guide-tour-highlight').boundingBox();
  expect(frame!.x).toBeCloseTo(rect!.x - 3);
  expect(frame!.y).toBeCloseTo(rect!.y - 3);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
  await card.locator('[data-guide-action="end"]').click();
  await expect(card).toHaveCount(0);
});
