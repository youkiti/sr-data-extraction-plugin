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

test('README の著作権節を収録し、作者名だけでは本文として扱わない', () => fixture((directory, write) => {
  write('README.md', '# パッケージ\n\n## License\n\nCopyright A\n本文\n\n## Usage\n別の説明');
  assert.deepEqual(readNotices(directory, {}), [{ file: 'README.md', text: 'Copyright A\n本文' }]);
  write('README.md', '説明だけ');
  assert.deepEqual(readNotices(directory, { author: '作者', license: 'MIT' }), []);
  assert.deepEqual(readNotices(directory, { author: { name: '作者' }, license: 'MIT' }), []);
  assert.deepEqual(readNotices(directory, {}), []);
  write('LICENSE', ' \n\t');
  assert.deepEqual(readNotices(directory, {}), []);
  write('README.md', '## License\nCopyright A');
  assert.deepEqual(readNotices(directory, {}), [{ file: 'README.md', text: 'Copyright A' }]);
}));

test('補足を名前と版で限定し、Zlib の本文を配布物の冒頭から読み取る', () => fixture((directory, write) => {
  const manifest = { name: 'pako', version: '1.0.11' };
  write('LICENSE', 'MIT 本文');
  write('lib/zlib/inflate.js', "'use strict';\r\n\r\n// (C) fixture\r\n//\r\n// 配布物の許諾文\r\n// 3. This notice may not be removed or altered from any source distribution.\r\n\r\nvar code = 1;");
  const notices = readNotices(directory, manifest);
  assert.equal(notices.length, 2);
  assert.deepEqual(notices[1], {
    file: '補足', source: 'lib/zlib/inflate.js', verified: true,
    text: '(C) fixture\n\n配布物の許諾文\n3. This notice may not be removed or altered from any source distribution.',
  });
  assert.equal(readNotices(directory, { ...manifest, version: '1.0.12' }).length, 1);
  assert.equal(readNotices(directory, { ...manifest, name: 'other' }).length, 1);
  write('package.json', JSON.stringify({ dependencies: { pako: '*' } }));
  write('package-lock.json', JSON.stringify({ packages: { 'node_modules/pako': { version: manifest.version } } }));
  write('node_modules/pako/package.json', JSON.stringify({ ...manifest, license: '(MIT AND Zlib)' }));
  write('node_modules/pako/LICENSE', 'MIT 本文');
  write('node_modules/pako/lib/zlib/inflate.js', readFileSync(join(directory, 'lib/zlib/inflate.js'), 'utf8'));
  const output = generateNotices(directory);
  assert.match(output, /MIT 本文/);
  assert.match(output, /配布物の許諾文/);
  assert.match(output, /補足の出典: node_modules\/pako\/lib\/zlib\/inflate.js/);
  assert.match(output, /確認済み: はい/);
  write('lib/zlib/inflate.js', '// 許諾文なし');
  assert.throws(() => readNotices(directory, manifest), /Zlib の許諾文が見つかりません/);
}));

test('本文のないパッケージでも版付き補足があれば生成と鮮度検査が成功する', () => fixture((directory, write) => {
  const name = 'dingbat-to-unicode';
  const version = '1.0.1';
  write('package.json', JSON.stringify({ dependencies: { [name]: '*' } }));
  write('package-lock.json', JSON.stringify({ packages: { [`node_modules/${name}`]: { version } } }));
  write(`node_modules/${name}/package.json`, JSON.stringify({ name, version, license: 'BSD-2-Clause', author: '作者 <author@example.com>' }));
  const output = generateNotices(directory);
  assert.match(output, /Copyright \(c\) 2021, Michael Williamson/);
  assert.doesNotMatch(output, /author@example\.com/);
  assert.ok(output.includes(readFileSync(new URL('./supplements/dingbat-to-unicode-1.0.1-LICENSE.txt', import.meta.url), 'utf8').trim()));
  assert.match(output, /Redistribution and use in source and binary forms/);
  assert.match(output, /https:\/\/github.com\/mwilliamson\/dingbat-to-unicode\/blob\/9eb2d1d8b8463b7bd3cd125597eabcfa9df42128\/js\/LICENSE/);
  assert.match(output, /確認済み: はい/);
  assert.equal(main([], directory), 0);
  assert.equal(main(['--check'], directory), 0);
}));

test('本文・表記・補足のないパッケージを全件並べて生成と鮮度検査を失敗させる', () => fixture((directory, write) => {
  write('package.json', JSON.stringify({ dependencies: { a: '*', b: '*' } }));
  write('package-lock.json', JSON.stringify({ packages: { 'node_modules/a': { version: '1' }, 'node_modules/b': { version: '1' } } }));
  for (const name of ['a', 'b']) {
    write(`node_modules/${name}/package.json`, JSON.stringify({ name, version: '1', license: name === 'a' ? 'MIT' : undefined, author: '作者' }));
  }
  write('node_modules/a/LICENSE', ' \n');
  write('THIRD_PARTY_NOTICES.md', '既存の本文');
  const errors = [];
  const logger = { log() {}, error: (text) => errors.push(text) };
  for (const args of [[], ['--check']]) {
    assert.equal(main(args, directory, logger), 1);
    assert.match(errors.at(-1), /ライセンス本文・著作権表記・補足がありません:\na@1 \(node_modules\/a\)\nb@1 \(node_modules\/b\)/);
    assert.equal(readFileSync(join(directory, 'THIRD_PARTY_NOTICES.md'), 'utf8'), '既存の本文');
  }
}));
