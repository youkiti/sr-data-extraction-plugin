import test from 'node:test';
import assert from 'node:assert/strict';
import { compareBudget, main, readMeasurements } from './checkBudget.mjs';

const entries = ['background/service-worker', 'app/app', 'popup/popup', 'options/options'];
function statsFixture() {
  return {
    errorsCount: 0,
    entrypoints: Object.fromEntries(entries.map((entry) => [entry, {
      assets: [{ name: `${entry}.js`, size: 100 }],
    }])),
    assets: [{ name: 'chunks/pdfjs.js', size: 200 }, { name: 'pdf.worker.min.mjs', size: 300 }],
  };
}
function budgetFixture() {
  return {
    version: 1,
    entries: Object.fromEntries(Object.entries(readMeasurements(statsFixture()))
      .map(([entry, bytes]) => [entry, { measuredBytes: bytes, maxBytes: bytes }])),
  };
}

test('全エントリの共有初期 JS を合計し、重複、map、CSS、無関係な遅延資産を除く', () => {
  const stats = statsFixture();
  stats.entrypoints['app/app'].assets.push(
    { name: 'shared.js', size: 50 },
    { name: 'shared.js', size: 50 },
    { name: 'module.mjs', size: 20 },
    { name: 'app.js.map', size: 900 },
    { name: 'app.css', size: 900 },
  );
  stats.assets.push({ name: 'chunks/other.js', size: 9999 });
  assert.deepEqual(readMeasurements(stats), {
    'background/service-worker': 100,
    'app/app': 170,
    'popup/popup': 100,
    'options/options': 100,
    'chunks/pdfjs.js': 200,
    'pdf.worker.min.mjs': 300,
  });
});

test('統計のビルドエラー、欠落、不正サイズを拒否する', () => {
  const mutations = [
    (s) => { s.errorsCount = 1; },
    (s) => { delete s.errorsCount; },
    (s) => { delete s.entrypoints; },
    (s) => { delete s.entrypoints['app/app']; },
    (s) => { s.entrypoints['app/app'].assets = []; },
    (s) => { delete s.assets; },
    (s) => { s.assets.pop(); },
    (s) => { s.assets.push(s.assets[0]); },
  ];
  for (const mutate of mutations) {
    const stats = statsFixture();
    mutate(stats);
    assert.throws(() => readMeasurements(stats));
  }
  for (const size of [undefined, 0, -1, 1.5, '100', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const stats = statsFixture();
    stats.entrypoints['app/app'].assets[0].size = size;
    assert.throws(() => readMeasurements(stats), /バイト数/);
    const pdf = statsFixture();
    pdf.assets[0].size = size;
    assert.throws(() => readMeasurements(pdf), /バイト数/);
  }
});

test('上限以下と同値は成功し、1 byte 超過は失敗する', () => {
  const budget = { version: 1, entries: { app: { maxBytes: 100 } } };
  for (const [bytes, failed] of [[99, false], [100, false], [101, true]]) {
    assert.deepEqual(compareBudget({ app: bytes }, budget), [{ entry: 'app', bytes, maxBytes: 100, failed }]);
  }
});

test('予算の版、対象の欠落、不正な上限を拒否する', () => {
  assert.throws(() => compareBudget({ app: 100 }, { version: 2 }), /バージョン/);
  assert.throws(() => compareBudget({ app: 100 }, { version: 1 }), /バイト数/);
  for (const maxBytes of [undefined, 0, -1, 1.5, '100', NaN, Infinity]) {
    assert.throws(() => compareBudget({ app: 100 }, { version: 1, entries: { app: { maxBytes } } }), /バイト数/);
  }
});

test('CLI の成功と失敗の終了コード、実測値、上限、更新理由の案内', () => {
  for (const failed of [false, true]) {
    const budget = budgetFixture();
    if (failed) budget.entries['chunks/pdfjs.js'].maxBytes = 199;
    const logs = [];
    const code = main(['stats.json'], {
      read: (name, encoding) => {
        assert.equal(encoding, 'utf8');
        if (name === 'stats.json') return JSON.stringify(statsFixture());
        assert.equal(name.href, new URL('./budget.json', import.meta.url).href);
        return JSON.stringify(budget);
      },
      log: (line) => logs.push(line),
    });
    assert.equal(code, failed ? 1 : 0);
    assert.equal(logs.length, failed ? 7 : 6);
    assert.ok(logs.includes(`${failed ? 'FAIL' : 'PASS'}: chunks/pdfjs.js 200 bytes / 上限 ${failed ? 199 : 200} bytes`));
    assert.equal(logs.some((line) => line.includes('PR 本文')), failed);
  }
});

test('引数の欠落、余分な引数、未対応のオプションを拒否する', () => {
  for (const args of [[], ['stats.json', 'extra'], ['--unknown']]) {
    assert.throws(() => main(args), /使用方法/);
  }
});
