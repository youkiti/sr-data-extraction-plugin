// 公開ヘルプの検索から、同意・一問一答・公開前の下書きまでを外部 API なしで確認する。
import { expect, test } from '@playwright/test';

test('「?」からヘルプを検索し、同意後に回答と小節リンク・下書きを表示する', async ({ page }) => {
  await page.addInitScript(() => {
    const win = window as unknown as Record<string, unknown>;
    const stored: Record<string, unknown> = { 'secrets.geminiApiKey': 'e2e-api-key' };
    win.chrome = {
      storage: {
        local: {
          get: async (keys: string | string[]) => Object.fromEntries(
            (Array.isArray(keys) ? keys : [keys]).map(key => [key, stored[key]]),
          ),
          set: async (items: Record<string, unknown>) => {
            Object.assign(stored, items);
          },
          remove: async (key: string) => {
            delete stored[key];
          },
        },
        onChanged: { addListener: () => undefined, removeListener: () => undefined },
      },
      runtime: {
        getURL: (path: string) => `/${path}`,
        getManifest: () => ({ version: '1.0' }),
        sendMessage: async () => ({ ok: true, email: 'e2e@example.com', token: 'e2e-token' }),
      },
      tabs: { create: async () => ({}) },
    };
    win.__E2E_PRELOADED_STATE__ = {
      currentProject: { projectId: 'help-project', spreadsheetId: 'help-sheet', driveFolderId: 'help-folder', name: 'ヘルプテスト' },
      counts: { documents: 0, protocolVersions: 0, schemaVersions: 0, pilotRuns: 0, evidenceRows: 0, dataRows: 0 },
      role: { role: 'owner', resolving: false, error: null },
      documents: { records: [], studies: [] },
    };
  });
  let requests = 0;
  await page.route('https://generativelanguage.googleapis.com/**', async route => {
    requests++;
    const text = requests === 1 ? JSON.stringify({ sectionIds: ['project-tours'] }) : 'ヘッダの「ツアー」で一覧を開いてください。';
    await route.fulfill({ json: {
      candidates: [{ content: { parts: [{ text }] } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10 },
    } });
  });
  await page.route('https://sheets.googleapis.com/**', route => route.fulfill({ json: { values: [] } }));
  await page.route('https://www.googleapis.com/**', route => route.fulfill({ json: { files: [] } }));
  await page.goto('/app/app.html#/home');
  await page.locator('#app-content a[data-help="home"]').click();
  await page.locator('[data-help-action="consult"]').click();
  const dialog = page.locator('#help-consult');
  await expect(dialog).toBeVisible();
  await dialog.locator('textarea').fill('操作ツアーを始めたい');
  await dialog.locator('[data-consult-action="search"]').click();
  await expect(dialog.locator('a[href*="#project-tours"]')).toBeVisible();
  expect(requests).toBe(0);
  await dialog.locator('[data-consult-action="ask"]').click();
  await expect(page.locator('#ai-data-consent')).toBeVisible();
  expect(requests).toBe(0);
  await page.locator('#ai-data-consent-accept').click();
  await expect(dialog).toContainText('ヘッダの「ツアー」で一覧を開いてください。');
  await expect(dialog.locator('a[href*="#project-tours"]')).toHaveAttribute('href', /lang=ja#project-tours$/);
  expect(requests).toBe(2);
  await dialog.locator('[data-consult-action="draft"]').click();
  await expect(dialog.locator('#help-consult-draft')).toHaveAttribute('readonly', '');
  await expect(dialog.locator('#help-consult-draft')).toHaveValue(/操作ツアーを始めたい/);
  await expect(dialog.locator('a[href*="issues/new"]')).toHaveAttribute('target', '_blank');
  await expect(dialog).toContainText('公開の Issue');
});
