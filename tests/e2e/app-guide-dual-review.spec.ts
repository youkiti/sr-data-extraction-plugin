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
  await expect(page.locator('.guide-tour-highlight')).toBeVisible();
  // 枠は対象の位置に追従する（再配置は一拍遅れることがある）。同じ瞬間に両方を読み、重なるまで待つ
  await expect
    .poll(() =>
      page.evaluate((selector) => {
        const target = document.querySelector(selector)!.getBoundingClientRect();
        const frame = document.querySelector('.guide-tour-highlight')!.getBoundingClientRect();
        return [Math.round(frame.x - target.x), Math.round(frame.y - target.y)];
      }, '[data-tour="nav-home"]'),
    )
    .toEqual([-3, -3]);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await nav.click();
  await expect(card).toHaveAttribute('data-guide-step', 'review-mode');
  await card.locator('[data-guide-action="end"]').click();
  await expect(card).toHaveCount(0);
  await expect(page.locator('.guide-tour-highlight')).toHaveCount(0);
});
