import type { GuideCondition } from '../../../lib/guide/tours';
import type { DualReviewCondition, DualReviewEvent } from '../../../lib/guide/tours/dualReview';
import type { AppState } from '../../store';

export const DUAL_REVIEW_ADAPTER = {
  conditions(state: AppState): Record<DualReviewCondition, boolean> {
    const owner = state.role.role === 'owner' && !state.role.resolving && state.role.error === null;
    return { 'dual-review-unavailable': !owner || state.currentProject === null || state.counts.documents < 1 };
  },
  risingEvents: {} satisfies Partial<Record<GuideCondition, DualReviewEvent>>,
};
