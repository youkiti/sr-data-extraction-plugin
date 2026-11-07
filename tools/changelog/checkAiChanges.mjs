// AI の結果に影響する値を前回のリリースと比較する。
// 監視漏れや値の取得失敗を検出し、変更履歴の更新が必要なら案内する。
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { findRelease } from '../help/listHelpGaps.mjs';

const usage = '使い方: node tools/changelog/checkAiChanges.mjs [--since <リビジョン>] [--fail-on-unlogged]';
export const watchedValues = [
  { label: '既定モデル', path: 'src/lib/storage/settingsStore.ts', pattern: /export const FACTORY_DEFAULT_MODEL = '([^']+)';/ },
  { label: 'extract-data プロンプトの版数', path: 'src/features/extraction/skills/extractData.ts', name: 'EXTRACT_DATA_PROMPT_VERSION' },
  { label: 'relocate-quote プロンプトの版数', path: 'src/features/extraction/skills/relocateQuote.ts', name: 'RELOCATE_QUOTE_PROMPT_VERSION' },
  { label: 'draft-schema プロンプトの版数', path: 'src/features/schema/skills/draftSchema.ts', name: 'DRAFT_SCHEMA_PROMPT_VERSION' },
  { label: 'suggest-enum プロンプトの版数', path: 'src/features/schema/skills/suggestEnum.ts', name: 'SUGGEST_ENUM_PROMPT_VERSION' },
  { label: 'ask-paper プロンプトの版数', path: 'src/features/verification/skills/askPaper.ts', name: 'ASK_PAPER_PROMPT_VERSION' },
  { label: 'Gemini の推論の強さの既定', path: 'src/lib/llm/GeminiProvider.ts', pattern: /thinkingLevel: options\.reasoningEffort \?\? this\.reasoningEffort \?\? '([^']+)',/ },
].map((item) => ({ ...item, pattern: item.pattern ?? new RegExp(`export const ${item.name} = (\\d+);`) }));

export function parseArgs(argv) {
  let since;
  let failOnUnlogged = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--since' && since === undefined && argv[i + 1] && !argv[i + 1].startsWith('-')) {
      since = argv[++i];
    } else if (argv[i] === '--fail-on-unlogged' && !failOnUnlogged) {
      failOnUnlogged = true;
    } else {
      throw new Error(usage);
    }
  }
  return { since, failOnUnlogged };
}

export function formatReport(base, changes, updated) {
  const lines = [`AI の結果に影響する値の変更: ${changes.length} 件（起点 ${base.shortHash} ${base.subject}）`];
  lines.push(...changes.map((item) => `  ${item.label}: ${item.before ?? 'なし'} → ${item.after}`));
  if (changes.length && updated) {
    lines.push('CHANGELOG.md は起点から更新されています（記載内容は目で確かめてください）');
  } else if (changes.length) {
    lines.push('CHANGELOG.md が起点から更新されていません。変更を CHANGELOG.md の「未リリース / Unreleased」に書くか、確認済みなら npm run release に -ChangelogReviewed を付けてください');
  }
  return lines;
}

export function main(argv, deps = {}) {
  const git = deps.git ?? ((args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  const log = deps.log ?? console.log;
  const error = deps.error ?? console.error;
  const runGit = (args) => git(['-c', 'core.quotepath=false', '-c', 'i18n.logOutputEncoding=UTF-8', ...args]);
  try {
    const options = parseArgs(argv);
    // リリースのバンプは PR の側の親に入ることがあるので、first-parent に限らず日付の新しい順で探す。
    const since = options.since ?? findRelease(runGit(['log', '--format=%H%x09%s', 'HEAD']));
    const hash = runGit(['rev-parse', '--verify', '--end-of-options', `${since}^{commit}`]).trim();
    const [shortHash, subject] = runGit(['log', '-1', '--format=%h%x09%s', hash]).trim().split('\t');
    let matches;
    try {
      matches = runGit(['grep', '-n', '-E', 'export const [A-Z_]+_PROMPT_VERSION = ', 'HEAD', '--', 'src']);
    } catch (cause) {
      if (cause.status !== 1) {
        throw cause;
      }
      matches = '';
    }
    for (const line of matches.split(/\r?\n/)) {
      const match = line.match(/^HEAD:(.+):(\d+):.*export const ([A-Z_]+_PROMPT_VERSION) = /);
      if (match && !match[1].endsWith('.test.ts') && !watchedValues.some((item) => item.path === match[1] && item.name === match[3])) {
        throw new Error(`監視の表に ${match[1]} の ${match[3]} を追加してください`);
      }
    }
    const changes = [];
    for (const item of watchedValues) {
      let current;
      try {
        current = runGit(['show', `HEAD:${item.path}`]);
      } catch (cause) {
        throw new Error(`監視の表を確認してください: HEAD の ${item.path} を取得できません: ${cause.stderr?.toString().trim() || cause.message}`);
      }
      const after = current.match(item.pattern)?.[1];
      if (after === undefined) {
        throw new Error(`監視の表を確認してください: HEAD の ${item.path} で「${item.label}」が見つかりません`);
      }
      let previous = '';
      try {
        previous = runGit(['show', `${hash}:${item.path}`]);
      } catch (cause) {
        if (!/does not exist|exists on disk|not exist in/.test(cause.stderr?.toString() || cause.message)) {
          throw cause;
        }
      }
      const before = previous.match(item.pattern)?.[1];
      if (before !== after) {
        changes.push({ label: item.label, before, after });
      }
    }
    const updated = Boolean(runGit(['diff', '--name-only', hash, 'HEAD', '--', 'CHANGELOG.md']).trim());
    for (const line of formatReport({ shortHash, subject }, changes, updated)) {
      log(line);
    }
    return options.failOnUnlogged && changes.length && !updated ? 2 : 0;
  } catch (cause) {
    error(String(cause.stderr?.toString().trim() || cause.message || cause).replace(/\s*\r?\n\s*/g, ' '));
    return 1;
  }
}

// リンク経由でも直接実行を判定できるよう、実パスを比較する。
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2));
}
