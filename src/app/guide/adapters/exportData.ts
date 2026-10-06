import type { GuideCondition } from '../../../lib/guide/tours';
import type { ExportDataCondition, ExportDataEvent } from '../../../lib/guide/tours/exportData';
import type { AppState } from '../../store';

export const EXPORT_DATA_ADAPTER = {
  conditions(_state: AppState): Record<ExportDataCondition, boolean> {
    return {};
  },
  risingEvents: {} satisfies Partial<Record<GuideCondition, ExportDataEvent>>,
};
