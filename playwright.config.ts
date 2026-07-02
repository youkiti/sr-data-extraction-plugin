// Playwright E2E 設定（docs/test-strategy.md §1: dev ビルド → dist/ 静的配信 → chrome スタブ）
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4400',
    // 実行環境に chromium が事前配置されている場合はそれを使う
    // （CI では `npx playwright install chromium` で取得するため未設定）
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } }
      : {}),
  },
  webServer: {
    command: 'npm run dev && node tools/playwright-server.js',
    port: 4400,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
