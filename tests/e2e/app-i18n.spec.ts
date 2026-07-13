// 表示言語切替（issue #93）の E2E: Options で en を選ぶと移行済み画面（App シェル + Home +
// 設定）がリロード不要で英語表示になり、ja へ復帰できる（docs/ui-states.md §2「表示言語」）。
// chrome.storage はスタブ（docs/test-strategy.md §2.1 の chrome スタブ seam）
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/** chrome.storage スタブ + プロジェクト・counts 注入（Sheets 読込を発火させない） */
async function initApp(page: Page, options: { seedEnglish?: boolean } = {}): Promise<void> {
  await page.addInitScript(`
    (() => {
      const data = ${options.seedEnglish ? "{ 'settings.uiLanguage': 'en' }" : '{}'};
      window.chrome = {
        storage: {
          local: {
            get: async (key) => (key in data ? { [key]: data[key] } : {}),
            set: async (items) => { Object.assign(data, items); },
            remove: async (key) => { delete data[key]; },
          },
        },
        permissions: { request: async () => true },
        runtime: { id: 'e2e-extension-id', getURL: (p) => '/' + p, lastError: undefined },
      };
      window.__E2E_PRELOADED_STATE__ = {
        currentProject: {
          projectId: 'e2e-project',
          spreadsheetId: 'e2e-sheet',
          driveFolderId: 'e2e-folder',
          name: 'E2E プロジェクト',
        },
        counts: {
          documents: 1,
          protocolVersions: 1,
          schemaVersions: 1,
          pilotRuns: 0,
          evidenceRows: 0,
          dataRows: 0,
        },
      };
    })();
  `);
  await page.goto('/app/app.html#/home');
}

test('Options で en を選ぶと App シェル + Home が英語になり、ja へ復帰できる', async ({
  page,
}) => {
  await initApp(page);

  // 既定は ja（既存挙動に回帰がない）
  await expect(page.locator('#app-content h2').first()).toHaveText('プロジェクト概要');
  await expect(page.locator('#app-context')).toHaveText('Home 画面を表示しています');

  // 設定（アプリ内 #/options）へ入り、言語セレクタで English を選ぶ
  await page.locator('#app-open-options').click();
  const language = page.locator('#ui-language');
  await expect(language).toHaveValue('ja');
  await language.selectOption('en');

  // リロード不要で表示中ルート（設定）・ヘッダ・サイドバーが英語へ切り替わる
  await expect(page.locator('#app-content .settings__header h2')).toHaveText('Settings');
  await expect(page.locator('#app-status a')).toHaveText('Project: E2E プロジェクト');
  await expect(page.locator('#app-nav a[href="#/schema"]')).toHaveText('Table design');
  await expect(page.locator('#app-context')).toHaveText('Showing the Settings screen');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  // 切替は保存される（次回起動用の settings.uiLanguage）
  await expect(page.locator('#ui-language')).toHaveValue('en');

  // Home へ移動しても英語のまま
  await page.locator('#app-nav a[href="#/home"]').click();
  await expect(page.locator('#app-content h2').first()).toHaveText('Project overview');
  await expect(page.locator('#app-context')).toHaveText('Showing the Home screen');
  await expect(page.locator('#home-switch-project')).toHaveText('Open another project');

  // en 表示のままアクセシビリティ違反がない（axe）
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);

  // Options へ戻って ja へ復帰できる
  await page.locator('#app-open-options').click();
  await page.locator('#ui-language').selectOption('ja');
  await expect(page.locator('#app-content .settings__header h2')).toHaveText('設定');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  await page.locator('#app-nav a[href="#/home"]').click();
  await expect(page.locator('#app-content h2').first()).toHaveText('プロジェクト概要');
});

test('保存済みの表示言語（en）でメインビューが英語で起動する', async ({ page }) => {
  await initApp(page, { seedEnglish: true });
  await expect(page.locator('#app-content h2').first()).toHaveText('Project overview');
  await expect(page.locator('#app-context')).toHaveText('Showing the Home screen');
  await expect(page.locator('#app-open-popup')).toBeHidden();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test('スタンドアロン options.html も保存済み言語（en）で構築され、ja へ戻せる', async ({
  page,
}) => {
  await page.addInitScript(`
    (() => {
      const data = { 'settings.uiLanguage': 'en' };
      window.chrome = {
        storage: {
          local: {
            get: async (key) => (key in data ? { [key]: data[key] } : {}),
            set: async (items) => { Object.assign(data, items); },
            remove: async (key) => { delete data[key]; },
          },
        },
        permissions: { request: async () => true },
        runtime: { getURL: (p) => '/' + p, lastError: undefined },
      };
    })();
  `);
  await page.goto('/options/options.html');
  await expect(page.locator('h1')).toHaveText('Settings');
  await expect(page.locator('#options-open-app')).toHaveText('Open the app');
  await expect(page.locator('#ui-language')).toHaveValue('en');
  await page.locator('#ui-language').selectOption('ja');
  await expect(page.locator('h1')).toHaveText('設定');
  await expect(page.locator('#options-status')).toHaveText('Gemini: 未設定');
});
