import { deriveReviewMode } from '../../../../../src/features/export/rset/reviewMode';

function rows(...types: Array<'ai' | 'human_with_ai' | 'human_independent' | 'consensus'>) {
  return types.map((annotatorType) => ({ annotatorType }));
}

describe('deriveReviewMode', () => {
  test('StudyData / ResultsData のいずれにも行が無ければ no_human_verification', () => {
    expect(deriveReviewMode([], [])).toBe('no_human_verification');
  });

  test('ai 行のみ（人間の検証行が無い）は no_human_verification', () => {
    expect(deriveReviewMode(rows('ai'), rows('ai'))).toBe('no_human_verification');
  });

  test('human_with_ai 行があれば single_with_ai', () => {
    expect(deriveReviewMode(rows('ai', 'human_with_ai'), [])).toBe('single_with_ai');
  });

  test('human_independent 行があれば dual_independent（human_with_ai より優先）', () => {
    expect(deriveReviewMode(rows('human_with_ai'), rows('human_independent'))).toBe(
      'dual_independent',
    );
  });

  test('consensus 行が 1 件でもあれば dual_consensus（最優先）', () => {
    expect(
      deriveReviewMode(rows('human_independent', 'consensus'), rows('human_independent')),
    ).toBe('dual_consensus');
  });

  test('StudyData と ResultsData を両方見て判定する', () => {
    expect(deriveReviewMode(rows('ai'), rows('consensus'))).toBe('dual_consensus');
    expect(deriveReviewMode(rows('human_with_ai'), rows('ai'))).toBe('single_with_ai');
  });
});
