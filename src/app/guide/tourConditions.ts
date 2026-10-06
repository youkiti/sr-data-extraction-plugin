import type { GuideCondition } from '../../lib/guide/tours';
import type { AppState } from '../store';
import { GUIDE_ADAPTERS } from './adapters';

export function computeGuideConditions(state: AppState): Record<GuideCondition, boolean> {
  const owner = state.role.role === 'owner' && !state.role.resolving && state.role.error === null;
  return {
    'has-documents': state.counts.documents > 0,
    'has-protocol': state.counts.protocolVersions > 0,
    'has-confirmed-schema': state.counts.schemaVersions > 0,
    'is-owner': owner,
    ...GUIDE_ADAPTERS.gettingStarted.conditions(state),
    ...GUIDE_ADAPTERS.pilotAndExtract.conditions(state),
    ...GUIDE_ADAPTERS.verifyBasics.conditions(state),
    ...GUIDE_ADAPTERS.dualReview.conditions(state),
    ...GUIDE_ADAPTERS.exportData.conditions(state),
  };
}
