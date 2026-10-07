import type { GuideCondition } from '../../../lib/guide/tours';
import type { ExportDataCondition, ExportDataEvent } from '../../../lib/guide/tours/exportData';
import type { AppState } from '../../store';

export const EXPORT_DATA_ADAPTER = {
  conditions(state: AppState): Record<ExportDataCondition, boolean> {
    const owner = state.role.role === 'owner' && !state.role.resolving && state.role.error === null;
    return { 'export-data-unavailable': !owner || state.counts.dataRows < 1 };
  },
  risingEvents: {} satisfies Partial<Record<GuideCondition, ExportDataEvent>>,
};
