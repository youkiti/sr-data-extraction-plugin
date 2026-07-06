// Options（S11）smoke: API キー（Gemini / OpenRouter）/ 既定モデルセレクタの
// 未設定・保存済み表示 + 保存フロー + axe。
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

test('未設定: Gemini / OpenRouter / 既定モデルとも未設定表示 + プルダウンに候補が列挙される', async ({
  page,
}) => {
  await page.addInitScript(chromeStub({ seedModel: false }));
  await page.goto('/options/options.html');
  await expect(page.locator('#options-status')).toHaveText('Gemini: 未設定');
  await expect(page.locator('#openrouter-status')).toHaveText('OpenRouter: 未設定');
  await expect(page.locator('#default-model-status')).toHaveText('既定モデル: 未設定');
  await expect(page.locator('#default-model')).toHaveValue('');
  // 候補 = 単価表（MODEL_PRICING）のモデル ID を Gemini / OpenRouter の optgroup で列挙
  await expect(
    page.locator('#default-model optgroup[label="Gemini"] option[value="gemini-2.5-pro"]'),
  ).toHaveCount(1);
  await expect(
    page.locator(
      '#default-model optgroup[label="OpenRouter"] option[value="qwen/qwen3-235b-a22b-2507"]',
    ),
  ).toHaveCount(1);
  // 「その他（直接入力）」のテキストは選ぶまで隠れている
  await expect(page.locator('#default-model-custom')).toBeHidden();
});

test('既定モデルの保存（プルダウン / その他の trim）→ 未設定に戻す', async ({ page }) => {
  await page.addInitScript(chromeStub({ seedModel: false }));
  await page.goto('/options/options.html');
  await page.locator('#default-model').selectOption('gemini-2.5-pro');
  await page.locator('#save-default-model').click();
  await expect(page.locator('#default-model-status')).toHaveText('保存しました。');

  // その他（直接入力）は trim して保存される
  await page.locator('#default-model').selectOption('__other__');
  await expect(page.locator('#default-model-custom')).toBeVisible();
  await page.locator('#default-model-custom').fill('  my/custom-model  ');
  await page.locator('#default-model-custom').dispatchEvent('change');
  await page.locator('#save-default-model').click();
  await expect(page.locator('#default-model-status')).toHaveText('保存しました。');

  // プレースホルダ（未設定）へ戻して保存 = 解除
  await page.locator('#default-model').selectOption('');
  await page.locator('#save-default-model').click();
  await expect(page.locator('#default-model-status')).toHaveText('未設定に戻しました。');
});

test('OpenRouter API キーの保存フロー', async ({ page }) => {
  await page.addInitScript(chromeStub({ seedModel: false }));
  await page.goto('/options/options.html');
  await page.locator('#openrouter-api-key').fill('  sk-or-TESTKEY  ');
  await page.locator('#save-openrouter-key').click();
  await expect(page.locator('#openrouter-status')).toHaveText('保存しました。');
  await expect(page.locator('#openrouter-api-key')).toHaveValue('');
  // Gemini 節の表示には影響しない
  await expect(page.locator('#options-status')).toHaveText('Gemini: 未設定');
});

test('保存済み: 既定モデルをセレクタで復元する（マスク不要）', async ({ page }) => {
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
