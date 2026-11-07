import type { Evidence } from '../../../../src/domain/evidence';
import { NOT_REPORTED_TOKEN } from '../../../../src/domain/annotation';
import { seenEvidenceOf } from '../../../../src/features/verification/seenEvidence';

test('代表を先頭に表示順で重複を除き、AI 値を省略しない', () => {
  const first = { evidenceId: 'a', value: '全文', notReported: false } as Evidence;
  const second = { ...first, evidenceId: 'b' };
  expect(seenEvidenceOf({ evidence: first, quotes: [second, first] })).toEqual({
    seenEvidenceIds: ['a', 'b'], seenAiValue: '全文',
  });
  expect(seenEvidenceOf({ evidence: { ...first, notReported: true }, quotes: [] }).seenAiValue).toBe(NOT_REPORTED_TOKEN);
  expect(seenEvidenceOf({ evidence: { ...first, value: null }, quotes: [] }).seenAiValue).toBe('');
  expect(seenEvidenceOf({ evidence: null, quotes: [] })).toEqual({ seenEvidenceIds: [], seenAiValue: '' });
});
