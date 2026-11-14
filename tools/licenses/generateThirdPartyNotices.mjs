// 本番依存の解決済みツリーと、インストール済みのライセンスを集約する。
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const normalize = (text) => text.replace(/\r\n/g, '\n');
const noticeText = (text) => normalize(text).replace(/[\t ]+$/gm, '').trim();
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

// PDF.js の Node.js 専用 canvas はブラウザ用バンドルでは使われない。
const excluded = new Set(['@napi-rs/canvas']);

// 配布物だけでは不足する許諾文を、確認したパッケージ名と版に限定して補う。
const supplements = {
  'pako@1.0.11': {
    source: 'lib/zlib/inflate.js',
    verified: true,
    read(directory) {
      const source = normalize(readFileSync(join(directory, this.source), 'utf8'));
      const header = source.match(/^\/\/ \(C\)[\s\S]*?^\/\/ 3\. This notice may not be removed or altered from any source distribution\.$/m);
      if (!header) {
        throw new Error(`Zlib の許諾文が見つかりません: ${directory}/${this.source}`);
      }
      return header[0].replace(/^\/\/ ?/gm, '');
    },
  },
  'dingbat-to-unicode@1.0.1': {
    source: 'https://github.com/mwilliamson/dingbat-to-unicode/blob/9eb2d1d8b8463b7bd3cd125597eabcfa9df42128/js/LICENSE',
    verified: true,
    read() {
      return readFileSync(new URL('./supplements/dingbat-to-unicode-1.0.1-LICENSE.txt', import.meta.url), 'utf8');
    },
  },
};

export function resolveDependency(packages, from, name) {
  let directory = from;
  while (true) {
    const candidate = posix.join(directory, 'node_modules', name);
    if (packages[candidate]) return candidate;
    if (!directory) throw new Error(`依存が lockfile にありません: ${from || '(root)'} -> ${name}`);
    directory = posix.dirname(directory);
    if (directory === '.') directory = '';
  }
}

export function productionPackages(manifest, lock) {
  if (!lock.packages) throw new Error('packages を持つ package-lock.json が必要です');
  const visited = new Set();
  function visit(from, dependencies) {
    for (const name of Object.keys(dependencies).sort(compare)) {
      if (excluded.has(name)) continue;
      const path = resolveDependency(lock.packages, from, name);
      if (visited.has(path)) continue;
      visited.add(path);
      const entry = lock.packages[path];
      visit(path, { ...entry.dependencies, ...entry.optionalDependencies });
    }
  }
  visit('', manifest.dependencies || {});
  return [...visited].sort(compare);
}

export function legalFiles(directory, prefix = '') {
  const files = [];
  for (const entry of readdirSync(join(directory, prefix), { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const relative = posix.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...legalFiles(directory, relative));
    else if (/^(?:licen[cs]e|copying|copyright|notice)(?:$|[._-])/i.test(entry.name) && !/\.(?:[cm]?js|ts)$/i.test(entry.name)) files.push(relative);
  }
  return files.sort(compare);
}

export function readNotices(directory, manifest) {
  const notices = legalFiles(directory)
    .map((file) => ({ file, text: noticeText(readFileSync(join(directory, file), 'utf8')) }))
    .filter((notice) => notice.text);
  if (!notices.length) {
    for (const file of readdirSync(directory).sort(compare).filter((name) => /^readme(?:\.|$)/i.test(name))) {
      const text = normalize(readFileSync(join(directory, file), 'utf8'));
      const section = text.match(/^#{1,6} Licen[cs]e[^\n]*\n([\s\S]*?)(?=^#{1,6} |$(?![\s\S]))/im);
      if (section && /copyright/i.test(section[1])) {
        notices.push({ file, text: noticeText(section[1]) });
        break;
      }
    }
  }
  const supplement = supplements[`${manifest.name}@${manifest.version}`];
  if (supplement) {
    notices.push({ file: '補足', source: supplement.source, verified: supplement.verified, text: noticeText(supplement.read(directory, manifest)) });
  }
  return notices;
}

export function generateNotices(directory) {
  const readJson = (file) => JSON.parse(readFileSync(join(directory, file), 'utf8'));
  const lock = readJson('package-lock.json');
  const paths = productionPackages(readJson('package.json'), lock);
  const missing = [];
  const records = paths.map((path) => {
    const manifest = readJson(`${path}/package.json`);
    const locked = lock.packages[path];
    if (manifest.version !== locked.version) throw new Error(`インストール済みの版が lockfile と違います: ${path}`);
    const notices = readNotices(join(directory, path), manifest);
    if (!notices.length) {
      missing.push(`${manifest.name}@${manifest.version} (${path})`);
      return null;
    }
    const license = manifest.license || locked.license || (notices.some((notice) => /^The MIT License \(MIT\)/m.test(notice.text)) ? 'MIT' : null);
    if (typeof license !== 'string') throw new Error(`ライセンス指定がありません: ${path}`);
    return { name: manifest.name, version: manifest.version, license, path, notices };
  });
  if (missing.length) {
    throw new Error(`ライセンス本文・著作権表記・補足がありません:\n${missing.join('\n')}`);
  }
  let output = `# サードパーティライセンス表記\n\n<!-- tools/licenses/generateThirdPartyNotices.mjs が生成する。手で編集しない。 -->\n\n\`npm run licenses\` で更新し、\`npm run licenses:check\` で鮮度を検査する。\n\n対象は package.json の dependencies と、package-lock.json で解決した推移的な本番依存（任意依存を含む）。\n取りこぼしを避けるため、バンドル最適化で除かれるモジュールや型定義も含めた保守的な一覧とする。\nPDF.js の Node.js 専用の任意依存 @napi-rs/canvas とそのプラットフォーム別バイナリ、開発専用の依存は対象外。\nインストール済みパッケージのライセンス・NOTICE と付属資産の表記を収録する。\n補足の許諾文には出典と確認状態を記し、本文・著作権表記・補足がない場合は生成を失敗させる。\n\n| パッケージ | 版 | ライセンス |\n|---|---|---|\n`;
  for (const record of records) output += `| ${record.name} | ${record.version} | ${record.license.replaceAll('|', '\\|')} |\n`;
  for (const record of records) {
    output += `\n## ${record.name} (${record.version})\n\nライセンス: ${record.license}\n\n出典: \`${record.path}\`\n`;
    for (const notice of record.notices) {
      const fence = '`'.repeat(Math.max(3, ...[...notice.text.matchAll(/`+/g)].map((match) => match[0].length + 1)));
      if (notice.source) {
        const source = notice.source.startsWith('https://') ? notice.source : posix.join(record.path, notice.source);
        output += `\n補足の出典: ${source}\n\n確認済み: ${notice.verified ? 'はい' : 'いいえ（上流未確認の仮の文面。SPDX BSD-2-Clause 標準文面と package.json の author を使用）'}\n`;
      }
      output += `\n### ${notice.file}\n\n${fence}text\n${notice.text}\n${fence}\n`;
    }
  }
  return output;
}

export function main(args, directory = root, logger = console) {
  try {
    if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) throw new Error('使い方: node tools/licenses/generateThirdPartyNotices.mjs [--check]');
    const generated = generateNotices(directory);
    const path = join(directory, 'THIRD_PARTY_NOTICES.md');
    let current = null;
    try { current = normalize(readFileSync(path, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (args[0] === '--check') {
      if (current !== generated) throw new Error('THIRD_PARTY_NOTICES.md が最新ではありません。npm run licenses を実行してください');
    } else {
      if (current !== generated) writeFileSync(path, generated, 'utf8');
      logger.log(`THIRD_PARTY_NOTICES.md: ${current === generated ? '変更なし' : '書いた'}`);
    }
    return 0;
  } catch (error) {
    logger.error(error.message);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
