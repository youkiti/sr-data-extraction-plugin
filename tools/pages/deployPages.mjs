// hosted/ の公開ページを gh-pages へ配信し、ヘルプの更新日をデプロイ日にする。
// 使い方: node tools/pages/deployPages.mjs [--dry-run] [--date=YYYY-MM-DD] [--force] [--help]
// 規約 2 ページの最終更新は改定日なので変更しない。他ファイルの version: も
// 内容の版（picker.html は拡張とのハンドシェイクに関わる）なので書き換えない。
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const marker = '__DEPLOY_DATE__';

function git(args, options = {}) {
  try {
    return execFileSync('git', args, {
      cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...options,
    }).trim();
  } catch (error) {
    throw new Error(`git ${args[0]} に失敗しました: ${error.stderr?.toString().trim() || error.message}`);
  }
}

function main() {
  const args = process.argv.slice(2);
  let date;
  for (const arg of args) {
    if (['--dry-run', '--force', '--help'].includes(arg)) continue;
    if (arg.startsWith('--date=')) {
      date = arg.slice('--date='.length);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error('--date は YYYY-MM-DD 形式で指定してください');
      }
    } else {
      throw new Error(`未知の引数です: ${arg}`);
    }
  }
  if (args.includes('--help')) {
    console.log('使い方: node tools/pages/deployPages.mjs [--dry-run] [--date=YYYY-MM-DD] [--force] [--help]');
    console.log('--dry-run: 差分を表示し、push しません（コミットオブジェクトは作成します）');
    console.log('--date: ヘルプの更新日を指定します（既定はマシンのローカル日付）');
    console.log('--force: HEAD と origin/master の不一致だけを警告にします');
    return;
  }

  git(['fetch', 'origin', 'master', 'gh-pages']);
  if (git(['status', '--porcelain', '--', 'hosted'])) {
    throw new Error('hosted/ に未コミットの変更があります。--force でもデプロイできません');
  }
  const head = git(['rev-parse', 'HEAD']);
  if (head !== git(['rev-parse', 'origin/master'])) {
    const message = 'HEAD が origin/master と一致しません';
    if (!args.includes('--force')) throw new Error(message);
    console.warn(`警告: ${message}。--force により続行します`);
  }

  const files = [
    'index.html', 'help.html', 'privacy-policy.html', 'terms-of-service.html',
    'picker.html', 'style.css', 'lang.js',
  ];
  const screenshots = readdirSync(join(root, 'hosted/screenshots'), { withFileTypes: true });
  files.push(...screenshots.filter((entry) => entry.isFile()).map((entry) => `screenshots/${entry.name}`).sort());
  if (date === undefined) {
    const now = new Date();
    date = `${String(now.getFullYear()).padStart(4, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }
  const contents = files.map((file) => {
    let content = readFileSync(join(root, 'hosted', file));
    if (file === 'help.html') {
      const text = content.toString('utf8');
      const count = text.split(marker).length - 1;
      if (count !== 3) throw new Error(`help.html の ${marker} はちょうど 3 件必要です（現在 ${count} 件）`);
      content = Buffer.from(text.replaceAll(marker, date), 'utf8');
    }
    if (content.includes(marker)) throw new Error(`${file} に ${marker} が残っています`);
    if (['.html', '.css', '.js'].includes(extname(file))) {
      content = Buffer.from(content.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
    }
    return { file, content };
  });

  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'srde-pages-'));
  let commit;
  try {
    const env = { ...process.env, GIT_INDEX_FILE: join(temporaryDirectory, 'index') };
    git(['read-tree', 'origin/gh-pages'], { env });
    for (const { file, content } of contents) {
      const sha = git(['hash-object', '-w', '--no-filters', '--stdin'], { env, input: content });
      git(['update-index', '--add', '--cacheinfo', `100644,${sha},${file}`], { env });
    }
    const tree = git(['write-tree'], { env });
    if (tree === git(['rev-parse', 'origin/gh-pages^{tree}'])) {
      console.log('変更なし。デプロイしません');
      return;
    }
    const shortHead = git(['rev-parse', '--short', head]);
    commit = git(['commit-tree', tree, '-p', 'origin/gh-pages', '-m', `公開ページを再デプロイ（${date}・master ${shortHead}）`], { env });
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
  console.log(git(['diff', '--stat', 'origin/gh-pages', commit]));
  if (args.includes('--dry-run')) {
    console.log('dry-run: push しません');
    return;
  }
  git(['push', 'origin', `${commit}:refs/heads/gh-pages`]);
  console.log('デプロイしました。反映まで 1 分ほどかかります');
  console.log('https://youkiti.github.io/sr-data-extraction-plugin/');
  console.log('https://youkiti.github.io/sr-data-extraction-plugin/help.html');
}

try {
  main();
} catch (error) {
  console.error(`デプロイに失敗しました: ${error.message}`);
  process.exitCode = 1;
}
