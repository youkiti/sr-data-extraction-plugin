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
      counts: { documents: 1, protocolVersions: 0, schemaVersions: 0, pilotRuns: 0, evidenceRows: 0, dataRows: 0 },
      role: { role: 'owner', resolving: false, error: null },
      documents: { records: [], studies: [] },
      adjudicate: { rows: [] },
    };
  });
});

test('二重レビューの一覧から開始し、最初の対象を強調して終了できる。カード表示中も axe を通す', async ({ page }) => {
  await page.goto('/app/app.html#/adjudicate');
  await page.locator('#app-open-tours').click();
  await page.locator('[data-guide-action="start"][data-guide-tour="dual-review"]').click();
  const card = page.locator('.guide-tour-card');
  await expect(card).toHaveAttribute('data-guide-step', 'open-home');
  await expect(card).toHaveAttribute('data-guide-waiting', 'false');
  const nav = page.locator('[data-tour="nav-home"]');
  const rect = await nav.boundingBox();
  const highlight = page.locator('.guide-tour-highlight');
  await expect(highlight).toBeVisible();
  const frame = await highlight.boundingBox();
  expect(frame!.x).toBeCloseTo(rect!.x - 3);
  expect(frame!.y).toBeCloseTo(rect!.y - 3);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await nav.click();
  await expect(card).toHaveAttribute('data-guide-step', 'add-reviewer');
  await card.locator('[data-guide-action="end"]').click();
  await expect(card).toHaveCount(0);
  await expect(highlight).toHaveCount(0);
});
