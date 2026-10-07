import type { GuideCondition } from '../../../lib/guide/tours';
import type { PilotAndExtractCondition, PilotAndExtractEvent } from '../../../lib/guide/tours/pilotAndExtract';
import type { AppState } from '../../store';

export const PILOT_AND_EXTRACT_ADAPTER = {
  conditions(state: AppState): Record<PilotAndExtractCondition, boolean> {
    const owner = state.role.role === 'owner' && !state.role.resolving && state.role.error === null;
    const run = state.extract.run;
    return {
      'pilot-and-extract-unavailable': !owner || state.counts.schemaVersions < 1 || state.counts.documents < 1,
      'pilot-and-extract-has-pilot': !state.pilot.running && state.pilot.runError === null && state.pilot.run !== null
        && (state.pilot.run.status === 'done' || state.pilot.run.status === 'partial_failure'),
      'pilot-and-extract-has-full': run !== null && (run.status === 'done' || run.status === 'partial_failure'),
    };
  },
  risingEvents: {
    'pilot-and-extract-has-pilot': 'pilot-and-extract-pilot-ready',
    'pilot-and-extract-has-full': 'pilot-and-extract-full-ready',
  } satisfies Partial<Record<GuideCondition, PilotAndExtractEvent>>,
};
