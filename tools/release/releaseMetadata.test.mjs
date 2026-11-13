// 実サービスを呼ばず、引用情報とリリース本文の更新・抽出を検証する。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { stampCitation, extractReleaseNotes, main } from './releaseMetadata.mjs';

test('引用情報の版と日付だけを更新し、LF・CRLF・末尾改行の有無を保つ', () => {
  for (const newline of ['\n', '\r\n']) {
    for (const trailing of ['', newline]) {
      const source = ['title: "日本語"', 'version: 0.1.0', 'date-released: "2026-01-01"', 'license: MIT'].join(newline) + trailing;
      const expected = source.replace('0.1.0', '1.2.3').replace('2026-01-01', '2026-11-13');
      assert.equal(stampCitation(source, '1.2.3', '2026-11-13'), expected);
      assert.equal(stampCitation('\uFEFF' + source, '1.2.3', '2026-11-13'), expected);
    }
  }
});

test('引用情報の行が欠ける場合と重複する場合は失敗する', () => {
  for (const source of ['', 'version: 0.1.0\n', 'date-released: "2026-01-01"\n', 'version: 0.1.0\nversion: 0.2.0\ndate-released: "2026-01-01"', 'version: 0.1.0\ndate-released: "2026-01-01"\ndate-released: "2026-02-01"']) {
    assert.throws(() => stampCitation(source, '1.2.3', '2026-11-13'), /ちょうど 1 つ/);
  }
});

test('対象版だけを抽出し、小見出し・日英の本文を保つ', () => {
  for (const newline of ['\n', '\r\n']) {
    const source = ['\uFEFF# 履歴', '## 未リリース / Unreleased', '未公開', '## v1.2.3（2026-11-13）', '', '### その他 / Other', '', '- 日本語', '  English', '', '## v1.2.2（2026-11-01）', '過去'].join(newline);
    assert.equal(extractReleaseNotes(source, '1.2.3'), '### その他 / Other\n\n- 日本語\n  English\n');
  }
  assert.equal(extractReleaseNotes('## v1.2.3（2026-11-13）\n最後の版', '1.2.3'), '最後の版\n');
});

test('対象版が無い・重複・空の場合は本文を生成しない', () => {
  for (const source of ['## v1.2.30（2026-11-13）\n別の版', '## v1.2.3（日付）\n本文\n## v1.2.3（日付）\n重複', '## v1.2.3（日付）\n\n## v1.2.2（日付）\n過去']) {
    assert.throws(() => extractReleaseNotes(source, '1.2.3'));
  }
});

test('版・日付の形式が不正なら失敗する', () => {
  for (const version of [undefined, 'v1.2.3', '1.2', '1x2x3']) {
    assert.throws(() => stampCitation('', version, '2026-11-13'), /版は/);
    assert.throws(() => extractReleaseNotes('', version), /版は/);
  }
  for (const date of [undefined, '2026-1-13', 'bad']) {
    assert.throws(() => stampCitation('', '1.2.3', date), /日付は/);
  }
});

test('CLI は一時ファイルを更新し、失敗時は入力と出力を壊さない', () => {
  const directory = mkdtempSync(join(tmpdir(), 'release-metadata-'));
  const root = pathToFileURL(directory + '/');
  const citation = join(directory, 'CITATION.cff');
  const changelog = join(directory, 'CHANGELOG.md');
  const notes = join(directory, 'notes.md');
  const errors = [];
  const deps = { root, error: (value) => errors.push(value) };
  try {
    writeFileSync(citation, 'version: 0.1.0\r\ndate-released: "2026-01-01"\r\n');
    assert.equal(main(['stamp', '1.2.3', '2026-11-13'], deps), 0);
    const stamped = readFileSync(citation, 'utf8');
    assert.equal(stamped, 'version: 1.2.3\r\ndate-released: "2026-11-13"\r\n');
    writeFileSync(changelog, '## v1.2.3（2026-11-13）\n\n本文\n');
    assert.equal(main(['notes', '1.2.3', notes], deps), 0);
    assert.equal(readFileSync(notes, 'utf8'), '本文\n');
    assert.equal(main(['stamp', 'bad', '2026-11-13'], deps), 1);
    assert.equal(readFileSync(citation, 'utf8'), stamped);
    assert.equal(main(['notes', '9.9.9', notes], deps), 1);
    assert.equal(readFileSync(notes, 'utf8'), '本文\n');
    for (const args of [[], ['unknown', '1.2.3', notes], ['notes', '1.2.3'], ['stamp', '1.2.3', '2026-11-13', 'extra']]) {
      assert.equal(main(args, deps), 1);
      assert.match(errors.at(-1), /使い方/);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('直接実行で不正な引数を終了コードに反映する', () => {
  // 通常の CLI として起動し、親のテスト用通信設定を引き継がない。
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, [new URL('./releaseMetadata.mjs', import.meta.url).pathname], { encoding: 'utf8', env });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /使い方/);
});

test('引用情報と Zenodo の著者順・所属・ORCID・版・資金が一致する', () => {
  const citation = readFileSync(new URL('../../CITATION.cff', import.meta.url), 'utf8');
  const zenodo = JSON.parse(readFileSync(new URL('../../.zenodo.json', import.meta.url), 'utf8'));
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  const authors = [...citation.matchAll(/  - family-names: (.+)\n    given-names: "(.+)"\n((?:    .+\n)*)/g)].map(([, family, given, details]) => {
    const creator = { name: `${family}, ${given}` };
    for (const [, key, value] of details.matchAll(/    (affiliation|orcid): "(.+)"/g)) {
      creator[key] = value.replace('https://orcid.org/', '');
    }
    return creator;
  });
  assert.deepEqual(authors.map(({ name }) => name), ['Kataoka, Yuki', 'So, Ryuhei', 'Watanabe, Jun', 'Ishida, Kentaro', 'Banno, Masahiro', 'Takayama, Tomohiro', 'Tsujimoto, Yasushi', 'Sato, Tomoo', 'Dohi, Eisuke', 'Furukawa, Toshi A.']);
  assert.deepEqual(zenodo.creators, authors);
  assert.ok(citation.includes(`\nversion: ${pkg.version}\n`));
  assert.equal(zenodo.notes, 'This work was supported by JSPS KAKENHI Grant Number 25K13585');
});
