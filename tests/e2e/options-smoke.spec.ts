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

test('OpenAI 互換 API: 接続先の保存と JSON Schema 接続テスト', async ({ page }) => {
  await page.addInitScript(chromeStub({ seedModel: false }));
  await page.route('https://llm.example/v1/chat/completions', async (route) => {
    const body = route.request().postDataJSON() as { response_format?: { type?: string } };
    expect(body.response_format?.type).toBe('json_schema');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }),
    });
  });
  await page.goto('/options/options.html');
  await page.locator('#llm-provider').selectOption('openai_compatible');
  await expect(page.locator('#openai-compatible-fields')).toBeVisible();
  await page.locator('#openai-compatible-endpoint').fill(
    'https://llm.example/v1/chat/completions',
  );
  await page.locator('#openai-compatible-api-key').fill('custom-key');
  await page.locator('#test-llm-connection').click();
  await expect(page.locator('#llm-connection-status')).toHaveText('接続テストに成功しました。');
  await page.locator('#save-llm-connection').click();
  await expect(page.locator('#llm-connection-status')).toHaveText('保存しました。');
  await expect(page.locator('#openai-compatible-api-key')).toHaveValue('');
});

test('OpenAI 互換 API: loopback HTTP は API キーなしで保存・接続できる', async ({ page }) => {
  await page.addInitScript(chromeStub({ seedModel: false }));
  await page.route('http://localhost:11434/v1/chat/completions', async (route) => {
    expect(route.request().headers()['authorization']).toBeUndefined();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }),
    });
  });
  await page.goto('/options/options.html');
  await page.locator('#llm-provider').selectOption('openai_compatible');
  await page
    .locator('#openai-compatible-endpoint')
    .fill('http://localhost:11434/v1/chat/completions');
  await page.locator('#test-llm-connection').click();
  await expect(page.locator('#llm-connection-status')).toHaveText('接続テストに成功しました。');
  await page.locator('#save-llm-connection').click();
  await expect(page.locator('#llm-connection-status')).toHaveText('保存しました。');
});

test('Anthropic: エンドポイント欄なしで API キーの保存と接続テストができる（issue #127 PR2）', async ({
  page,
}) => {
  await page.addInitScript(chromeStub({ seedModel: false }));
  await page.route('https://api.anthropic.com/v1/messages', async (route) => {
    const headers = route.request().headers();
    expect(headers['x-api-key']).toBe('sk-ant-TESTKEY');
    expect(headers['anthropic-version']).toBeTruthy();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ content: [{ type: 'text', text: '{"ok":true}' }] }),
    });
  });
  await page.goto('/options/options.html');
  await page.locator('#llm-provider').selectOption('anthropic');
  await expect(page.locator('#anthropic-fields')).toBeVisible();
  await expect(page.locator('#openai-compatible-fields')).toBeHidden();
  await page.locator('#anthropic-api-key').fill('sk-ant-TESTKEY');
  await page.locator('#test-llm-connection').click();
  await expect(page.locator('#llm-connection-status')).toHaveText('接続テストに成功しました。');
  await page.locator('#save-llm-connection').click();
  await expect(page.locator('#llm-connection-status')).toHaveText('保存しました。');
  await expect(page.locator('#anthropic-api-key')).toHaveValue('');
});

test('Azure OpenAI: 完全 URL + api-key ヘッダーで保存・接続テストができる（issue #127 PR3）', async ({
  page,
}) => {
  await page.addInitScript(chromeStub({ seedModel: false }));
  const azureUrl =
    'https://res.openai.azure.com/openai/deployments/gpt-4o-deployment/chat/completions?api-version=2026-01-01';
  await page.route(azureUrl, async (route) => {
    const headers = route.request().headers();
    expect(headers['api-key']).toBe('azure-secret');
    expect(headers['authorization']).toBeUndefined();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }),
    });
  });
  await page.goto('/options/options.html');
  await page.locator('#llm-provider').selectOption('azure_openai');
  await expect(page.locator('#azure-openai-fields')).toBeVisible();
  await expect(page.locator('#openai-compatible-fields')).toBeHidden();
  await expect(page.locator('#anthropic-fields')).toBeHidden();
  await page.locator('#azure-openai-endpoint').fill(azureUrl);
  await page.locator('#azure-openai-api-key').fill('azure-secret');
  await page.locator('#test-llm-connection').click();
  await expect(page.locator('#llm-connection-status')).toHaveText('接続テストに成功しました。');
  await page.locator('#save-llm-connection').click();
  await expect(page.locator('#llm-connection-status')).toHaveText('保存しました。');
  await expect(page.locator('#azure-openai-api-key')).toHaveValue('');
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
  await expect(page.locator('#default-model-status')).toHaveText('既定モデル: 保存済み');
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
  const links: Array<[string, string]> = [
    ['使い方ガイド', `${base}/help.html`],
    ['プライバシーポリシー', `${base}/privacy-policy.html`],
    ['利用規約', `${base}/terms-of-service.html`],
  ];
  for (const [label, href] of links) {
    const link = page.getByRole('link', { name: label });
    await expect(link).toHaveAttribute('href', href);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  }
});
