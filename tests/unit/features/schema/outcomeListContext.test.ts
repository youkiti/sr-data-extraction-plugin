// アウトカムの一覧の文脈と、キーの所属・候補の判定のテスト。
import type { SchemaOutcome } from '../../../../src/domain/schemaOutcome';
import type { SchemaVersion } from '../../../../src/domain/schemaVersion';
import { buildOutcomeListContext, isEntityKeyInOutcomeList, isOutcomeListCandidateId, outcomeIdOfEntityKey, outcomeListCandidates } from '../../../../src/features/schema/outcomeListContext';
import type { Evidence } from '../../../../src/domain/evidence';
import type { SchemaField } from '../../../../src/domain/schemaField';

test('候補は study の outcome_result だけで、過去の一覧にも無い id を名前と全根拠でまとめる', () => {
  const context = buildOutcomeListContext([outcome(), outcome({ schemaVersion: 2, outcomeId: 'pain' })], versions, 2)!;
  const evidence = [
    { studyId: 's', entityKey: 'outcome:new_id', fieldId: 'value', value: '1' },
    { studyId: 's', entityKey: 'outcome:new_id|arm:1', fieldId: 'name', value: null },
    { studyId: 's', entityKey: 'outcome:new_id|arm:2', fieldId: 'name', value: '最初の名前' },
    { studyId: 's', entityKey: 'outcome:new_id', fieldId: 'name', value: '別の名前' },
    { studyId: 's', entityKey: 'outcome:unnamed', fieldId: 'value', value: null },
    { studyId: 'other', entityKey: 'outcome:other' },
    { studyId: 's', entityKey: 'rob:d|outcome:new_id' },
    { studyId: 's', entityKey: 'outcome:mortality' },
    { studyId: 's', entityKey: 'outcome:pain' },
  ] as Evidence[];
  expect(outcomeListCandidates('s', evidence, [{ fieldId: 'name', fieldName: 'outcome_name' }] as SchemaField[], context)).toEqual([
    { id: 'new_id', name: '最初の名前', evidence: evidence.slice(0, 4) },
    { id: 'unnamed', name: null, evidence: [evidence[4]] },
  ]);
});

const outcome = (patch: Partial<SchemaOutcome> = {}): SchemaOutcome => ({
  schemaVersion: 1, outcomeIndex: 1, outcomeId: 'mortality', outcomeLabel: '全死亡',
  description: null, typicalTimepoints: null, addedVia: 'schema_editor', note: null, ...patch,
});
const versions = [4, 3, 2, 1].map((schemaVersion) => ({ schemaVersion } as SchemaVersion));

test('論文単位モードは null、一覧モードは指定版と直近の前版を解決する', () => {
  expect(buildOutcomeListContext([], versions, 4)).toBeNull();
  const old = outcome({ outcomeId: 'removed' });
  const second = outcome({ schemaVersion: 2, outcomeIndex: 2 });
  const first = outcome({ schemaVersion: 2, outcomeId: 'pain' });
  const all = [old, second, first];
  const expected = {
    schemaVersion: 2, outcomes: [first, second],
    currentIds: new Set(['pain', 'mortality']), everIds: new Set(['removed', 'mortality', 'pain']),
  };
  expect(buildOutcomeListContext(all, versions, 2)).toEqual(expected);
  expect(buildOutcomeListContext(all, versions, 4)).toEqual(expected);
  expect(all).toEqual([old, second, first]);
  expect(buildOutcomeListContext(all, versions, 0)).toBeNull();
});

test.each([
  ['outcome:mortality', 'mortality'],
  ['outcome:pain|arm:1|time:30d', 'pain'],
  ['rob:domain_1|outcome:pain|arm:1|time:90d', 'pain'],
  ['rob:domain_1|outcome:pain', 'pain'],
  ['rob:domain_1', null], ['-', null], ['arm:1', null], ['invalid', null],
])('キー %s の参照先を返す', (key, expected) => {
  expect(outcomeIdOfEntityKey(key!)).toBe(expected);
});

test('現行の id だけを所属とし、過去に外した id は候補にしない', () => {
  const context = buildOutcomeListContext([outcome(), outcome({ schemaVersion: 2, outcomeId: 'pain' })], versions, 2)!;
  for (const key of ['-', 'arm:1', 'rob:domain_1', 'invalid', 'outcome:pain|time:30d', 'rob:domain_1|outcome:pain']) {
    expect(isEntityKeyInOutcomeList(key, context)).toBe(true);
  }
  for (const key of ['outcome:mortality', 'outcome:new_id', 'rob:domain_1|outcome:mortality']) {
    expect(isEntityKeyInOutcomeList(key, context)).toBe(false);
    expect(isEntityKeyInOutcomeList(key, null)).toBe(true);
  }
  expect(isOutcomeListCandidateId('pain', context)).toBe(false);
  expect(isOutcomeListCandidateId('mortality', context)).toBe(false);
  expect(isOutcomeListCandidateId('new_id', context)).toBe(true);
});
