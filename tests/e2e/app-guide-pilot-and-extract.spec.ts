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
      counts: { documents: 1, protocolVersions: 1, schemaVersions: 1, pilotRuns: 0, evidenceRows: 0, dataRows: 0 },
      role: { role: 'owner', resolving: false, error: null },
      documents: { records: [], studies: [] },
    };
  });
});

test('一覧からパイロットと一括抽出を開始・終了でき、カード表示中も axe を通す', async ({ page }) => {
  await page.goto('/app/app.html#/home');
  await page.locator('#app-open-tours').click();
  await page.locator('#guide-tour-list [data-guide-action="start"][data-guide-tour="pilot-and-extract"]').click();
  const card = page.locator('.guide-tour-card');
  await expect(card).toHaveAttribute('data-guide-step', 'open-pilot');
  await expect(card).toHaveAttribute('data-guide-waiting', 'false');
  const nav = page.locator('[data-tour="nav-pilot"]');
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
