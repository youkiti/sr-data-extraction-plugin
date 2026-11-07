// 実リポジトリを使わず、値の比較と監視漏れを検証する。
// git の偽物を注入し、終了コードと利用者向けの案内を確かめる。
import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from './checkAiChanges.mjs';

const hash = 'aaaaaaa000';
const files = {
  'src/lib/storage/settingsStore.ts': "export const FACTORY_DEFAULT_MODEL = 'model';",
  'src/features/extraction/skills/extractData.ts': 'export const EXTRACT_DATA_PROMPT_VERSION = 13;',
  'src/features/extraction/skills/relocateQuote.ts': 'export const RELOCATE_QUOTE_PROMPT_VERSION = 2;',
  'src/features/schema/skills/draftSchema.ts': 'export const DRAFT_SCHEMA_PROMPT_VERSION = 4;',
  'src/features/schema/skills/suggestEnum.ts': 'export const SUGGEST_ENUM_PROMPT_VERSION = 1;',
  'src/features/verification/skills/askPaper.ts': 'export const ASK_PAPER_PROMPT_VERSION = 1;',
  'src/lib/help/consult/prompt.ts': 'export const HELP_CONSULT_PROMPT_VERSION = 1;',
  'src/lib/llm/GeminiProvider.ts': "thinkingLevel: options.reasoningEffort ?? this.reasoningEffort ?? 'low',",
};
const grep = Object.entries(files).filter(([, value]) => value.includes('_PROMPT_VERSION')).map(([path, value]) => `HEAD:${path}:1:${value}`).join('\n');

function run(argv = [], { before = {}, after = {}, updated = false, matches = grep, failureAt } = {}) {
  const calls = [];
  const logs = [];
  const errors = [];
  const code = main(argv, {
    log: (line) => logs.push(line),
    error: (line) => errors.push(line),
    git: (args) => {
      assert.deepEqual(args.slice(0, 4), ['-c', 'core.quotepath=false', '-c', 'i18n.logOutputEncoding=UTF-8']);
      const command = args.slice(4);
      calls.push(command);
      if (command[0] === failureAt) {
        throw Object.assign(new Error('git の失敗'), { stderr: 'fatal: 原因\n詳細\n' });
      }
      if (command[0] === 'rev-parse') {
        return hash + '\n';
      }
      if (command[0] === 'grep') {
        assert.deepEqual(command, ['grep', '-n', '-E', 'export const [A-Z_]+_PROMPT_VERSION = ', 'HEAD', '--', 'src']);
        return matches;
      }
      if (command[0] === 'diff') {
        assert.deepEqual(command, ['diff', '--name-only', hash, 'HEAD', '--', 'CHANGELOG.md']);
        return updated ? 'CHANGELOG.md\n' : '';
      }
      if (command[0] === 'show') {
        const [rev, path] = command[1].split(':');
        const content = { ...files, ...(rev === 'HEAD' ? after : before) }[path];
        if (content === null) {
          throw Object.assign(new Error('missing'), { status: 128, stderr: `fatal: path '${path}' does not exist in '${rev}'` });
        }
        assert.ok(content !== undefined);
        return content;
      }
      if (command[1] === '-1') {
        assert.deepEqual(command, ['log', '-1', '--format=%h%x09%s', hash]);
        return 'aaaaaaa\tchore: リリース v1.0.0\n';
      }
      assert.deepEqual(command, ['log', '--format=%H%x09%s', 'HEAD']);
      return `${hash}\tchore: リリース v1.0.0\n`;
    },
  });
  return { code, calls, logs, errors };
}

test('変更なしは 0 件で成功する', () => {
  const result = run(['--fail-on-unlogged']);
  assert.equal(result.code, 0);
  assert.deepEqual(result.logs, ['AI の結果に影響する値の変更: 0 件（起点 aaaaaaa chore: リリース v1.0.0）']);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.calls[1], ['rev-parse', '--verify', '--end-of-options', `${hash}^{commit}`]);
});

test('既定モデル変更と変更履歴の有無に応じて案内と終了コードを返す', () => {
  for (const flag of [false, true]) {
    for (const updated of [false, true]) {
      const result = run(flag ? ['--fail-on-unlogged'] : [], { before: { 'src/lib/storage/settingsStore.ts': "export const FACTORY_DEFAULT_MODEL = 'old';" }, updated });
      assert.equal(result.code, flag && !updated ? 2 : 0);
      assert.deepEqual(result.logs.slice(0, 2), [
        'AI の結果に影響する値の変更: 1 件（起点 aaaaaaa chore: リリース v1.0.0）',
        '  既定モデル: old → model',
      ]);
      assert.equal(result.logs[2], updated
        ? 'CHANGELOG.md は起点から更新されています（記載内容は目で確かめてください）'
        : 'CHANGELOG.md が起点から更新されていません。変更を CHANGELOG.md の「未リリース / Unreleased」に書くか、確認済みなら npm run release に -ChangelogReviewed を付けてください');
    }
  }
});

test('起点でファイルや定数が無い値は「なし」として変更に数える', () => {
  for (const content of [null, '古いファイル']) {
    const result = run([], { before: { 'src/features/verification/skills/askPaper.ts': content } });
    assert.equal(result.code, 0);
    assert.match(result.logs[1], /ask-paper プロンプトの版数: なし → 1$/);
  }
});

test('HEAD の値が無い場合は監視の表の確認を求める', () => {
  for (const content of [null, '形式が変わった']) {
    const result = run([], { after: { 'src/lib/storage/settingsStore.ts': content } });
    assert.equal(result.code, 1);
    assert.match(result.errors[0], /監視の表を確認してください/);
    assert.deepEqual(result.logs, []);
  }
});

test('表に無いファイルと定数の組を検出し、テストファイルは除外する', () => {
  for (const extra of ['HEAD:src/new.ts:2:export const NEW_PROMPT_VERSION = 1;', 'HEAD:src/new.ts:2:export const ASK_PAPER_PROMPT_VERSION = 1;']) {
    const result = run([], { matches: grep + '\n' + extra });
    assert.equal(result.code, 1);
    assert.match(result.errors[0], /監視の表に src\/new.ts の .* を追加してください/);
  }
  assert.equal(run([], { matches: grep + '\nHEAD:src/new.test.ts:2:export const NEW_PROMPT_VERSION = 1;' }).code, 0);
});

test('--since をコミットに解決して比較に使う', () => {
  const result = run(['--since', 'v0.12']);
  assert.equal(result.code, 0);
  assert.deepEqual(result.calls[0], ['rev-parse', '--verify', '--end-of-options', 'v0.12^{commit}']);
});

test('引数の誤りでは git を呼ばない', () => {
  for (const args of [['--unknown'], ['--since'], ['--since', '--fail-on-unlogged'], ['--since', ''], ['HEAD'], ['--since', 'a', '--since', 'b'], ['--fail-on-unlogged', '--fail-on-unlogged']]) {
    const result = run(args);
    assert.equal(result.code, 1);
    assert.deepEqual(result.calls, []);
    assert.match(result.errors[0], /^使い方:/);
  }
});

test('git の失敗を変更なしとして扱わない', () => {
  for (const failureAt of ['log', 'rev-parse', 'grep', 'show', 'diff']) {
    const result = run([], { failureAt });
    assert.equal(result.code, 1);
    assert.match(result.errors[0], /fatal: 原因 詳細/);
    assert.deepEqual(result.logs, []);
  }
});
