// 公開ページ URL の正典（issue #214）。静的 HTML（app.html / popup.html）は属性へ直接
// URL を書くため定数を import できない。ここで HTML を読んで一致を検査し、ドリフトを防ぐ
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
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

describe('公開ページ（hosted/）の図と動画', () => {
  const pages = ['index.html', 'help.html'];
  const MAX_IMAGE_BYTES = 300 * 1024;

  test('参照する図が hosted/screenshots/ に実在し、1 枚 300KB 以下', () => {
    let count = 0;
    for (const file of pages) {
      const html = readSource(join('hosted', file));
      for (const match of html.matchAll(/src="(screenshots\/[^"]+)"/g)) {
        count += 1;
        const imagePath = join(repoRoot, 'hosted', match[1] ?? '');
        expect(existsSync(imagePath)).toBe(true);
        expect(statSync(imagePath).size).toBeLessThanOrEqual(MAX_IMAGE_BYTES);
      }
    }
    expect(count).toBeGreaterThan(0);
  });

  test('動画の節は「YouTube で見る」ボタンと全画面の案内を持つ', () => {
    for (const file of pages) {
      const html = readSource(join('hosted', file));
      expect(html).toMatch(/class="btn btn-outline"[^>]*href="https:\/\/youtu\.be\//);
      expect(html).toContain('class="video-hint"');
    }
  });

  test('help.html は拡張アイコンの見つけ方の図を参照する', () => {
    expect(readSource(join('hosted', 'help.html'))).toContain('screenshots/pin-extension.png');
  });

  test('help.html の 12 節はそれぞれ画面の図（help-*.png）を持つ', () => {
    const html = readSource(join('hosted', 'help.html'));
    const sections = [
      'setup',
      'project',
      'documents',
      'protocol',
      'schema',
      'pilot',
      'extract',
      'verify',
      'dashboard',
      'dual-review',
      'export',
      'options',
    ];
    for (const id of sections) {
      const start = html.indexOf(`<section id="${id}">`);
      expect(start).toBeGreaterThanOrEqual(0);
      const end = html.indexOf('<section ', start + 1);
      const body = html.slice(start, end === -1 ? undefined : end);
      expect(body).toContain('src="screenshots/help-');
    }
  });

  test('hosted/screenshots/ 直下の png はすべて index.html か help.html から参照されている', () => {
    const referenced = new Set<string>();
    for (const file of pages) {
      for (const match of readSource(join('hosted', file)).matchAll(/src="screenshots\/([^"]+)"/g)) {
        referenced.add(match[1] ?? '');
      }
    }
    const files = readdirSync(join(repoRoot, 'hosted', 'screenshots')).filter((name) =>
      name.endsWith('.png'),
    );
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      expect(referenced.has(name)).toBe(true);
    }
  });

  test('撮影コマンドのシーン一覧の出力ファイルは、help.html が参照する help-*.png と一致する', () => {
    const scenes = readSource(join('tools', 'help-shots', 'scenes.mjs'));
    const fromScenes = new Set(scenes.match(/help-\d{2}-[a-z-]+\.png/g) ?? []);
    const html = readSource(join('hosted', 'help.html'));
    const fromHelp = new Set(html.match(/help-\d{2}-[a-z-]+\.png/g) ?? []);
    expect(fromScenes.size).toBeGreaterThan(0);
    expect([...fromScenes].sort()).toEqual([...fromHelp].sort());
  });

  test('各ページの img は alt・data-en-alt・遅延読み込みを持つ', () => {
    for (const file of pages) {
      const html = readSource(join('hosted', file));
      const images = html.match(/<img\b[^>]*>/g) ?? [];
      expect(images.length).toBeGreaterThan(0);
      for (const tag of images) {
        expect(tag).toContain('alt=');
        expect(tag).toContain('data-en-alt=');
        expect(tag).toContain('loading="lazy"');
      }
    }
  });
});
