// 再探索対象・項目順・出力先の隔離を、API なしで検査する。
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assertReaskFrom, checkReaskFrom, loadReaskTargets, reaskFields, reaskFromName, targetCells } from './reask';
import type { RunItem } from './metrics';

const item: RunItem = { fieldId: 'a', entityKey: 'arm:1', notReported: true, value: null, quote: null, anchor: null };
const initial = { error: null, formatError: null, items: [item] };

test('未報告だけを重複排除し、異なる群は別セルとする', () => {
  assert.deepEqual(targetCells({ ...initial, items: [item, item, { ...item, entityKey: 'arm:2' }, { ...item, fieldId: 'b', notReported: false }] }),
    [{ fieldId: 'a', entityKey: 'arm:1' }, { fieldId: 'a', entityKey: 'arm:2' }]);
  assert.deepEqual(targetCells({ ...initial, items: [] }), []);
});

test('項目は対象セルを持つものだけをスキーマ順で返す', () => {
  const fields = [{ fieldId: 'b' }, { fieldId: 'unused' }, { fieldId: 'a' }];
  assert.deepEqual(reaskFields([{ fieldId: 'a', entityKey: '-' }, { fieldId: 'b', entityKey: '-' }], fields), [fields[0], fields[2]]);
  assert.deepEqual(reaskFields([], fields), []);
});

for (const [label, current, previous] of [
  ['通常 run 混在', 'first', undefined], ['別の初回混在', 'first', 'other'], ['通常モードに再探索混在', undefined, 'first'],
] as const) {
  test(label, () => assert.throws(() => assertReaskFrom(current, [{ name: 'run.json', reaskFrom: previous }]), /再探索元/));
}

test('同一再探索元と通常同士を許し、補助ファイルを無視する', () => {
  assertReaskFrom('first', [{ name: 'run.json', reaskFrom: 'first' }, { name: '_failed.json' }, { name: 'run.json.bak' }]);
  assertReaskFrom(undefined, [{ name: 'run.json' }]);
});

test('再探索元の環境変数は localName と同じ規則で検査する', () => {
  const saved = process.env.BENCH_REASK_FROM;
  try {
    delete process.env.BENCH_REASK_FROM;
    assert.equal(reaskFromName(), undefined);
    for (const value of ['', '..', 'a..b', 'a/b', 'a\\b']) {
      process.env.BENCH_REASK_FROM = value;
      assert.throws(reaskFromName, /不正/);
    }
    process.env.BENCH_REASK_FROM = 'runs-first';
    assert.equal(reaskFromName(), 'runs-first');
  } finally {
    if (saved === undefined) delete process.env.BENCH_REASK_FROM;
    else process.env.BENCH_REASK_FROM = saved;
  }
});

test('ディレクトリ検査は補助・壊れた JSON を無視し、混在を止める', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'reask-check-'));
  try {
    await checkReaskFrom(path.join(dir, 'missing'), 'first');
    await writeFile(path.join(dir, '_skip.json'), '{}');
    await writeFile(path.join(dir, 'skip.txt'), '{}');
    await writeFile(path.join(dir, 'broken.json'), '{');
    await writeFile(path.join(dir, 'ok.json'), JSON.stringify({ reaskFrom: 'first' }));
    await checkReaskFrom(dir, 'first');
    await assert.rejects(checkReaskFrom(dir, undefined), /ok.json/);
    await writeFile(path.join(dir, 'normal.json'), '{}');
    await assert.rejects(checkReaskFrom(dir, 'first'), /normal.json/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('初回の欠落・JSON 不正・両種の失敗を全件列挙し、成功時は対象を返す', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'reask-initial-'));
  try {
    await writeFile(path.join(dir, 'broken.json'), '{');
    await writeFile(path.join(dir, 'error.json'), JSON.stringify({ ...initial, error: 'error' }));
    await writeFile(path.join(dir, 'format.json'), JSON.stringify({ ...initial, formatError: 'format' }));
    const planned = ['missing', 'broken', 'error', 'format'].map((runId) => ({ runId, target: { pdfId: runId } }));
    await assert.rejects(loadReaskTargets(dir, planned), (error: Error) => planned.every((p) => error.message.includes(p.target.pdfId)));
    await writeFile(path.join(dir, 'ok.json'), JSON.stringify(initial));
    assert.deepEqual((await loadReaskTargets(dir, [{ runId: 'ok', target: { pdfId: 'paper' } }])).get('ok'), [{ fieldId: 'a', entityKey: 'arm:1' }]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
