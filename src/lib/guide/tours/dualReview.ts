import { stepKey, tourDescKey, tourKeyBase, tourTitleKey } from './keys';
import type { TourFor } from './types';

export type DualReviewEvent = never;
export type DualReviewCondition = 'dual-review-unavailable';
const BASE = tourKeyBase('dual-review');

export const DUAL_REVIEW_TOUR: TourFor<DualReviewEvent, DualReviewCondition> = {
  id: 'dual-review',
  titleKey: tourTitleKey(BASE),
  descriptionKey: tourDescKey(BASE),
  unavailableIf: 'dual-review-unavailable',
  steps: [
    { id: 'open-home', target: 'nav-home', textKey: stepKey(BASE, 'open-home'),
      advance: { type: 'events', events: ['route-opened-home'] } },
    { id: 'add-reviewer', route: '#/home', target: 'dual-review-add-reviewer',
      dynamicTarget: true, textKey: stepKey(BASE, 'add-reviewer'), advance: { type: 'next' } },
    { id: 'review-mode', route: '#/home', target: 'dual-review-mode',
      dynamicTarget: true, textKey: stepKey(BASE, 'review-mode'), advance: { type: 'next' } },
    { id: 'review-sets', route: '#/home', target: 'dual-review-split',
      dynamicTarget: true, blockTarget: true, textKey: stepKey(BASE, 'review-sets'), advance: { type: 'next' } },
    { id: 'open-adjudicate', target: 'nav-adjudicate', textKey: stepKey(BASE, 'open-adjudicate'),
      advance: { type: 'events', events: ['route-opened-adjudicate'] } },
    { id: 'agreement', route: '#/adjudicate', target: 'dual-review-agreement',
      dynamicTarget: true, textKey: stepKey(BASE, 'agreement'), advance: { type: 'next' } },
    { id: 'resolve', route: '#/adjudicate', target: 'dual-review-mismatch',
      dynamicTarget: true, textKey: stepKey(BASE, 'resolve'), advance: { type: 'next' } },
    { id: 'finish', target: 'tour-list', textKey: stepKey(BASE, 'finish'),
      advance: { type: 'next' } },
  ],
};
