import { tourDescKey, tourKeyBase, tourTitleKey } from './keys';
import type { TourFor } from './types';

export type ExportDataEvent = never;
export type ExportDataCondition = never;
const BASE = tourKeyBase('export-data');

export const EXPORT_DATA_TOUR: TourFor<ExportDataEvent, ExportDataCondition> = {
  id: 'export-data',
  titleKey: tourTitleKey(BASE),
  descriptionKey: tourDescKey(BASE),
  draft: true,
  steps: [],
};
