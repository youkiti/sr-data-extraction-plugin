import type { GuideCondition } from '../../../lib/guide/tours';
import type { DualReviewCondition, DualReviewEvent } from '../../../lib/guide/tours/dualReview';
import type { AppState } from '../../store';

export const DUAL_REVIEW_ADAPTER = {
  conditions(_state: AppState): Record<DualReviewCondition, boolean> {
    return {};
  },
  risingEvents: {} satisfies Partial<Record<GuideCondition, DualReviewEvent>>,
};
