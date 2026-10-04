import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { EXTRACT_DATA_PROMPT_VERSION } from '../../src/features/extraction/skills/extractData';
import { FACTORY_DEFAULT_MODEL } from '../../src/lib/storage/settingsStore';

const read = (file: string): string => readFileSync(join(process.cwd(), file), 'utf8');
const version: string = JSON.parse(read('package.json')).version;

function expectCopies(file: string, pattern: RegExp, expected: string): void {
  const matches = [...read(file).matchAll(pattern)];
  if (matches.length === 0) {
    throw new Error(`${file} の ${pattern.source} が見つかりません。文言と検査パターンを確認してください`);
  }
  for (const match of matches) {
    expect({ file, pattern: pattern.source, value: match[1] }).toEqual({
      file, pattern: pattern.source, value: expected,
    });
  }
}

describe('文書に転記した現在の値', () => {
  test('hosted/help.html の更新日はデプロイ時に置き換える印を3か所に保持する', () => {
    const help = read('hosted/help.html');
    expect(help.match(/__DEPLOY_DATE__/g)).toHaveLength(3);
    for (const prefix of ['最終更新: ', 'Last updated: ', 'version: ']) {
      expect(help).toContain(`${prefix}__DEPLOY_DATE__`);
    }
  });

  test('docs/project-facts.md の5項目は正の値と一致する（npm run facts で更新）', () => {
    const requirements = read('docs/requirements.md').split(/\r?\n/)[0];
    const heading = requirements?.match(/^# sr-data-extraction-plugin 要件定義書（(v\d+\.\d+)）$/);
    if (!heading) throw new Error('docs/requirements.md の先頭行から要件定義書の版を取得できません');
    const store = JSON.parse(read('docs/store/store-status.json'));
    const rows = [
      `| リポジトリの版 | v${version} | \`package.json\` の \`version\` |`,
      `| ストアの公開版 | v${store.publishedVersion}（掲載ページの更新日 ${store.publishedUpdatedOn}。${store.checkedOn} に確認） | \`docs/store/store-status.json\`（手で更新する） |`,
      `| 工場出荷の既定モデル | \`${FACTORY_DEFAULT_MODEL}\` | \`src/lib/storage/settingsStore.ts\` の \`FACTORY_DEFAULT_MODEL\` |`,
      `| extract-data プロンプトの版数 | ${EXTRACT_DATA_PROMPT_VERSION} | \`src/features/extraction/skills/extractData.ts\` の \`EXTRACT_DATA_PROMPT_VERSION\` |`,
      `| 要件定義書の版 | ${heading[1]} | \`docs/requirements.md\` の見出し |`,
    ];
    const lines = read('docs/project-facts.md').split(/\r?\n/);
    for (const row of rows) expect(lines).toContain(row);
  });

  test('hosted/help.html の日英4種の既定モデルを FACTORY_DEFAULT_MODEL に合わせる', () => {
    for (const pattern of [
      /工場出荷の既定は\s*<code>([^<]+)<\/code>/g,
      /factory default\s*<code>([^<]+)<\/code>/g,
      /既定は\s*<code>([^<]+)<\/code>\s*です/g,
      /The default is\s*<code>([^<]+)<\/code>/g,
    ]) expectCopies('hosted/help.html', pattern, FACTORY_DEFAULT_MODEL);
  });

  test('hosted/help.html の日英の対象バージョンを package.json に合わせる', () => {
    expectCopies('hosted/help.html', /対象バージョン: v([^\s<]+)/g, version);
    expectCopies('hosted/help.html', /Covers v([^\s<]+)/g, version);
  });

  test('docs/requirements.md の工場出荷の既定モデルを全件 FACTORY_DEFAULT_MODEL に合わせる', () => {
    expectCopies('docs/requirements.md', /工場出荷の既定モデル =\s*`([^`]+)`/g, FACTORY_DEFAULT_MODEL);
  });

  test('README.md に現在のストア公開版・リポジトリ版を手書きしない', () => {
    expect(read('README.md')).not.toMatch(/ストア公開は v|リポジトリの最新は v/);
  });
});
