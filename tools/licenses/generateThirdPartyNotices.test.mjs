import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateNotices, main, productionPackages, readNotices, resolveDependency } from './generateThirdPartyNotices.mjs';

test('本番依存だけを辿り、巻き上げ・複数版・循環・任意依存を解決する', () => {
  const packages = {
    '': {},
    'node_modules/a': { dependencies: { b: '*', shared: '*' }, optionalDependencies: { optional: '*', '@napi-rs/canvas': '*' } },
    'node_modules/b': { dependencies: { a: '*', shared: '*' } },
    'node_modules/a/node_modules/shared': {},
    'node_modules/shared': {},
    'node_modules/optional': {},
    'node_modules/dev': {},
  };
  assert.deepEqual(productionPackages({ dependencies: { a: '*' }, devDependencies: { dev: '*' } }, { packages }), [
    'node_modules/a', 'node_modules/a/node_modules/shared', 'node_modules/b', 'node_modules/optional', 'node_modules/shared',
  ]);
  assert.deepEqual(productionPackages({}, { packages }), []);
  assert.throws(() => productionPackages({}, {}), /package-lock/);
  assert.throws(() => resolveDependency(packages, 'node_modules/a', 'missing'), /lockfile/);
});

function fixture(run) {
  const directory = mkdtempSync(join(tmpdir(), 'licenses-'));
  const write = (path, text) => {
    const parts = path.split('/');
    parts.pop();
    mkdirSync(join(directory, ...parts), { recursive: true });
    writeFileSync(join(directory, path), text);
  };
  try { run(directory, write); } finally { rmSync(directory, { recursive: true, force: true }); }
}

test('本文・NOTICE・資産を安定順で収録し、開発依存は混ぜない', () => fixture((directory, write) => {
  write('package.json', JSON.stringify({ dependencies: { a: '*' } }));
  write('package-lock.json', JSON.stringify({ packages: { 'node_modules/a': { version: '1' } } }));
  write('node_modules/a/package.json', JSON.stringify({ name: 'a', version: '1', license: 'MIT' }));
  write('node_modules/a/LICENSE', 'Copyright A  \r\n```\t\r\n');
  write('node_modules/a/NOTICE', '追加表記');
  write('node_modules/a/fonts/LICENSE_FONT', 'フォントの表記');
  write('node_modules/a/.hidden/LICENSE', '隠れた表記');
  write('node_modules/a/node_modules/dev/LICENSE', '開発依存');
  write('node_modules/a/license-update.mjs', '対象外');
  const output = generateNotices(directory);
  assert.match(output, /\| a \| 1 \| MIT \|/);
  assert.match(output, /````text\nCopyright A\n```\n````/);
  assert.match(output, /### fonts\/LICENSE_FONT/);
  assert.match(output, /### NOTICE/);
  assert.doesNotMatch(output, /隠れた表記|対象外\n|### node_modules/);
  assert.equal(output, generateNotices(directory));
  const errors = [];
  const logger = { log() {}, error: (text) => errors.push(text) };
  assert.equal(main(['--check'], directory, logger), 1);
  assert.match(errors.pop(), /最新ではありません/);
  assert.equal(main([], directory, logger), 0);
  assert.equal(main(['--check'], directory, logger), 0);
  write('THIRD_PARTY_NOTICES.md', output.replaceAll('\n', '\r\n'));
  assert.equal(main(['--check'], directory, logger), 0);
  write('THIRD_PARTY_NOTICES.md', '古い本文');
  assert.equal(main(['--check'], directory, logger), 1);
  assert.equal(readFileSync(join(directory, 'THIRD_PARTY_NOTICES.md'), 'utf8'), '古い本文');
  assert.equal(main(['--unknown'], directory, logger), 1);
  assert.match(errors.pop(), /使い方/);
  write('node_modules/a/LICENSE', 'The MIT License (MIT)\nCopyright A');
  write('node_modules/a/package.json', JSON.stringify({ name: 'a', version: '1' }));
  assert.match(generateNotices(directory), /\| a \| 1 \| MIT \|/);
  write('node_modules/a/LICENSE', '本文だけ');
  write('package-lock.json', JSON.stringify({ packages: { 'node_modules/a': { version: '1', license: 'ISC' } } }));
  assert.match(generateNotices(directory), /\| a \| 1 \| ISC \|/);
  write('package-lock.json', JSON.stringify({ packages: { 'node_modules/a': { version: '1' } } }));
  write('node_modules/a/package.json', JSON.stringify({ name: 'a', version: '2', license: 'MIT' }));
  assert.throws(() => generateNotices(directory), /版が lockfile と違います/);
  write('node_modules/a/package.json', JSON.stringify({ name: 'a', version: '1' }));
  assert.throws(() => generateNotices(directory), /ライセンス指定がありません/);
}));

test('README の著作権節と、配布元の本文欠落を扱う', () => fixture((directory, write) => {
  write('README.md', '# パッケージ\n\n## License\n\nCopyright A\n本文\n\n## Usage\n別の説明');
  assert.deepEqual(readNotices(directory, {}), [{ file: 'README.md', text: 'Copyright A\n本文' }]);
  write('README.md', '説明だけ');
  const fallback = readNotices(directory, { author: '作者', license: 'MIT' });
  assert.match(fallback[0].text, /作者: 作者/);
  assert.match(fallback[0].text, /著作権表記がありません/);
  assert.deepEqual(readNotices(directory, { author: { name: '作者' }, license: 'MIT' }), fallback);
  assert.throws(() => readNotices(directory, {}), /作者情報がありません/);
}));
