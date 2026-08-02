// 公開ページ URL の正典（issue #214）。静的 HTML（app.html / popup.html）は属性へ直接
// URL を書くため定数を import できない。ここで HTML を読んで一致を検査し、ドリフトを防ぐ
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  HELP_URL,
  PRIVACY_POLICY_URL,
  SITE_URL,
  TERMS_OF_SERVICE_URL,
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
  });

  test('popup.html のフッタ「使い方」は HELP_URL を新規タブで開く', () => {
    const html = readSource(join('src', 'popup', 'popup.html'));
    expect(html).toContain(`href="${HELP_URL}"`);
    expect(html).toMatch(
      /id="popup-open-help"[\s\S]*?target="_blank"[\s\S]*?rel="noopener noreferrer"/,
    );
  });
});
