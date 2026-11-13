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
  const files = legalFiles(directory);
  if (files.length) return files.map((file) => ({ file, text: noticeText(readFileSync(join(directory, file), 'utf8')) }));
  for (const file of readdirSync(directory).sort(compare).filter((name) => /^readme(?:\.|$)/i.test(name))) {
    const text = normalize(readFileSync(join(directory, file), 'utf8'));
    const section = text.match(/^#{1,6} Licen[cs]e[^\n]*\n([\s\S]*?)(?=^#{1,6} |$(?![\s\S]))/im);
    if (section && /copyright/i.test(section[1])) return [{ file, text: noticeText(section[1]) }];
  }
  // 配布元が著作権表記を含めていない場合、推測せず作者情報と欠落を明示する。
  if (manifest.author) {
    const author = typeof manifest.author === 'string' ? manifest.author : manifest.author.name;
    return [{ file: 'package.json', text: `作者: ${author}\n配布元パッケージにライセンス本文・著作権表記がありません。\nライセンス指定: ${manifest.license}` }];
  }
  throw new Error(`ライセンス本文・著作権表記・作者情報がありません: ${directory}`);
}

export function generateNotices(directory) {
  const readJson = (file) => JSON.parse(readFileSync(join(directory, file), 'utf8'));
  const lock = readJson('package-lock.json');
  const paths = productionPackages(readJson('package.json'), lock);
  const records = paths.map((path) => {
    const manifest = readJson(`${path}/package.json`);
    const locked = lock.packages[path];
    if (manifest.version !== locked.version) throw new Error(`インストール済みの版が lockfile と違います: ${path}`);
    const notices = readNotices(join(directory, path), manifest);
    const license = manifest.license || locked.license || (notices.some((notice) => /^The MIT License \(MIT\)/m.test(notice.text)) ? 'MIT' : null);
    if (typeof license !== 'string') throw new Error(`ライセンス指定がありません: ${path}`);
    return { name: manifest.name, version: manifest.version, license, path, notices };
  });
  let output = `# サードパーティライセンス表記\n\n<!-- tools/licenses/generateThirdPartyNotices.mjs が生成する。手で編集しない。 -->\n\n\`npm run licenses\` で更新し、\`npm run licenses:check\` で鮮度を検査する。\n\n対象は package.json の dependencies と、package-lock.json で解決した推移的な本番依存（任意依存を含む）。\n取りこぼしを避けるため、バンドル最適化で除かれるモジュールや型定義も含めた保守的な一覧とする。\nPDF.js の Node.js 専用の任意依存 @napi-rs/canvas とそのプラットフォーム別バイナリ、開発専用の依存は対象外。\nインストール済みパッケージのライセンス・NOTICE と付属資産の表記を収録する。\n配布元に本文・著作権表記がない場合は作者情報と欠落を明記する。\n\n| パッケージ | 版 | ライセンス |\n|---|---|---|\n`;
  for (const record of records) output += `| ${record.name} | ${record.version} | ${record.license.replaceAll('|', '\\|')} |\n`;
  for (const record of records) {
    output += `\n## ${record.name} (${record.version})\n\nライセンス: ${record.license}\n\n出典: \`${record.path}\`\n`;
    for (const notice of record.notices) {
      const fence = '`'.repeat(Math.max(3, ...[...notice.text.matchAll(/`+/g)].map((match) => match[0].length + 1)));
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
