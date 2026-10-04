// コードと手動確認記録から現在の値を集約し、文書への転記のずれを防ぐ。
// 引数なしで生成、--check で鮮度検査、--stamp-help でヘルプの対象版も更新する。
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../../', import.meta.url);
const path = (file) => fileURLToPath(new URL(file, root));
const read = (file) => readFileSync(path(file), 'utf8');
const normalize = (text) => text.replace(/\r\n/g, '\n');

function readOptional(file) {
  try {
    return read(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function unique(text, pattern, file, value) {
  const matches = [...text.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(`${file} の ${value} を読み取れません（一致 ${matches.length} 件、1 件必要）`);
  }
  return matches[0];
}

try {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && !['--check', '--stamp-help'].includes(args[0]))) {
    throw new Error('使い方: node tools/facts/generateProjectFacts.mjs [--check | --stamp-help]');
  }
  const version = JSON.parse(read('package.json')).version;
  if (typeof version !== 'string') throw new Error('package.json の version が文字列ではありません');
  const modelFile = 'src/lib/storage/settingsStore.ts';
  const model = unique(read(modelFile), /^export const FACTORY_DEFAULT_MODEL = '([^'\r\n]+)';\r?$/gm, modelFile, 'FACTORY_DEFAULT_MODEL')[1];
  const promptFile = 'src/features/extraction/skills/extractData.ts';
  const prompt = unique(read(promptFile), /^export const EXTRACT_DATA_PROMPT_VERSION = (\d+);\r?$/gm, promptFile, 'EXTRACT_DATA_PROMPT_VERSION')[1];
  const requirementsFile = 'docs/requirements.md';
  const requirements = unique(read(requirementsFile), /^# sr-data-extraction-plugin 要件定義書（(v\d+\.\d+)）\r?$/gm, requirementsFile, '要件定義書の版')[1];
  const storeFile = 'docs/store/store-status.json';
  const store = JSON.parse(read(storeFile));
  for (const key of ['publishedVersion', 'publishedUpdatedOn', 'checkedOn']) {
    if (typeof store?.[key] !== 'string') throw new Error(`${storeFile} の ${key} が文字列ではありません`);
  }
  const generated = `# プロジェクトの現在の値（自動生成）

<!-- このファイルは tools/facts/generateProjectFacts.mjs が生成する。手で編集しない。
     値を変えるときは「正の場所」を変えてから \`npm run facts\` で作り直す。 -->

| 項目 | 値 | 正の場所 |
|---|---|---|
| リポジトリの版 | v${version} | \`package.json\` の \`version\` |
| ストアの公開版 | v${store.publishedVersion}（掲載ページの更新日 ${store.publishedUpdatedOn}。${store.checkedOn} に確認） | \`docs/store/store-status.json\`（手で更新する） |
| 工場出荷の既定モデル | \`${model}\` | \`src/lib/storage/settingsStore.ts\` の \`FACTORY_DEFAULT_MODEL\` |
| extract-data プロンプトの版数 | ${prompt} | \`src/features/extraction/skills/extractData.ts\` の \`EXTRACT_DATA_PROMPT_VERSION\` |
| 要件定義書の版 | ${requirements} | \`docs/requirements.md\` の見出し |

リポジトリの版がストアの公開版より新しいとき、その差は「zip 作成済み・ストア未反映」を意味する。
ストアへ提出・反映されたら \`docs/store/store-status.json\` を手で更新し、\`npm run facts\` を実行する。
`;
  const output = 'docs/project-facts.md';
  const current = readOptional(output);
  if (args[0] === '--check') {
    if (current === null || normalize(current) !== normalize(generated)) {
      throw new Error(`${output} が最新ではありません。npm run facts を実行してください`);
    }
  } else {
    let help;
    let stampedHelp;
    if (args[0] === '--stamp-help') {
      const file = 'hosted/help.html';
      help = read(file);
      stampedHelp = help;
      for (const pattern of [/(対象バージョン: v)(\d+\.\d+\.\d+)\b/g, /(Covers v)(\d+\.\d+\.\d+)\b/g]) {
        unique(help, pattern, file, pattern.source);
        stampedHelp = stampedHelp.replace(pattern, (_match, prefix) => `${prefix}${version}`);
      }
    }
    // CRLF の checkout（core.autocrlf）でも、内容が同じなら書き換えない
    const unchanged = current !== null && normalize(current) === generated;
    if (!unchanged) writeFileSync(path(output), generated, 'utf8');
    if (stampedHelp !== undefined && stampedHelp !== help) {
      writeFileSync(path('hosted/help.html'), stampedHelp, 'utf8');
    }
    console.log(`${output}: ${unchanged ? '変更なし' : '書いた'}`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
