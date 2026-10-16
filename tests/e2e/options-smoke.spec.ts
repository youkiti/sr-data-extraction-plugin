// Options（S11）smoke: API キー（Gemini / OpenRouter / OpenAI 互換 API）/ 接続方式 /
// 既定モデルセレクタの未設定・保存済み表示 + 保存フロー + axe。
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
        permissions: { request: async () => true },
        runtime: { getURL: (p) => '/' + p, lastError: undefined },
      };
    })();
  `;
}

test('接続方式を変えると入力欄とモデル候補が切り替わる', async ({ page }) => {
  await page.addInitScript(chromeStub({ seedModel: false }));
  await page.goto('/options/options.html');
  await expect(page.locator('#gemini-api-key')).toBeVisible();
  await expect(page.locator('#openrouter-api-key')).toBeHidden();
  await page.locator('#llm-provider').selectOption('anthropic');
  await expect(page.locator('#anthropic-api-key')).toBeVisible();
  await expect(page.locator('#gemini-api-key')).toBeHidden();
  await expect(page.locator('#default-model')).toHaveValue('');
  await expect(page.locator('#default-model-options option[value="gemini-3.8-flash"]')).toHaveCount(0);
  await page.locator('#save-and-test-llm-connection').click();
  await expect(page.locator('#llm-connection-status')).toHaveText('保存できませんでした: 既定モデルを選んでください');
});

test('保存済みの既定モデルを復元する', async ({ page }) => {
  await page.addInitScript(chromeStub({ seedModel: true }));
  await page.goto('/options/options.html');
  await expect(page.locator('#default-model')).toHaveValue('gemini-2.0-flash');
});

test('ローカル LLM はキーなしで保存・一覧取得・接続確認を行う', async ({ page }) => {
  await page.addInitScript(chromeStub({ seedModel: false }));
  await page.route('http://localhost:11434/v1/models', async (route) => {
    expect(route.request().headers()['authorization']).toBeUndefined();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{ id: 'local-model' }] }) });
  });
  await page.route('http://localhost:11434/v1/chat/completions', async (route) => {
    expect(route.request().headers()['authorization']).toBeUndefined();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }),
    });
  });
  await page.goto('/options/options.html');
  await page.locator('#llm-provider').selectOption('local_llm');
  await page.locator('#local-llm-preset-ollama').click();
  await expect(page.locator('#local-llm-endpoint')).toHaveValue('http://localhost:11434/v1/chat/completions');
  await page.locator('#default-model').fill('local-model');
  await page.locator('#default-model').blur();
  await page.locator('#save-and-test-llm-connection').click();
  await expect(page.locator('#llm-connection-status')).toHaveText('保存しました。接続を確認しました（local-model。モデル 1 件を取得）');
});

test('reasoning effort の既定値: 未設定表示 → 選択で即時保存する（issue #127 PR5）', async ({
  page,
}) => {
  await page.addInitScript(chromeStub({ seedModel: false }));
  await page.goto('/options/options.html');
  await expect(page.locator('#default-reasoning-effort-status')).toHaveText(
    'reasoning effort の既定値: 未設定',
  );
  await expect(page.locator('#default-reasoning-effort')).toHaveValue('');

  await page.locator('#default-reasoning-effort').selectOption('high');
  await expect(page.locator('#default-reasoning-effort-status')).toHaveText(
    'reasoning effort の既定値: 保存済み',
  );

  // 未設定（空欄）へ戻すと保存キーを削除して「未設定」表示へ戻る
  await page.locator('#default-reasoning-effort').selectOption('');
  await expect(page.locator('#default-reasoning-effort-status')).toHaveText(
    'reasoning effort の既定値: 未設定',
  );
});

test('アクセシビリティ違反がない（axe）', async ({ page }) => {
  await page.addInitScript(chromeStub({ seedModel: true }));
  await page.goto('/options/options.html');
  await expect(page.locator('#default-model')).toHaveValue('gemini-2.0-flash');
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('スタンドアロン設定ページに「アプリを開く」導線がある（B-2）', async ({ page }) => {
  await page.addInitScript(chromeStub({ seedModel: false }));
  await page.goto('/options/options.html');
  const openApp = page.locator('#options-open-app');
  await expect(openApp).toHaveText('アプリを開く');
  await expect(openApp).toHaveAttribute('href', '../app/app.html');
});

test('末尾にヘルプ・ポリシーの外部リンク 3 本がある（issue #214）', async ({ page }) => {
  await page.addInitScript(chromeStub({ seedModel: false }));
  await page.goto('/options/options.html');
  const base = 'https://youkiti.github.io/sr-data-extraction-plugin';
  // 表示言語を ?lang= で引き継ぐ（公開ページ側は hosted/lang.js がこれを最優先で読む）
  const links: Array<[string, string]> = [
    ['使い方ガイド', `${base}/help.html?lang=ja`],
    ['プライバシーポリシー', `${base}/privacy-policy.html?lang=ja`],
    ['利用規約', `${base}/terms-of-service.html?lang=ja`],
  ];
  for (const [label, href] of links) {
    const link = page.getByRole('link', { name: label });
    await expect(link).toHaveAttribute('href', href);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  }
});
