import { tourDescKey, tourKeyBase, tourTitleKey } from './keys';
import type { TourFor } from './types';

export type PilotAndExtractEvent = never;
export type PilotAndExtractCondition = never;
const BASE = tourKeyBase('pilot-and-extract');

export const PILOT_AND_EXTRACT_TOUR: TourFor<PilotAndExtractEvent, PilotAndExtractCondition> = {
  id: 'pilot-and-extract',
  titleKey: tourTitleKey(BASE),
  descriptionKey: tourDescKey(BASE),
  draft: true,
  steps: [],
};
