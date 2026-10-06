import { PILOT_AND_EXTRACT_TOUR, type PilotAndExtractEvent, type PilotAndExtractCondition } from './pilotAndExtract';
import { VERIFY_BASICS_TOUR, type VerifyBasicsEvent, type VerifyBasicsCondition } from './verifyBasics';
import { DUAL_REVIEW_TOUR, type DualReviewEvent, type DualReviewCondition } from './dualReview';
import { EXPORT_DATA_TOUR, type ExportDataEvent, type ExportDataCondition } from './exportData';
import { GETTING_STARTED_TOUR, type GettingStartedEvent, type GettingStartedCondition } from './gettingStarted';
import type {
  CommonGuideCondition,
  CommonGuideEventName,
  GuideTourId,
  TourAdvance,
  TourDefinitionOf,
  TourStepOf,
} from './types';

export type { CommonGuideCondition, CommonGuideEventName, GuideTourId } from './types';
export { stepKey, tourDescKey, tourKeyBase, tourTitleKey } from './keys';

export type GuideEventName = CommonGuideEventName | GettingStartedEvent
  | PilotAndExtractEvent
  | VerifyBasicsEvent
  | DualReviewEvent
  | ExportDataEvent;
export type GuideCondition = CommonGuideCondition | GettingStartedCondition
  | PilotAndExtractCondition
  | VerifyBasicsCondition
  | DualReviewCondition
  | ExportDataCondition;
export type TourStep = TourStepOf<GuideEventName, GuideCondition>;
export type TourDefinition = TourDefinitionOf<GuideEventName, GuideCondition>;
export type GuideTourAdvance = TourAdvance<GuideEventName>;

export const GUIDE_TOURS: Record<GuideTourId, TourDefinition> = {
  'getting-started': GETTING_STARTED_TOUR,
  'pilot-and-extract': PILOT_AND_EXTRACT_TOUR,
  'verify-basics': VERIFY_BASICS_TOUR,
  'dual-review': DUAL_REVIEW_TOUR,
  'export-data': EXPORT_DATA_TOUR,
};

export const GUIDE_TOUR_IDS = Object.keys(GUIDE_TOURS) as GuideTourId[];

export function isGuideTourId(value: unknown): value is GuideTourId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(GUIDE_TOURS, value);
}
