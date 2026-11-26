import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson } from '../../cochrane-numeric-benchmark/src/io';
import { condition, runLabel, outputRoot, yunRoot, selectedModels, selectedPmcids } from './config';
import { checkInputs, inputManifest, requestHashes, type Manifest } from './manifest';
import { buildStudyRequest } from './prompt';
import type { EvaluationSet, Study } from './dataset';

const study: Study = { pmcid: 2, studyKey: 'PMC2', icos: [{ id: 1, outcomeId: 'o1', outcome: 'outcome', intervention: 'drug', comparator: 'placebo', outcome_type: 'binary' }] };
const request = buildStudyRequest(study, [{ role: 'article', filename: 'PMC2.md', mode: 'text', pages: [{ page: 1, text: '本文' }] }]);
const manifest: Manifest = { hashes: { gold: 'gold', 'md/PMC2': 'md', 'request/model__PMC2': 'request' },
  promptVersion: 17, harnessCommit: null, excluded: [], emptyGold: null, condition: 'md', yunCommit: 'upstream',
  goldSha256: 'gold', models: ['model'], codexEffort: null };

test('条件・ラベル・出力と上流の絶対パス・PMCID 制限を検査', () => {
  assert.equal(condition({ BENCH_CONDITION: 'md' }), 'md'); assert.equal(condition({ BENCH_CONDITION: 'pdf' }), 'pdf');
  for (const value of [undefined, '', 'M', 'text']) assert.throws(() => condition({ BENCH_CONDITION: value }), /BENCH_CONDITION/);
  assert.equal(runLabel({ BENCH_RUN_LABEL: 'smoke-md_1' }), 'smoke-md_1');
  for (const value of [undefined, '', 'with space', '../escape']) assert.throws(() => runLabel({ BENCH_RUN_LABEL: value }), /BENCH_RUN_LABEL/);
  const absolute = path.resolve(os.tmpdir(), 'yun-output');
  assert.equal(outputRoot({ PUBLIC_BENCH_OUT: absolute }), absolute);
  assert.equal(yunRoot({ YUN_ROOT: absolute }), absolute);
  for (const value of [undefined, '', 'relative']) {
    assert.throws(() => outputRoot({ PUBLIC_BENCH_OUT: value }), /PUBLIC_BENCH_OUT/);
    assert.throws(() => yunRoot({ YUN_ROOT: value }), /YUN_ROOT/);
  }
  assert.throws(() => outputRoot({ PUBLIC_BENCH_OUT: fileURLToPath(new URL('..', import.meta.url)) }), /git ツリー/);
  assert.deepEqual(selectedPmcids([2, 10], '10,2'), [10, 2]);
  assert.throws(() => selectedPmcids([2, 10], '3'), /未知/);
  for (const raw of ['', '2,', '2.2', 'not-number']) assert.throws(() => selectedPmcids([2, 10], raw), /整数/);
});
test('既定モデルはキー経路の 2 モデル、codex は明示選択のみ', () => {
  const before = process.env.BENCH_MODELS;
  try {
    delete process.env.BENCH_MODELS;
    assert.deepEqual(selectedModels().map((m) => m.id), ['gemini-3.8-flash', 'claude-haiku-5-5']);
    process.env.BENCH_MODELS = 'gpt-6.2-sol'; assert.deepEqual(selectedModels().map((m) => m.id), ['gpt-6.2-sol']);
    process.env.BENCH_MODELS = 'unknown'; assert.throws(selectedModels, /BENCH_MODELS/);
  } finally { if (before === undefined) delete process.env.BENCH_MODELS; else process.env.BENCH_MODELS = before; }
});
test('依頼ハッシュは codex の推論設定も含め、依頼とメタデータの変更を拒否', () => {
  const model = { id: 'gpt-6.2-sol', route: 'codex' } as const;
  assert.notDeepEqual(requestHashes([{ model, runId: 'run', request }], 'medium'), requestHashes([{ model, runId: 'run', request }], 'high'));
  checkInputs(manifest, manifest);
  assert.throws(() => checkInputs(manifest, { ...manifest, hashes: { ...manifest.hashes, 'request/model__PMC2': 'changed' } }), /ハッシュ/);
  assert.throws(() => checkInputs(manifest, { ...manifest, hashes: { gold: 'gold' } }), /ハッシュ/);
  assert.throws(() => checkInputs(manifest, { ...manifest, condition: 'pdf' }), /マニフェスト/);
  assert.throws(() => checkInputs(manifest, { ...manifest, models: ['other'] }), /マニフェスト/);
  assert.throws(() => checkInputs(manifest, { ...manifest, excluded: [{ pmcid: 4, reason: 'no_pdf' }] }), /マニフェスト/);
});
test('dry run はディレクトリも作らず、初回のみマニフェスト保存、変更時は再開を拒否', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yun-manifest-'));
  try {
    const set: EvaluationSet = { studies: [study], documents: new Map(), hashes: { gold: 'gold', 'md/PMC2': 'md' }, excluded: [] };
    const plans = [{ model: { id: 'gemini-3.8-flash', keyEnv: 'GEMINI_API_KEY' } as const, runId: 'gemini-3.8-flash__PMC2', request }];
    const runs = path.join(dir, 'runs-test');
    await inputManifest(set, plans, 'md', runs, true, null);
    assert.deepEqual(await readdir(dir), []);
    await inputManifest(set, plans, 'md', runs, false, null);
    const saved = await readJson<Manifest>(path.join(runs, '_inputs.json'));
    assert.equal(saved.emptyGold, null); assert.equal(saved.condition, 'md'); assert.equal(saved.goldSha256, 'gold');
    await inputManifest(set, plans, 'md', runs, false, null);
    await assert.rejects(inputManifest(set, [{ ...plans[0]!, request: { ...request, chatOptions: { ...request.chatOptions, temperature: 0.9 } } }], 'md', runs, false, null), /ハッシュ/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
