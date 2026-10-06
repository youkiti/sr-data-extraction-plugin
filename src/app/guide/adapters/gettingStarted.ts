import type { GuideCondition } from '../../../lib/guide/tours';
import type { GettingStartedCondition, GettingStartedEvent } from '../../../lib/guide/tours/gettingStarted';
import type { AppState } from '../../store';

export const GETTING_STARTED_ADAPTER = {
  conditions(state: AppState): Record<GettingStartedCondition, boolean> {
    const owner = state.role.role === 'owner' && !state.role.resolving && state.role.error === null;
    return { 'not-owner': !owner };
  },
  risingEvents: {
    'has-documents': 'documents-imported',
    'has-protocol': 'protocol-saved',
    'has-confirmed-schema': 'schema-confirmed',
  } satisfies Partial<Record<GuideCondition, GettingStartedEvent>>,
};
