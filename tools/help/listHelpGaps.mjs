import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const usage = '使い方: node tools/help/listHelpGaps.mjs [--since <リビジョン>] [--fail-on-gaps]';
const commitFormat = '%H%x1f%h%x1f%P%x1f%s%x1f%b%x1e';
const screenPrefixes = ['src/app/', 'src/popup/', 'src/options/', 'src/lib/i18n/'];

export function parseArgs(argv) {
  let since;
  let failOnGaps = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--since' && since === undefined && argv[i + 1] && !argv[i + 1].startsWith('-')) {
      since = argv[++i];
    } else if (argv[i] === '--fail-on-gaps' && !failOnGaps) {
      failOnGaps = true;
    } else {
      throw new Error(usage);
    }
  }
  return { since, failOnGaps };
}

export function findRelease(log) {
  for (const line of log.split('\n')) {
    const tab = line.indexOf('\t');
    if (tab !== -1 && line.slice(tab + 1).startsWith('chore: リリース v')) return line.slice(0, tab);
  }
  throw new Error('リリースのコミットが見つかりません。--since で起点を指定してください');
}

export function parseCommits(log) {
  return log.split('\x1e').filter((record) => record.trim()).map((record) => {
    const [hash, shortHash, parents, subject, body] = record.trimStart().split('\x1f');
    return { hash, shortHash, parents: parents.split(' ').filter(Boolean), subject, body };
  });
}

export function unitLabel(commit) {
  const number = commit.parents.length >= 2 && commit.subject.match(/Merge pull request #(\d+)/);
  if (!number) return `${commit.shortHash} ${commit.subject}`;
  return `#${number[1]} ${commit.body.trim().split(/\r?\n/)[0] || commit.subject}`;
}

export function classifyFiles(files) {
  if (!files.some((file) => screenPrefixes.some((prefix) => file.startsWith(prefix)))) return 'excluded';
  return files.includes('hosted/help.html') ? 'documented' : 'gap';
}

export function formatReport(base, units) {
  const gaps = units.filter((unit) => unit.classification === 'gap');
  const screens = units.filter((unit) => unit.classification !== 'excluded');
  const lines = [`ヘルプ未記載の候補: ${gaps.length} 件（起点 ${base.shortHash} ${base.subject}、対象 ${units.length} 件、うち画面を変えたもの ${screens.length} 件）`];
  lines.push(...gaps.map((unit) => `  ${unitLabel(unit)}`));
  if (gaps.length) lines.push('ヘルプ（hosted/help.html）を直すか、確認済みなら npm run release に -HelpReviewed を付けてください');
  return lines;
}

export function main(argv, deps = {}) {
  const git = deps.git ?? ((args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  const log = deps.log ?? console.log;
  const error = deps.error ?? console.error;
  const runGit = (args) => git(['-c', 'core.quotepath=false', '-c', 'i18n.logOutputEncoding=UTF-8', ...args]);
  try {
    const options = parseArgs(argv);
    const since = options.since ?? findRelease(runGit(['log', '--first-parent', '--format=%H%x09%s', 'HEAD']));
    // 明示されたリビジョンをコミットへ解決してから、範囲や差分の引数に使う。
    const hash = runGit(['rev-parse', '--verify', '--end-of-options', `${since}^{commit}`]).trim();
    const [base] = parseCommits(runGit(['log', '-1', `--format=${commitFormat}`, hash]));
    const commits = parseCommits(runGit(['log', '--first-parent', `--format=${commitFormat}`, `${hash}..HEAD`])).reverse();
    const units = commits.map((commit) => {
      const files = runGit(['diff', '--name-only', commit.parents[0], commit.hash]).trim().split(/\r?\n/);
      return { ...commit, classification: classifyFiles(files) };
    });
    for (const line of formatReport(base, units)) log(line);
    return options.failOnGaps && units.some((unit) => unit.classification === 'gap') ? 2 : 0;
  } catch (cause) {
    error(String(cause.stderr?.toString().trim() || cause.message || cause).replace(/\s*\r?\n\s*/g, ' '));
    return 1;
  }
}

// 直接実行の判定は実パスで比べる（ドライブ文字の大小やリンク経由の違いで、何も実行せず 0 で終わるのを防ぐ）
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2));
}
