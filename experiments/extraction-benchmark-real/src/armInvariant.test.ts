import assert from 'node:assert/strict';
import test from 'node:test';
import { loadLocalConfig } from './localConfig';
import { armKeys, bestArmMapping, candidateMappings, remapRun, type ArmMapping } from './armInvariant';
import type { RunItem, ScorableRun } from './metrics';
import type { GoldFile, GoldRow } from './validateGold';

function goldRow(fieldId: string, entityKey: string, value: string): GoldRow {
  return {
    field_id: fieldId,
    entity_key: entityKey,
    not_reported: false,
    value_gold: value,
    acceptable_values: [],
    source_page: null,
    source_quote: null,
    note: null,
  };
}

function gold(rows: GoldRow[]): GoldFile {
  return { pdf_id: 'paper', pmcid: '', schema_version: 1, created_by: 'test', created_at: '2026-01-01', rows };
}

function item(fieldId: string, entityKey: string, value: string): RunItem {
  return { fieldId, entityKey, value, notReported: false, quote: null, anchor: null };
}

function run(items: RunItem[]): ScorableRun {
  return {
    runId: 'run',
    model: 'test-model',
    inputMode: 'text_only',
    pdfId: 'paper',
    repeat: 1,
    elapsedMs: 100,
    tokensIn: 10,
    tokensOut: 5,
    costUsd: 0.01,
    error: null,
    formatError: null,
    items,
  };
}

// 群名は非公開のローカル設定から取り出す。
const [firstArmName, secondArmName] = loadLocalConfig().testFixtures.armInvariant.armNames;
const twoArmGold = gold([
  goldRow('arm_name', 'arm:1', firstArmName),
  goldRow('arm_name', 'arm:2', secondArmName),
  goldRow('age_mean', 'arm:1', '50'),
  goldRow('age_mean', 'arm:2', '45'),
]);

test('armKeys: arm: で始まる entity_key だけを重複排除して取り出す', () => {
  assert.deepEqual(armKeys(['arm:2', 'arm:1', 'arm:1', '-', 'study']), ['arm:1', 'arm:2']);
  assert.deepEqual(armKeys([]), []);
});

test('2群が入れ替わっている合成 run は、入れ替えで満点になる', () => {
  // AI の群番号が gold と逆順になった入力を作る。
  const swappedRun = run([
    item('arm_name', 'arm:1', secondArmName!),
    item('arm_name', 'arm:2', firstArmName!),
    item('age_mean', 'arm:1', '45'),
    item('age_mean', 'arm:2', '50'),
  ]);
  const result = bestArmMapping(swappedRun, twoArmGold);
  assert.equal(result.asIs.overall.accuracy, 0); // as-is は全項目不一致
  assert.equal(result.best.overall.accuracy, 1); // 入れ替えで満点
  assert.equal(result.changed, true);
  // gold の arm:1 は AI の arm:2 に対応する（内容が一致する側）
  assert.equal(result.mapping['arm:1'], 'arm:2');
  assert.equal(result.mapping['arm:2'], 'arm:1');
});

test('恒等写像が最良のとき changed は false', () => {
  const alignedRun = run([
    item('arm_name', 'arm:1', firstArmName!),
    item('arm_name', 'arm:2', secondArmName!),
    item('age_mean', 'arm:1', '50'),
    item('age_mean', 'arm:2', '45'),
  ]);
  const result = bestArmMapping(alignedRun, twoArmGold);
  assert.equal(result.asIs.overall.accuracy, 1);
  assert.equal(result.best.overall.accuracy, 1);
  assert.equal(result.changed, false);
  assert.deepEqual(result.mapping, { 'arm:1': 'arm:1', 'arm:2': 'arm:2' });
});

test('AI の群が gold より 1 つ足りない場合、throw せず現状値以上を返す', () => {
  // AI は arm:1 だけを出し、その内容は gold の arm:2 に対応する。
  const oneArmRun = run([item('arm_name', 'arm:1', secondArmName!), item('age_mean', 'arm:1', '45')]);
  const result = bestArmMapping(oneArmRun, twoArmGold);
  assert.ok((result.best.overall.accuracy ?? 0) >= (result.asIs.overall.accuracy ?? 0));
  // as-is（gold arm:1 に対応付け）は不一致（gold arm:2 の 2 行は AI 項目なしで不正解のまま）
  assert.equal(result.asIs.overall.accuracy, 0);
  // 対応を arm:2 に変えると、AI が出した 2 項目分（全 4 行中）が一致する。
  // gold arm:1 の 2 行は依然 AI 項目なし（不正解）のままなので満点にはならない
  assert.equal(result.best.overall.accuracy, 0.5);
  assert.equal(result.changed, true);
});

test('AI の群が gold より 1 つ多い場合、throw せず現状値以上を返す', () => {
  const threeArmRun = run([
    item('arm_name', 'arm:1', firstArmName!),
    item('age_mean', 'arm:1', '50'),
    item('arm_name', 'arm:2', secondArmName!),
    item('age_mean', 'arm:2', '45'),
    item('arm_name', 'arm:3', 'Extra hallucinated arm'),
    item('age_mean', 'arm:3', '99'),
  ]);
  const result = bestArmMapping(threeArmRun, twoArmGold);
  assert.ok((result.best.overall.accuracy ?? 0) >= (result.asIs.overall.accuracy ?? 0));
  assert.equal(result.asIs.overall.accuracy, 1); // 既に整合しており、arm:3 は extra 扱いで accuracy に影響しない
  assert.equal(result.changed, false);
});

test('remapRun は元の run を変更しない', () => {
  const original = run([item('arm_name', 'arm:1', firstArmName!), item('arm_name', 'arm:2', secondArmName!)]);
  const originalItemsSnapshot = original.items.map((i) => ({ ...i }));
  const mapping: ArmMapping = { 'arm:1': 'arm:2', 'arm:2': 'arm:1' };
  const remapped = remapRun(original, mapping);

  assert.deepEqual(original.items, originalItemsSnapshot); // 元の run は不変
  assert.notEqual(remapped, original); // 別オブジェクト
  assert.notEqual(remapped.items, original.items);
  assert.equal(remapped.items[0]?.entityKey, 'arm:2');
  assert.equal(remapped.items[1]?.entityKey, 'arm:1');
});

test('同点のときは恒等写像を選ぶ', () => {
  // gold の 2 群の値がまったく同じ内容（entity_key を除けば区別が付かない）なら、
  // 入れ替えても正確度は変わらない（同点） → 恒等が選ばれるはず
  const symmetricGold = gold([goldRow('age_mean', 'arm:1', '50'), goldRow('age_mean', 'arm:2', '50')]);
  const symmetricRun = run([item('age_mean', 'arm:1', '50'), item('age_mean', 'arm:2', '50')]);
  const result = bestArmMapping(symmetricRun, symmetricGold);
  assert.equal(result.changed, false);
  assert.deepEqual(result.mapping, { 'arm:1': 'arm:1', 'arm:2': 'arm:2' });
});

test('candidateMappings: 恒等写像を必ず候補に含む', () => {
  const candidates = candidateMappings(['arm:1', 'arm:2'], ['arm:1', 'arm:2']);
  const hasIdentity = candidates.some((m) => m['arm:1'] === 'arm:1' && m['arm:2'] === 'arm:2');
  assert.ok(hasIdentity);
  assert.equal(candidates.length, 2); // 2 群なら順列は 2 通り（恒等と入れ替え）
});
