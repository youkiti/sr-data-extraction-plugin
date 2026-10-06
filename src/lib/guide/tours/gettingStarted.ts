import { tourDescKey, tourKeyBase, tourTitleKey } from './keys';
import type { TourFor } from './types';

const BASE = tourKeyBase('getting-started');

/** 文献の取り込みからスキーマ確定までの案内。手順は未作成。 */
export const GETTING_STARTED_TOUR: TourFor = {
  id: 'getting-started',
  titleKey: tourTitleKey(BASE),
  descriptionKey: tourDescKey(BASE),
  draft: true,
  steps: [],
};
