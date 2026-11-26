import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { mulberry32 } from '../../cochrane-numeric-benchmark/src/bootstrap';
import { readJson, writeJson } from '../../cochrane-numeric-benchmark/src/io';
import { makeDraws, pmcidsFrom, REPLICATES, SEED, sortedPmcids, writeDraws } from './draws';

test('同じ seed から 2000 回の RCT 復元抽出を再現する', () => {
  const result = makeDraws([10, 2, 30]);
  assert.deepEqual(result, makeDraws([30, 10, 2]));
  assert.deepEqual(result.pmcids, [2, 10, 30]);
  assert.equal(result.replicates, REPLICATES); assert.equal(result.seed, SEED);
  const random = mulberry32(20261127);
  assert.deepEqual(result.draws[0], Array.from({ length: 3 }, () => Math.floor(random() * 3)));
  assert.deepEqual(result.draws[1], Array.from({ length: 3 }, () => Math.floor(random() * 3)));
  assert.equal(result.draws.length, 2000);
  assert.ok(result.draws.every((draw) => draw.length === 3 && draw.every((index) => index >= 0 && index < 3)));
  assert.ok(makeDraws([2]).draws.every((draw) => draw[0] === 0));
  for (const bad of [[], [2, 2], ['2'], [0], [1.5]]) assert.throws(() => sortedPmcids(bad), /正整数/);
});
test('JSON 配列と入力マニフェストの計画を読み、名前ごとに保存する', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yun-draws-'));
  try {
    const source = path.join(dir, 'ids.json');
    await writeJson(source, [10, 2]);
    assert.deepEqual(await pmcidsFrom(source), [2, 10]);
    const runs = path.join(dir, 'runs-label');
    await writeJson(path.join(runs, '_inputs.json'), { models: ['a', 'b'], hashes: {
      gold: 'hash', 'request/a__PMC2': 'a', 'request/a__PMC10': 'a', 'request/b__PMC2': 'b', 'request/b__PMC10': 'b',
    } });
    assert.deepEqual(await pmcidsFrom(runs), [2, 10]);
    await writeDraws(dir, 'M', [2, 10]); await writeDraws(dir, 'P', [2]); await writeDraws(dir, 'M-common', [2]);
    assert.deepEqual((await readdir(dir)).filter((name) => name.startsWith('draws-')).sort(), ['draws-M-common.json', 'draws-M.json', 'draws-P.json']);
    assert.deepEqual(await readJson(path.join(dir, 'draws-M.json')), makeDraws([2, 10]));
    await assert.rejects(writeDraws(dir, '../escape', [2]), /name/);
    await writeJson(path.join(runs, '_inputs.json'), { models: ['a', 'b'], hashes: { 'request/a__PMC2': 'a', 'request/b__PMC10': 'b' } });
    await assert.rejects(pmcidsFrom(runs), /異なります/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
