import { annotatorTypeForRole, annotatorTypeForAssignment } from '../../../src/domain/reviewer';

describe('annotatorTypeForRole', () => {
  test('reviewer_independent は human_independent', () => {
    expect(annotatorTypeForRole('reviewer_independent')).toBe('human_independent');
  });

  test.each(['owner', 'reviewer_with_ai', 'adjudicator', 'unregistered'] as const)(
    '%s は human_with_ai',
    (role) => {
      expect(annotatorTypeForRole(role)).toBe('human_with_ai');
    },
  );
});


describe('annotatorTypeForAssignment', () => {
  test.each([
    ['reviewer', 'independent', 'human_independent'],
    ['reviewer', 'with_ai', 'human_with_ai'],
    ['adjudicator', 'independent', 'human_with_ai'],
    ['adjudicator', 'with_ai', 'human_with_ai'],
  ] as const)('%s / %s は %s', (role, mode, expected) => {
    expect(annotatorTypeForAssignment(role, mode)).toBe(expected);
  });
});
