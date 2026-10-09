import { stepKey, tourDescKey, tourKeyBase, tourTitleKey } from './keys';
import type { TourFor } from './types';

export type PilotAndExtractEvent = 'pilot-and-extract-pilot-ready' | 'pilot-and-extract-full-ready';
export type PilotAndExtractCondition =
  | 'pilot-and-extract-unavailable'
  | 'pilot-and-extract-has-pilot'
  | 'pilot-and-extract-has-full';
const BASE = tourKeyBase('pilot-and-extract');

export const PILOT_AND_EXTRACT_TOUR: TourFor<PilotAndExtractEvent, PilotAndExtractCondition> = {
  id: 'pilot-and-extract',
  videoId: 'oaIezIWGZI4',
  titleKey: tourTitleKey(BASE),
  descriptionKey: tourDescKey(BASE),
  unavailableIf: 'pilot-and-extract-unavailable',
  steps: [
    { id: 'open-pilot', target: 'nav-pilot', textKey: stepKey(BASE, 'open-pilot'),
      advance: { type: 'events', events: ['route-opened-pilot'] } },
    { id: 'select-studies', route: '#/pilot', target: 'pilot-extract-study', dynamicTarget: true,
      textKey: stepKey(BASE, 'select-studies'), advance: { type: 'next' } },
    { id: 'run-pilot', route: '#/pilot', target: 'pilot-extract-run-pilot', dynamicTarget: true,
      textKey: stepKey(BASE, 'run-pilot'),
      advance: { type: 'events', events: ['pilot-and-extract-pilot-ready'], optional: true } },
    { id: 'review-pilot', route: '#/pilot', target: 'pilot-extract-review', dynamicTarget: true,
      textKey: stepKey(BASE, 'review-pilot'), advance: { type: 'next' } },
    { id: 'open-extract', target: 'nav-extract', textKey: stepKey(BASE, 'open-extract'),
      advance: { type: 'events', events: ['route-opened-extract'] } },
    { id: 'check-estimate', route: '#/extract', target: 'pilot-extract-estimate', dynamicTarget: true,
      textKey: stepKey(BASE, 'check-estimate'), advance: { type: 'next' } },
    { id: 'run-extract', route: '#/extract', target: 'pilot-extract-run-full', dynamicTarget: true,
      textKey: stepKey(BASE, 'run-extract'),
      advance: { type: 'events', events: ['pilot-and-extract-full-ready'], optional: true } },
    { id: 'finish', target: 'tour-list', textKey: stepKey(BASE, 'finish'),
      advance: { type: 'next' } },
  ],
};
