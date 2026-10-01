// 使用例: node tools/bundle/sizeReport.mjs /tmp/stats-before.json
// stats は webpack --mode production --profile --json=/tmp/stats-before.json で生成する。
// 資産は出力後の実サイズ、寄与は圧縮前の webpack モジュールサイズ（両者は一致しない）。
import { readFileSync } from 'node:fs';

const stats = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

// 連結モジュールは子だけを数え、親との二重計上を避ける。
function leaves(modules = []) {
  return modules.flatMap((module) => module.modules ? leaves(module.modules) : [module]);
}

function groupOf(module) {
  const name = (module.nameForCondition || module.name || '').replaceAll('\\', '/');
  const relative = name.split('/node_modules/').at(-1);
  if (relative !== name) {
    const parts = relative.split('/');
    return `node_modules/${parts.slice(0, parts[0].startsWith('@') ? 2 : 1).join('/')}`;
  }
  return name.includes('/src/') ? 'src/' : 'その他（runtime 等）';
}

function printSection(title, chunks) {
  console.log(`\n${title}`);
  const groups = new Map();
  const modules = new Map();
  for (const module of leaves(chunks.flatMap((chunk) => chunk.modules || []))) {
    // 複数チャンクに共有されるモジュールは資産内で一度だけ数える。
    modules.set(module.identifier || module.name, module);
  }
  for (const module of modules.values()) {
    const group = groupOf(module);
    groups.set(group, (groups.get(group) || 0) + module.size);
  }
  console.log(`  モジュール合計: ${kb([...groups.values()].reduce((a, b) => a + b, 0))}`);
  console.log(`  src/ 合計: ${kb(groups.get('src/') || 0)}`);
  for (const [name, size] of [...groups].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`  ${kb(size).padStart(12)}  ${name}`);
  }
  console.log('  src/ 内の上位 5 モジュール:');
  for (const module of [...modules.values()].filter((m) => groupOf(m) === 'src/')
    .sort((a, b) => b.size - a.size).slice(0, 5)) {
    console.log(`  ${kb(module.size).padStart(12)}  ${module.name}`);
  }
}

function report(compilation) {
  if (compilation.children?.length) {
    for (const child of compilation.children) report(child);
    return;
  }
  const chunks = compilation.chunks || [];
  console.log('KB = 1024 bytes。資産 = 圧縮後、寄与 = 圧縮前（推定比率への換算はしない）。');
  for (const entry of ['app/app', 'popup/popup', 'options/options']) {
    for (const asset of compilation.entrypoints?.[entry]?.assets || []) {
      printSection(`エントリ ${entry}: ${asset.name} (${kb(asset.size)})`,
        chunks.filter((chunk) => chunk.files.includes(asset.name)));
    }
  }
  for (const chunk of chunks) {
    const assets = chunk.files.map((name) => {
      const asset = compilation.assets.find((item) => item.name === name);
      return `${name} (${kb(asset.size)})`;
    });
    printSection(`チャンク ${chunk.id}: ${assets.join(', ')} (${chunk.initial ? '初期' : '遅延'})`, [chunk]);
  }
}

report(stats);
