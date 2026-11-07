// 未リリース節の内容を指定した版と日付の見出しへ移す。
// 元の改行コードと末尾改行を保ち、空の未リリース節を残す。
import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const usage = '使い方: node tools/changelog/stampChangelog.mjs <version> <YYYY-MM-DD> [--file <path>]';
const unreleased = '## 未リリース / Unreleased';
const placeholder = '（まだありません / Nothing yet）';

export function main(argv, deps = {}) {
  const log = deps.log ?? console.log;
  const error = deps.error ?? console.error;
  try {
    const [version, date] = argv;
    if (!/^\d+\.\d+\.\d+$/.test(version ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || !(argv.length === 2 || (argv.length === 4 && argv[2] === '--file' && argv[3]))) {
      throw new Error(usage);
    }
    const path = argv[3] ?? fileURLToPath(new URL('../../CHANGELOG.md', import.meta.url));
    const source = readFileSync(path, 'utf8');
    const newline = source.includes('\r\n') ? '\r\n' : '\n';
    const trailing = source.endsWith('\n');
    const lines = source.replace(/^\uFEFF/, '').split(/\r?\n/);
    const headings = lines.flatMap((line, index) => line === unreleased ? [index] : []);
    if (headings.length !== 1) {
      throw new Error('「未リリース / Unreleased」の見出しはちょうど 1 つ必要です');
    }
    if (lines.some((line) => line.startsWith(`## v${version}（`))) {
      throw new Error(`v${version} の見出しは既にあります`);
    }
    const start = headings[0];
    let end = start + 1;
    while (end < lines.length && !lines[end].startsWith('## ')) {
      end++;
    }
    const body = lines.slice(start + 1, end).filter((line) => line.trim() !== placeholder);
    while (body.length && !body[0].trim()) {
      body.shift();
    }
    while (body.length && !body.at(-1).trim()) {
      body.pop();
    }
    const replacement = [unreleased, '', placeholder, '', `## v${version}（${date}）`, '', ...(body.length ? body : ['（記載なし / No notable changes）']), ''];
    const result = [...lines.slice(0, start), ...replacement, ...lines.slice(end)].join(newline).replace(/(?:\r?\n)+$/, '') + (trailing ? newline : '');
    writeFileSync(path, result, 'utf8');
    log(`CHANGELOG.md の「未リリース」を v${version}（${date}）へ切り替えました`);
    return 0;
  } catch (cause) {
    error(String(cause.message || cause).replace(/\s*\r?\n\s*/g, ' '));
    return 1;
  }
}

// リンク経由でも直接実行を判定できるよう、実パスを比較する。
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2));
}
