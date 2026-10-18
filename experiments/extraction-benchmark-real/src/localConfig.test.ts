// 見本の形式と、不足キー・読込失敗時の診断を外部 API なしで確かめる。
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { loadLocalConfig } from './localConfig';

const examplePath = new URL('./local.example/benchmark.json', import.meta.url);

test('公開見本を同じローダーで読み込める', () => {
  const example = loadLocalConfig(fileURLToPath(examplePath));
  assert.deepEqual(example.targets.map((target) => target.pdfId), ['paper-a', 'paper-b']);
});

test('ファイル欠落・JSON 不正・配列内の不足キーを位置付きで拒否する', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'bench-config-'));
  const file = path.join(dir, 'benchmark.json');
  try {
    assert.throws(() => loadLocalConfig(file), (error: Error) =>
      error.message.includes(file) && error.message.includes('$') && error.message.includes('ENOENT'));
    writeFileSync(file, '{', 'utf8');
    assert.throws(() => loadLocalConfig(file), /キー \$ の JSON が不正/);
    const example = JSON.parse(readFileSync(examplePath, 'utf8'));
    delete example.probes.multiSelect.fields[0].instruction;
    writeFileSync(file, JSON.stringify(example), 'utf8');
    assert.throws(() => loadLocalConfig(file), (error: Error) =>
      error.message.includes(file) && error.message.includes('$.probes.multiSelect.fields[0].instruction'));
    example.probes.multiSelect.fields[0].instruction = '架空';
    example.targets = [];
    writeFileSync(file, JSON.stringify(example), 'utf8');
    assert.throws(() => loadLocalConfig(file), /キー \$\.targets /);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
