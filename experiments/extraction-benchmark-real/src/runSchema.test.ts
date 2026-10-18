import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assertRunSchema, checkRunSchemas } from './runSchema';
import { localName } from './loadSchema';

test('旧 run は従来スキーマとして扱い、同一スキーマと空の出力先を許可する', () => {
  assert.doesNotThrow(() => assertRunSchema('benchmark-schema.json', [{ name: 'old.json' }]));
  assert.doesNotThrow(() => assertRunSchema('new.json', [{ name: 'run.json', schemaFile: 'new.json' }]));
  assert.doesNotThrow(() => assertRunSchema('new.json', []));
});
test('1 件でも異なるスキーマがあれば拒否する', () => {
  assert.throws(() => assertRunSchema('new.json', [{ name: 'old.json' }]));
  assert.throws(() => assertRunSchema('new.json', [{ name: 'a.json', schemaFile: 'new.json' }, { name: 'b.json', schemaFile: 'other.json' }]));
});
test('補助ファイルと JSON 以外は検査しない', () => {
  assert.doesNotThrow(() => assertRunSchema('new.json', [{ name: '_meta.json' }, { name: 'old.json.bak' }]));
});
test('環境変数の名前は既定値か単一名だけを許可する', () => {
  assert.equal(localName(undefined, 'gold'), 'gold');
  assert.equal(localName('gold-outcome', 'gold'), 'gold-outcome');
  for (const name of ['', '../a', 'a/b', 'a\\b', 'a..b']) assert.throws(() => localName(name, 'gold'));
});

test('ディレクトリ検査は混在を検出し、壊れた JSON の再試行判定を妨げない', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'run-schema-'));
  await writeFile(path.join(dir, 'broken.json'), '{');
  await writeFile(path.join(dir, '_meta.json'), '{}');
  await checkRunSchemas(dir, 'new.json');
  await writeFile(path.join(dir, 'run.json'), JSON.stringify({ schemaFile: 'new.json' }));
  await checkRunSchemas(dir, 'new.json');
  await assert.rejects(checkRunSchemas(dir, 'other.json'));
});
