// webpack の本番統計から初期 JS と PDF 関連資産の上限を検査する。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENTRIES = ['background/service-worker', 'app/app', 'popup/popup', 'options/options'];
const ASSETS = ['chunks/pdfjs.js', 'pdf.worker.min.mjs'];

function validBytes(bytes, label) {
  if (!Number.isSafeInteger(bytes) || bytes <= 0) {
    throw new Error(`バイト数が不正です: ${label}`);
  }
  return bytes;
}

export function readMeasurements(stats) {
  if (stats.errorsCount !== 0) throw new Error('成功した本番ビルドの統計が必要です');
  const measurements = {};
  for (const entry of ENTRIES) {
    const assets = stats.entrypoints?.[entry]?.assets;
    if (!Array.isArray(assets)) throw new Error(`エントリがありません: ${entry}`);
    // 分割された共有チャンクも初期 JS に含め、同じ資産の重複と source map は除く。
    const js = new Map(assets.filter((asset) => /\.(?:m?js)$/.test(asset.name))
      .map((asset) => [asset.name, asset]));
    const bytes = [...js.values()].reduce((sum, asset) => sum + validBytes(asset.size, asset.name), 0);
    measurements[entry] = validBytes(bytes, entry);
  }
  for (const name of ASSETS) {
    const assets = stats.assets?.filter((asset) => asset.name === name);
    if (assets?.length !== 1) throw new Error(`資産がないか重複しています: ${name}`);
    measurements[name] = validBytes(assets[0].size, name);
  }
  return measurements;
}

export function compareBudget(measurements, budget) {
  if (budget.version !== 1) throw new Error('バンドル予算のバージョンが不正です');
  return Object.entries(measurements).map(([entry, bytes]) => {
    const maxBytes = validBytes(budget.entries?.[entry]?.maxBytes, entry);
    return { entry, bytes, maxBytes, failed: bytes > maxBytes };
  });
}

export function main(args, { read = readFileSync, log = console.log } = {}) {
  if (args.length !== 1 || args[0].startsWith('--')) {
    throw new Error('使用方法: npm run bundle:check -- <本番 webpack stats JSON>');
  }
  const measurements = readMeasurements(JSON.parse(read(args[0], 'utf8')));
  const budget = JSON.parse(read(new URL('./budget.json', import.meta.url), 'utf8'));
  const results = compareBudget(measurements, budget);
  for (const { entry, bytes, maxBytes, failed } of results) {
    log(`${failed ? 'FAIL' : 'PASS'}: ${entry} ${bytes} bytes / 上限 ${maxBytes} bytes`);
  }
  if (results.some((result) => result.failed)) {
    log('上限を引き上げる場合は budget.json を更新し、PR 本文に増加の理由を記載してください。');
    return 1;
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`バンドル予算検査エラー: ${error.message}`);
    process.exitCode = 1;
  }
}
