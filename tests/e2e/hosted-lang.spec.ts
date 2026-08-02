// 公開ページ（hosted/index.html ほか）の表示言語切替。
// 併記をやめて ja / en の一方だけを表示する挙動（hosted/lang.js + style.css）を、
// tools/playwright-server.js の /hosted/ 経由で実ページを開いて確認する
import { expect, test, type Browser, type Page } from '@playwright/test';

const PAGES = ['index.html', 'help.html', 'privacy-policy.html', 'terms-of-service.html'];

/** ブラウザ言語を固定した新しいコンテキストでページを開く */
async function openWith(browser: Browser, locale: string, path: string): Promise<Page> {
  const context = await browser.newContext({ locale });
  const page = await context.newPage();
  await page.goto(`/hosted/${path}`);
  return page;
}

test.describe('公開ページの表示言語', () => {
  test('日本語ブラウザでは ja だけが見え、en は隠れる', async ({ browser }) => {
    const page = await openWith(browser, 'ja-JP', 'help.html');

    await expect(page.locator('html')).toHaveAttribute('data-lang', 'ja');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
    await expect(page.locator('h1 .ja')).toBeVisible();
    await expect(page.locator('h1 .en')).toBeHidden();
    await expect(page).toHaveTitle('使い方ガイド — SR Data Extraction Plugin');

    await page.context().close();
  });

  test('英語ブラウザでは en だけが見え、title / meta も英語になる', async ({ browser }) => {
    const page = await openWith(browser, 'en-US', 'help.html');

    await expect(page.locator('html')).toHaveAttribute('data-lang', 'en');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('h1 .en')).toBeVisible();
    await expect(page.locator('h1 .ja')).toBeHidden();
    await expect(page).toHaveTitle('User guide — SR Data Extraction Plugin');
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      'content',
      /^User guide for SR Data Extraction Plugin/,
    );
    // ナビの aria-label も切り替わる（併記していた文字列を残さない）
    await expect(page.locator('nav.site-nav')).toHaveAttribute('aria-label', 'Site navigation');

    await page.context().close();
  });

  test('?lang= が最優先される（拡張本体からの遷移）', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'ja-JP' });
    const page = await context.newPage();
    await page.goto('/hosted/help.html?lang=en');

    await expect(page.locator('html')).toHaveAttribute('data-lang', 'en');
    await expect(page.locator('h1 .en')).toBeVisible();

    // 以後は同じサイト内の遷移でも英語が続く（localStorage へ記憶する）
    await page.locator('.footer-links a[href="privacy-policy.html"]').click();
    await expect(page.locator('html')).toHaveAttribute('data-lang', 'en');

    await context.close();
  });

  test('切替ボタンで即時に切り替わり、ページ遷移後も保持される', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'ja-JP' });
    const page = await context.newPage();
    await page.goto('/hosted/index.html');

    const toEnglish = page.locator('.lang-switch button[data-lang-choice="en"]');
    const toJapanese = page.locator('.lang-switch button[data-lang-choice="ja"]');
    await expect(toJapanese).toHaveAttribute('aria-pressed', 'true');

    await toEnglish.click();
    await expect(page.locator('html')).toHaveAttribute('data-lang', 'en');
    await expect(toEnglish).toHaveAttribute('aria-pressed', 'true');
    await expect(toJapanese).toHaveAttribute('aria-pressed', 'false');
    // コピーして共有できるよう URL にも反映する
    await expect(page).toHaveURL(/lang=en/);
    // 画像の代替テキストも英語になる
    await expect(page.locator('.shot img').first()).toHaveAttribute('alt', /^Import screen/);

    await page.locator('.hero-buttons a[href="help.html"]').click();
    await expect(page.locator('html')).toHaveAttribute('data-lang', 'en');
    await expect(page.locator('h1 .ja')).toBeHidden();

    await context.close();
  });

  for (const path of PAGES) {
    test(`${path} は 4 ページ共通で切替 UI を持つ`, async ({ browser }) => {
      const page = await openWith(browser, 'en-US', path);

      await expect(page.locator('.lang-switch button')).toHaveCount(2);
      await expect(page.locator('html')).toHaveAttribute('data-lang', 'en');
      // 併記していた「日本語 / English」形式の見出しが残っていないこと
      await expect(page.locator('body')).not.toContainText('使い方 / Help');

      await page.context().close();
    });
  }
});
