import { stepKey, tourDescKey, tourKeyBase, tourTitleKey } from './keys';
import type { TourFor } from './types';

export type VerifyBasicsEvent = never;
export type VerifyBasicsCondition = 'verify-basics-unavailable';
const BASE = tourKeyBase('verify-basics');

export const VERIFY_BASICS_TOUR: TourFor<VerifyBasicsEvent, VerifyBasicsCondition> = {
  id: 'verify-basics',
  videoId: 'DN5YrhJilOc',
  titleKey: tourTitleKey(BASE),
  descriptionKey: tourDescKey(BASE),
  unavailableIf: 'verify-basics-unavailable',
  steps: [
    { id: 'open-verify', target: 'nav-verify', textKey: stepKey(BASE, 'open-verify'),
      advance: { type: 'events', events: ['route-opened-verify'] } },
    { id: 'pick-study', route: '#/verify', target: 'verify-basics-study', dynamicTarget: true,
      textKey: stepKey(BASE, 'pick-study'), advance: { type: 'next' } },
    { id: 'read-evidence', route: '#/verify', target: 'verify-basics-pdf', dynamicTarget: true,
      textKey: stepKey(BASE, 'read-evidence'), advance: { type: 'next' } },
    { id: 'decide', route: '#/verify', target: 'verify-basics-decide', dynamicTarget: true,
      textKey: stepKey(BASE, 'decide'), advance: { type: 'next' } },
    { id: 'edit-evidence', route: '#/verify', target: 'verify-basics-quote-remove', dynamicTarget: true, blockTarget: true,
      textKey: stepKey(BASE, 'edit-evidence'), advance: { type: 'next' } },
    { id: 'check-progress', route: '#/verify', target: 'verify-basics-progress', dynamicTarget: true,
      textKey: stepKey(BASE, 'check-progress'), advance: { type: 'next' } },
    { id: 'finish', target: 'tour-list', textKey: stepKey(BASE, 'finish'), advance: { type: 'next' } },
  ],
};
