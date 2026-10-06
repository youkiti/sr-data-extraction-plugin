import { tourDescKey, tourKeyBase, tourTitleKey } from './keys';
import type { TourFor } from './types';

export type DualReviewEvent = never;
export type DualReviewCondition = never;
const BASE = tourKeyBase('dual-review');

export const DUAL_REVIEW_TOUR: TourFor<DualReviewEvent, DualReviewCondition> = {
  id: 'dual-review',
  titleKey: tourTitleKey(BASE),
  descriptionKey: tourDescKey(BASE),
  draft: true,
  steps: [],
};
