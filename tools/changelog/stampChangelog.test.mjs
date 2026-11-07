// 一時ファイルで未リリース節の切り替えを検証する。
// 本文、改行、入力の誤りを確かめ、実際の変更履歴には触れない。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from './stampChangelog.mjs';

const heading = '## 未リリース / Unreleased';
const placeholder = '（まだありません / Nothing yet）';

function run(source, args = ['1.2.3', '2026-11-07']) {
  const directory = mkdtempSync(join(tmpdir(), 'stamp-changelog-'));
  const path = join(directory, 'CHANGELOG.md');
  try {
    writeFileSync(path, source, 'utf8');
    const logs = [];
    const errors = [];
    const code = main([...args, '--file', path], { log: (line) => logs.push(line), error: (line) => errors.push(line) });
    return { code, logs, errors, content: readFileSync(path, 'utf8') };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('前書きと過去の節を保ち、本文を新しい版の見出しに移す', () => {
  const source = `# 変更履歴 / Changelog\n\n前書き\n\n${heading}\n\n${placeholder}\n\n### AI の変更\n- モデルを更新\n\n## v1.2.2（2026-11-01）\n\n以前の内容\n`;
  const result = run(source);
  assert.equal(result.code, 0);
  assert.equal(result.content, `# 変更履歴 / Changelog\n\n前書き\n\n${heading}\n\n${placeholder}\n\n## v1.2.3（2026-11-07）\n\n### AI の変更\n- モデルを更新\n\n## v1.2.2（2026-11-01）\n\n以前の内容\n`);
  assert.deepEqual(result.logs, ['CHANGELOG.md の「未リリース」を v1.2.3（2026-11-07）へ切り替えました']);
});

test('未リリースが空なら記載なしを入れる', () => {
  for (const body of ['', `\n${placeholder}\n`]) {
    const result = run(`${heading}\n${body}`);
    assert.equal(result.code, 0);
    assert.equal(result.content, `${heading}\n\n${placeholder}\n\n## v1.2.3（2026-11-07）\n\n（記載なし / No notable changes）\n`);
  }
});

test('CRLF と末尾改行の有無を保ち、UTF-8 の BOM を付けない', () => {
  for (const newline of ['\n', '\r\n']) {
    for (const trailing of ['', newline]) {
      const result = run(`${heading}${newline}${newline}- 本文${trailing}`);
      assert.equal(result.code, 0);
      assert.equal(result.content, [heading, '', placeholder, '', '## v1.2.3（2026-11-07）', '', '- 本文'].join(newline) + trailing);
      assert.notEqual(result.content.charCodeAt(0), 0xfeff);
    }
  }
});

test('未リリースの見出しが無い場合と複数ある場合は書き換えない', () => {
  for (const source of ['# 変更履歴\n', `${heading}\n${heading}\n`]) {
    const result = run(source);
    assert.equal(result.code, 1);
    assert.equal(result.content, source);
    assert.match(result.errors[0], /ちょうど 1 つ/);
  }
});

test('既存の版への二重 stamp は書き換えない', () => {
  const source = `${heading}\n\n## v1.2.3（2026-11-01）\n`;
  const result = run(source);
  assert.equal(result.code, 1);
  assert.equal(result.content, source);
  assert.match(result.errors[0], /既にあります/);
});

test('version と日付の形や引数が不正なら書き換えない', () => {
  for (const args of [[], ['1.2', '2026-11-07'], ['v1.2.3', '2026-11-07'], ['1.2.3', '2026-1-07'], ['1.2.3', 'bad'], ['1.2.3', '2026-11-07', '--unknown']]) {
    const result = run(heading, args);
    assert.equal(result.code, 1);
    assert.equal(result.content, heading);
    assert.match(result.errors[0], /^使い方:/);
  }
});
