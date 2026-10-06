import { DUAL_REVIEW_ADAPTER } from '../../../../../src/app/guide/adapters/dualReview';
import { createInitialState } from '../../../../../src/app/store';

test('空の枠は固有条件とイベント対応を持たない', () => {
  expect(DUAL_REVIEW_ADAPTER.conditions(createInitialState())).toEqual({});
  expect(DUAL_REVIEW_ADAPTER.risingEvents).toEqual({});
});
