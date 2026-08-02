// 公開ページ（GitHub Pages 配信）の URL 正典（issue #214）。
// ページ本体は hosted/ にあり、gh-pages ブランチのルートへ手動デプロイする
// （picker.html と同居。手順は hosted/README.md「公開ページ」節）。
//
// 静的 HTML（app.html / popup.html）は属性に直接 URL を書くためここを import できない。
// 両者の一致は tests/unit/lib/publicPages.test.ts が HTML を読んで検査する
// （ここを変えたら HTML 側も直す）。
const PAGES_ORIGIN = 'https://youkiti.github.io/sr-data-extraction-plugin';

/** ランディング（ストア掲載の「ウェブサイト」欄に指定する URL） */
export const SITE_URL = `${PAGES_ORIGIN}/`;

/** 使い方ガイド（app ヘッダ / popup フッタ / Options から新規タブで開く） */
export const HELP_URL = `${PAGES_ORIGIN}/help.html`;

/** プライバシーポリシー（ストア掲載の「プライバシーポリシー URL」に指定する URL） */
export const PRIVACY_POLICY_URL = `${PAGES_ORIGIN}/privacy-policy.html`;

/** 利用規約 */
export const TERMS_OF_SERVICE_URL = `${PAGES_ORIGIN}/terms-of-service.html`;
