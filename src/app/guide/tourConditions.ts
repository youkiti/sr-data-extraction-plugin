import type { GuideCondition } from '../../lib/guide/tours';
import type { AppState } from '../store';

export function computeGuideConditions(state: AppState): Record<GuideCondition, boolean> {
  const owner = state.role.role === 'owner' && !state.role.resolving && state.role.error === null;
  return {
    'has-documents': state.counts.documents > 0,
    'has-protocol': state.counts.protocolVersions > 0,
    'has-confirmed-schema': state.counts.schemaVersions > 0,
    'is-owner': owner,
    'not-owner': !owner,
  };
}
