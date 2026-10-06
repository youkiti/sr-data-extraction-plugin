import { tourDescKey, tourKeyBase, tourTitleKey } from './keys';
import type { TourFor } from './types';

export type VerifyBasicsEvent = never;
export type VerifyBasicsCondition = never;
const BASE = tourKeyBase('verify-basics');

export const VERIFY_BASICS_TOUR: TourFor<VerifyBasicsEvent, VerifyBasicsCondition> = {
  id: 'verify-basics',
  titleKey: tourTitleKey(BASE),
  descriptionKey: tourDescKey(BASE),
  draft: true,
  steps: [],
};
