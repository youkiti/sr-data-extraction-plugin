// 実リポジトリを使わず、履歴・差分・失敗を git の偽物で検査する。
import test from 'node:test';
import assert from 'node:assert/strict';
import { main, findRelease, parseCommits, unitLabel, classifyFiles } from './listHelpGaps.mjs';

const base = { hash: 'aaaaaaa000', shortHash: 'aaaaaaa', parents: ['previous'], subject: 'chore: リリース v1.0.0', body: '' };
const direct = { hash: 'bbbbbbb000', shortHash: 'bbbbbbb', parents: [base.hash], subject: '画面を修正', body: '' };
const merge = { hash: 'ccccccc000', shortHash: 'ccccccc', parents: [direct.hash, 'branch'], subject: 'Merge pull request #42 from feature', body: '設定の表示を改善\n\n詳細\n' };
const format = '%H%x1f%h%x1f%P%x1f%s%x1f%b%x1e';
const record = (commit) => [commit.hash, commit.shortHash, commit.parents.join(' '), commit.subject, commit.body].join('\x1f') + '\x1e\n';

function run(argv = [], { commits = [], files = {}, history = `${base.hash}\t${base.subject}\n`, failureAt } = {}) {
  const calls = [], logs = [], errors = [];
  const code = main(argv, {
    log: (line) => logs.push(line), error: (line) => errors.push(line),
    git: (args) => {
      assert.deepEqual(args.slice(0, 4), ['-c', 'core.quotepath=false', '-c', 'i18n.logOutputEncoding=UTF-8']);
      const command = args.slice(4);
      calls.push(command);
      if (command[0] === failureAt) throw Object.assign(new Error('git の失敗'), { stderr: 'fatal: 原因\n詳細\n' });
      if (command[0] === 'rev-parse') return base.hash + '\n';
      if (command[0] === 'diff') {
        const commit = commits.find((item) => item.hash === command[3]);
        assert.deepEqual(command, ['diff', '--name-only', commit.parents[0], commit.hash]);
        return (files[commit.hash] ?? []).join('\n');
      }
      if (command.includes('--format=%H%x09%s')) {
        assert.deepEqual(command, ['log', '--first-parent', '--format=%H%x09%s', 'HEAD']);
        return history;
      }
      if (command[1] === '-1') {
        assert.deepEqual(command, ['log', '-1', `--format=${format}`, base.hash]);
        return record(base);
      }
      assert.deepEqual(command, ['log', '--first-parent', `--format=${format}`, `${base.hash}..HEAD`]);
      return commits.map(record).join('');
    },
  });
  return { code, calls, logs, errors };
}

test('自動起点は最新のリリース件名だけを選ぶ', () => {
  assert.equal(findRelease(`new\t変更\nlatest\tchore: リリース v2.0.0\nold\tchore: リリース v1.0.0\n`), 'latest');
  const result = run();
  assert.equal(result.code, 0);
  assert.deepEqual(result.calls[1], ['rev-parse', '--verify', '--end-of-options', `${base.hash}^{commit}`]);
});

test('リリースが無ければ起点指定を案内し、要約は出さない', () => {
  const result = run([], { history: 'hash\t通常の変更\n' });
  assert.equal(result.code, 1);
  assert.deepEqual(result.logs, []);
  assert.deepEqual(result.errors, ['リリースのコミットが見つかりません。--since で起点を指定してください']);
});

test('--since は自動検索せず明示したリビジョンを使う', () => {
  const result = run(['--since', 'v0.9']);
  assert.equal(result.code, 0);
  assert.deepEqual(result.calls[0], ['rev-parse', '--verify', '--end-of-options', 'v0.9^{commit}']);
  assert.equal(result.calls.length, 3);
});

test('本文の改行を保持して PR の題を取り、番号なしと直接コミットはハッシュで表す', () => {
  assert.deepEqual(parseCommits(record(merge) + record(direct)), [merge, direct]);
  assert.equal(unitLabel(merge), '#42 設定の表示を改善');
  assert.equal(unitLabel({ ...merge, body: '' }), `#42 ${merge.subject}`);
  assert.equal(unitLabel({ ...merge, subject: '枝を統合' }), 'ccccccc 枝を統合');
  assert.equal(unitLabel(direct), 'bbbbbbb 画面を修正');
  assert.equal(unitLabel({ ...direct, subject: merge.subject }), `bbbbbbb ${merge.subject}`);
});

test('画面の4接頭辞とヘルプ変更の有無を3状態に分類する', () => {
  for (const prefix of ['src/app/', 'src/popup/', 'src/options/', 'src/lib/i18n/']) {
    assert.equal(classifyFiles([`${prefix}file.ts`]), 'gap');
    assert.equal(classifyFiles([`${prefix}file.ts`, 'hosted/help.html']), 'documented');
  }
  for (const files of [[], ['src/lib/other.ts'], ['tests/app.test.ts'], ['src/application/a.ts'], ['hosted/help.html']]) {
    assert.equal(classifyFiles(files), 'excluded');
  }
});

test('候補0件でも、記載あり・対象外を含む件数を1行で出す', () => {
  const result = run([], { commits: [merge, direct], files: { [merge.hash]: ['src/app/a.ts', 'hosted/help.html'], [direct.hash]: ['tests/a.ts'] } });
  assert.equal(result.code, 0);
  assert.deepEqual(result.logs, [`ヘルプ未記載の候補: 0 件（起点 aaaaaaa ${base.subject}、対象 2 件、うち画面を変えたもの 1 件）`]);
  assert.deepEqual(result.errors, []);
});

test('候補は古い順で対処を末尾に出し、停止フラグ付きだけ2を返す', () => {
  for (const flag of [false, true]) {
    const result = run(flag ? ['--fail-on-gaps'] : [], { commits: [merge, direct], files: { [merge.hash]: ['src/options/a.ts'], [direct.hash]: ['src/popup/a.ts'] } });
    assert.equal(result.code, flag ? 2 : 0);
    assert.deepEqual(result.logs, [
      `ヘルプ未記載の候補: 2 件（起点 aaaaaaa ${base.subject}、対象 2 件、うち画面を変えたもの 2 件）`,
      '  bbbbbbb 画面を修正', '  #42 設定の表示を改善',
      'ヘルプ（hosted/help.html）を直すか、確認済みなら npm run release に -HelpReviewed を付けてください',
    ]);
  }
  assert.equal(run(['--fail-on-gaps']).code, 0);
});

test('git がどの段階で失敗しても1を返し、0件と報告しない', () => {
  for (const failureAt of ['log', 'rev-parse', 'diff']) {
    const result = run(['--since', 'missing'], { commits: [merge], failureAt });
    assert.equal(result.code, 1);
    assert.deepEqual(result.logs, []);
    assert.deepEqual(result.errors, ['fatal: 原因 詳細']);
  }
});

test('不正な引数は使い方を出して1を返し、gitを呼ばない', () => {
  for (const args of [['--unknown'], ['--since'], ['--since', '--fail-on-gaps'], ['--since', ''], ['HEAD'], ['--since', 'a', '--since', 'b']]) {
    const result = run(args);
    assert.equal(result.code, 1);
    assert.deepEqual(result.calls, []);
    assert.deepEqual(result.logs, []);
    assert.match(result.errors[0], /^使い方:/);
  }
});
