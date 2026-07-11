import { annotatorTypeForRole } from '../../../src/domain/reviewer';

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
