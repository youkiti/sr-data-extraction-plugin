import type { GuideCondition } from '../../../lib/guide/tours';
import type { PilotAndExtractCondition, PilotAndExtractEvent } from '../../../lib/guide/tours/pilotAndExtract';
import type { AppState } from '../../store';

export const PILOT_AND_EXTRACT_ADAPTER = {
  conditions(_state: AppState): Record<PilotAndExtractCondition, boolean> {
    return {};
  },
  risingEvents: {} satisfies Partial<Record<GuideCondition, PilotAndExtractEvent>>,
};
