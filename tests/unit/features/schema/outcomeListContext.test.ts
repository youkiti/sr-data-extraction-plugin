// アウトカムの一覧の文脈と、キーの所属・候補の判定のテスト。
import type { SchemaOutcome } from '../../../../src/domain/schemaOutcome';
import type { SchemaVersion } from '../../../../src/domain/schemaVersion';
import { buildOutcomeListContext, isEntityKeyInOutcomeList, isOutcomeListCandidateId, outcomeIdOfEntityKey } from '../../../../src/features/schema/outcomeListContext';

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
  expect(() => buildOutcomeListContext(all, versions, 0)).toThrow('版 0 以前にアウトカムの一覧がありません');
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
