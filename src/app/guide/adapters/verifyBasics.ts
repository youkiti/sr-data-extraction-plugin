import type { GuideCondition } from '../../../lib/guide/tours';
import type { VerifyBasicsCondition, VerifyBasicsEvent } from '../../../lib/guide/tours/verifyBasics';
import type { AppState } from '../../store';

export const VERIFY_BASICS_ADAPTER = {
  conditions(_state: AppState): Record<VerifyBasicsCondition, boolean> {
    return {};
  },
  risingEvents: {} satisfies Partial<Record<GuideCondition, VerifyBasicsEvent>>,
};
