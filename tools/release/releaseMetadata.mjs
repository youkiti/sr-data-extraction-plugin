// 引用情報の版と日付を更新し、GitHub Release 用の本文を取り出す。
import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function checkVersion(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
    throw new Error('版は x.y.z で指定してください');
  }
}

export function stampCitation(source, version, date) {
  checkVersion(version);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) {
    throw new Error('日付は YYYY-MM-DD で指定してください');
  }
  // CRLF の CR を値に含めず、改行と末尾改行をそのまま残す。
  for (const [key, value] of [['version', version], ['date-released', `"${date}"`]]) {
    const pattern = new RegExp(`^${key}: [^\\r\\n]*`, 'gm');
    if ([...source.matchAll(pattern)].length !== 1) {
      throw new Error(`CITATION.cff の ${key} 行はちょうど 1 つ必要です`);
    }
    source = source.replace(pattern, `${key}: ${value}`);
  }
  return source.replace(/^\uFEFF/, '');
}

export function extractReleaseNotes(source, version) {
  checkVersion(version);
  const lines = source.replace(/^\uFEFF/, '').split(/\r?\n/);
  const starts = lines.flatMap((line, index) => line.startsWith(`## v${version}（`) ? [index] : []);
  if (starts.length !== 1) {
    throw new Error(`CHANGELOG.md の v${version} 節はちょうど 1 つ必要です`);
  }
  const start = starts[0] + 1;
  let end = start;
  while (end < lines.length && !lines[end].startsWith('## ')) end++;
  const body = lines.slice(start, end).join('\n').trim();
  if (!body) throw new Error(`CHANGELOG.md の v${version} 節が空です`);
  return body + '\n';
}

export function main(argv, deps = {}) {
  try {
    const [command, version, value] = argv;
    if (argv.length !== 3 || !['stamp', 'notes'].includes(command)) {
      throw new Error('使い方: releaseMetadata.mjs stamp <version> <YYYY-MM-DD> または notes <version> <出力先>');
    }
    const root = deps.root ?? new URL('../../', import.meta.url);
    if (command === 'stamp') {
      const path = new URL('CITATION.cff', root);
      writeFileSync(path, stampCitation(readFileSync(path, 'utf8'), version, value), 'utf8');
    } else {
      writeFileSync(value, extractReleaseNotes(readFileSync(new URL('CHANGELOG.md', root), 'utf8'), version), 'utf8');
    }
    return 0;
  } catch (cause) {
    (deps.error ?? console.error)(cause.message);
    return 1;
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2));
}
