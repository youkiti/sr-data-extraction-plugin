import { stepKey, tourDescKey, tourKeyBase, tourTitleKey } from './keys';
import type { TourFor } from './types';

export type GettingStartedEvent = 'documents-imported' | 'protocol-saved' | 'schema-confirmed';
export type GettingStartedCondition = 'not-owner';
const BASE = tourKeyBase('getting-started');

/** 文献の取り込みからスキーマ確定までの案内。 */
export const GETTING_STARTED_TOUR: TourFor<GettingStartedEvent, GettingStartedCondition> = {
  id: 'getting-started',
  videoId: 'SYMLo4VKjMI',
  titleKey: tourTitleKey(BASE),
  descriptionKey: tourDescKey(BASE),
  unavailableIf: 'not-owner',
  steps: [
    { id: 'open-documents', target: 'nav-documents', textKey: stepKey(BASE, 'open-documents'),
      skipIf: 'has-documents',
      advance: { type: 'events', events: ['route-opened-documents'] } },
    { id: 'import-documents', target: 'documents-import', textKey: stepKey(BASE, 'import-documents'),
      route: '#/documents', dynamicTarget: true,
      skipIf: 'has-documents',
      advance: { type: 'events', events: ['documents-imported'] } },
    { id: 'open-protocol', target: 'nav-protocol', textKey: stepKey(BASE, 'open-protocol'),
      skipIf: 'has-protocol',
      advance: { type: 'events', events: ['route-opened-protocol'] } },
    { id: 'enter-protocol', target: 'protocol-save', textKey: stepKey(BASE, 'enter-protocol'),
      route: '#/protocol', dynamicTarget: true,
      skipIf: 'has-protocol',
      advance: { type: 'events', events: ['protocol-saved'] } },
    { id: 'open-schema', target: 'nav-schema', textKey: stepKey(BASE, 'open-schema'),
      skipIf: 'has-confirmed-schema',
      advance: { type: 'events', events: ['route-opened-schema'] } },
    { id: 'draft-schema', target: 'schema-draft', textKey: stepKey(BASE, 'draft-schema'),
      route: '#/schema', dynamicTarget: true,
      skipIf: 'has-confirmed-schema',
      advance: { type: 'next' } },
    { id: 'confirm-schema', target: 'schema-confirm', textKey: stepKey(BASE, 'confirm-schema'),
      route: '#/schema', dynamicTarget: true,
      skipIf: 'has-confirmed-schema',
      advance: { type: 'events', events: ['schema-confirmed'], optional: true } },
    { id: 'finish', target: 'tour-list', textKey: stepKey(BASE, 'finish'),
      advance: { type: 'next' } },
  ],
};
