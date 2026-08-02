// 公開ページ URL の正典（issue #214）。静的 HTML（app.html / popup.html）は属性へ直接
// URL を書くため定数を import できない。ここで HTML を読んで一致を検査し、ドリフトを防ぐ
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  applyPublicPageLanguage,
  HELP_URL,
  PRIVACY_POLICY_URL,
  SITE_URL,
  TERMS_OF_SERVICE_URL,
  withUiLanguage,
} from '../../../src/lib/publicPages';

const repoRoot = join(__dirname, '..', '..', '..');

function readSource(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

describe('公開ページ URL', () => {
  test('GitHub Pages（gh-pages ルート）の 4 ページを指す', () => {
    const origin = 'https://youkiti.github.io/sr-data-extraction-plugin';
    expect(SITE_URL).toBe(`${origin}/`);
    expect(HELP_URL).toBe(`${origin}/help.html`);
    expect(PRIVACY_POLICY_URL).toBe(`${origin}/privacy-policy.html`);
    expect(TERMS_OF_SERVICE_URL).toBe(`${origin}/terms-of-service.html`);
  });

  test('hosted/ に各ページの実体がある（デプロイ元の存在確認）', () => {
    for (const file of ['index.html', 'help.html', 'privacy-policy.html', 'terms-of-service.html']) {
      expect(readSource(join('hosted', file))).toContain('<!doctype html>');
    }
  });
});

describe('静的 HTML の href が定数と一致する', () => {
  test('app.html のヘッダ「ヘルプ」は HELP_URL を新規タブで開く', () => {
    const html = readSource(join('src', 'app', 'app.html'));
    expect(html).toContain(`href="${HELP_URL}"`);
    // 外部リンクは target=_blank + rel=noopener noreferrer（opener 経由の乗っ取り防止）
    expect(html).toMatch(
      /id="app-open-help"[\s\S]*?target="_blank"[\s\S]*?rel="noopener noreferrer"/,
    );
    // 表示言語の引き継ぎ対象（applyPublicPageLanguage が拾う目印）
    expect(html).toMatch(/id="app-open-help"[\s\S]*?data-public-page/);
  });

  test('popup.html のフッタ「使い方」は HELP_URL を新規タブで開く', () => {
    const html = readSource(join('src', 'popup', 'popup.html'));
    expect(html).toContain(`href="${HELP_URL}"`);
    expect(html).toMatch(
      /id="popup-open-help"[\s\S]*?target="_blank"[\s\S]*?rel="noopener noreferrer"/,
    );
    expect(html).toMatch(/id="popup-open-help"[\s\S]*?data-public-page/);
  });
});

describe('表示言語の引き継ぎ（?lang=）', () => {
  test('withUiLanguage は ?lang= を付ける', () => {
    expect(withUiLanguage(HELP_URL, 'ja')).toBe(`${HELP_URL}?lang=ja`);
    expect(withUiLanguage(HELP_URL, 'en')).toBe(`${HELP_URL}?lang=en`);
    expect(withUiLanguage(SITE_URL, 'en')).toBe(`${SITE_URL}?lang=en`);
  });

  test('withUiLanguage は既存の ?lang= を上書きする（切替後の再適用でも重複しない）', () => {
    expect(withUiLanguage(`${HELP_URL}?lang=ja`, 'en')).toBe(`${HELP_URL}?lang=en`);
  });

  test('applyPublicPageLanguage は data-public-page の <a> だけを書き換える', () => {
    document.body.innerHTML = `
      <a id="help" href="${HELP_URL}" data-public-page></a>
      <a id="other" href="${TERMS_OF_SERVICE_URL}"></a>
    `;
    applyPublicPageLanguage(document, 'en');
    expect(document.querySelector<HTMLAnchorElement>('#help')?.href).toBe(`${HELP_URL}?lang=en`);
    expect(document.querySelector<HTMLAnchorElement>('#other')?.href).toBe(TERMS_OF_SERVICE_URL);

    // 言語を戻したときもクエリが積み重ならない
    applyPublicPageLanguage(document, 'ja');
    expect(document.querySelector<HTMLAnchorElement>('#help')?.href).toBe(`${HELP_URL}?lang=ja`);
  });
});

describe('公開ページ（hosted/）の i18n', () => {
  const pages = ['index.html', 'help.html', 'privacy-policy.html', 'terms-of-service.html'];

  test('4 ページとも lang.js を読み込み、言語切替の置き場所を持つ', () => {
    for (const file of pages) {
      const html = readSource(join('hosted', file));
      expect(html).toContain('<script src="lang.js"></script>');
      expect(html).toContain('data-lang-switch');
    }
  });

  test('本文は ja / en の対で持ち、併記用の「日本語 / English」表記を残さない', () => {
    for (const file of pages) {
      const html = readSource(join('hosted', file));
      expect(html).toContain('class="ja" lang="ja"');
      expect(html).toContain('class="en" lang="en"');
      // ナビ・フッタにあった「ホーム / Home」形式の併記が残っていないこと
      expect(html).not.toMatch(/>[^<>]*[ぁ-んァ-ヶ一-龠][^<>]* \/ (Home|Help|Privacy|Terms)</);
    }
  });

  test('style.css は選択中の言語だけを表示する', () => {
    const css = readSource(join('hosted', 'style.css'));
    expect(css).toContain(':root[data-lang="ja"] .en');
    expect(css).toContain(':root[data-lang="en"] .ja');
  });
});
