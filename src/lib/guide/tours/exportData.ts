import { stepKey, tourDescKey, tourKeyBase, tourTitleKey } from './keys';
import type { TourFor } from './types';

export type ExportDataEvent = never;
export type ExportDataCondition = 'export-data-unavailable';
const BASE = tourKeyBase('export-data');

export const EXPORT_DATA_TOUR: TourFor<ExportDataEvent, ExportDataCondition> = {
  id: 'export-data',
  videoId: 'BZ3UFV31zaY',
  titleKey: tourTitleKey(BASE),
  descriptionKey: tourDescKey(BASE),
  unavailableIf: 'export-data-unavailable',
  steps: [
    { id: 'open-dashboard', target: 'nav-dashboard', textKey: stepKey(BASE, 'open-dashboard'),
      advance: { type: 'events', events: ['route-opened-dashboard'] } },
    { id: 'check-progress', target: 'export-data-progress', textKey: stepKey(BASE, 'check-progress'),
      route: '#/dashboard', dynamicTarget: true,
      advance: { type: 'next' } },
    { id: 'open-export', target: 'nav-export', textKey: stepKey(BASE, 'open-export'),
      advance: { type: 'events', events: ['route-opened-export'] } },
    { id: 'choose-format', target: 'export-data-format', textKey: stepKey(BASE, 'choose-format'),
      route: '#/export', dynamicTarget: true,
      advance: { type: 'next' } },
    { id: 'unverified-warning', target: 'export-data-warning', textKey: stepKey(BASE, 'unverified-warning'),
      route: '#/export', dynamicTarget: true,
      advance: { type: 'next' } },
    { id: 'generate', target: 'export-data-generate', textKey: stepKey(BASE, 'generate'),
      route: '#/export', dynamicTarget: true,
      advance: { type: 'next' } },
    { id: 'finish', target: 'tour-list', textKey: stepKey(BASE, 'finish'),
      advance: { type: 'next' } },
  ],
};
