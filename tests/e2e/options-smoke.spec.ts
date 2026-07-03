// Options（S11）smoke: API キー / 既定モデルの未設定・保存済み表示 + 既定モデルの保存フロー + axe。
// chrome.storage はスタブ（docs/test-strategy.md §2.1 の chrome スタブ seam）
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

function chromeStub(options: { seedModel: boolean }): string {
  // addInitScript は関数を文字列化して注入するため、閉包変数を避けて文字列組み立てで渡す
  return `
    (() => {
      const data = ${options.seedModel ? "{ 'settings.defaultModel': 'gemini-2.0-flash' }" : '{}'};
      window.chrome = {
        storage: {
          local: {
            get: async (key) => (key in data ? { [key]: data[key] } : {}),
            set: async (items) => { Object.assign(data, items); },
            remove: async (key) => { delete data[key]; },
          },
        },
        runtime: { getURL: (p) => '/' + p, lastError: undefined },
      };
    })();
  `;
}

test('未設定: Gemini / 既定モデルとも未設定表示 + datalist に候補が列挙される', async ({ page }) => {
  await page.addInitScript(chromeStub({ seedModel: false }));
  await page.goto('/options/options.html');
  await expect(page.locator('#options-status')).toHaveText('Gemini: 未設定');
  await expect(page.locator('#default-model-status')).toHaveText('既定モデル: 未設定');
  await expect(page.locator('#default-model')).toHaveValue('');
  // 候補 = 単価表（MODEL_PRICING）のモデル ID。代表 1 件の存在で確認する
  await expect(
    page.locator('#default-model-candidates option[value="gemini-2.5-pro"]'),
  ).toHaveCount(1);
});

test('既定モデルの保存 → 空文字で未設定に戻す', async ({ page }) => {
  await page.addInitScript(chromeStub({ seedModel: false }));
  await page.goto('/options/options.html');
  await page.locator('#default-model').fill('  gemini-2.5-pro  ');
  await page.locator('#save-default-model').click();
  await expect(page.locator('#default-model-status')).toHaveText('保存しました。');
  await expect(page.locator('#default-model')).toHaveValue('gemini-2.5-pro');

  await page.locator('#default-model').fill('');
  await page.locator('#save-default-model').click();
  await expect(page.locator('#default-model-status')).toHaveText('未設定に戻しました。');
});

test('保存済み: 既定モデルを input へ表示する（マスク不要）', async ({ page }) => {
  await page.addInitScript(chromeStub({ seedModel: true }));
  await page.goto('/options/options.html');
  await expect(page.locator('#default-model-status')).toHaveText('既定モデル: 保存済み');
  await expect(page.locator('#default-model')).toHaveValue('gemini-2.0-flash');
});

test('アクセシビリティ違反がない（axe）', async ({ page }) => {
  await page.addInitScript(chromeStub({ seedModel: true }));
  await page.goto('/options/options.html');
  await expect(page.locator('#default-model-status')).toHaveText('既定モデル: 保存済み');
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
