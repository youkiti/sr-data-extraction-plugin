// Popup（S1）smoke: 未ログイン / ログイン済（最近 N 件）の 2 状態 + axe。
// chrome.identity / chrome.storage はスタブ（docs/test-strategy.md §2.1 の chrome スタブ seam）
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

function chromeStub(options: { authed: boolean; seedRecent: boolean }): string {
  // addInitScript は関数を文字列化して注入するため、閉包変数を避けて文字列組み立てで渡す
  return `
    (() => {
      const data = ${
        options.seedRecent
          ? `{
        currentProject: { projectId: 'aaaaaaaa-1111', spreadsheetId: 's1', driveFolderId: 'f1', name: 'E2E プロジェクト' },
        recentProjects: [
          { projectId: 'aaaaaaaa-1111', spreadsheetId: 's1', driveFolderId: 'f1', name: 'E2E プロジェクト' },
          { projectId: 'bbbbbbbb-2222', spreadsheetId: 's2', driveFolderId: 'f2', name: '肺炎 SR' },
        ],
      }`
          : '{}'
      };
      window.chrome = {
        storage: {
          local: {
            get: async (key) => (key in data ? { [key]: data[key] } : {}),
            set: async (items) => { Object.assign(data, items); },
            remove: async (key) => { delete data[key]; },
          },
        },
        runtime: { getURL: (p) => '/' + p, lastError: undefined },
        tabs: { create: async () => ({}) },
        identity: {
          getAuthToken: (_opts, cb) => { cb(${options.authed ? "'e2e-token'" : 'undefined'}); },
          removeCachedAuthToken: (_details, cb) => { cb(); },
          getProfileUserInfo: (_opts, cb) => { cb({ email: 'e2e@example.com', id: '1' }); },
        },
      };
    })();
  `;
}

test('未ログイン: ログインセクションのみ表示される', async ({ page }) => {
  await page.addInitScript(chromeStub({ authed: false, seedRecent: false }));
  await page.goto('/popup/popup.html');
  await expect(page.locator('#popup-status')).toHaveText('ログインが必要です。');
  await expect(page.locator('#popup-auth')).toBeVisible();
  await expect(page.locator('#popup-projects')).toBeHidden();
  await expect(page.locator('#login-button')).toBeVisible();
});

test('ログイン済 + 最近 2 件: recent リストと各フォームが表示される', async ({ page }) => {
  await page.addInitScript(chromeStub({ authed: true, seedRecent: true }));
  await page.goto('/popup/popup.html');
  await expect(page.locator('#popup-status')).toHaveText(
    '最近のプロジェクトから選ぶか、新しく作成してください。',
  );
  await expect(page.locator('#popup-auth')).toBeHidden();
  await expect(page.locator('#popup-email')).toHaveText('e2e@example.com');
  await expect(page.locator('#popup-recent li')).toHaveCount(2);
  await expect(page.locator('#popup-recent li').first()).toContainText('E2E プロジェクト');
  await expect(page.locator('#popup-create-form')).toBeVisible();
  await expect(page.locator('#popup-open-form')).toBeVisible();
});

test('アクセシビリティ違反がない（axe・ログイン済状態）', async ({ page }) => {
  await page.addInitScript(chromeStub({ authed: true, seedRecent: true }));
  await page.goto('/popup/popup.html');
  await expect(page.locator('#popup-recent li')).toHaveCount(2);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
