import { VERIFY_BASICS_ADAPTER } from '../../../../../src/app/guide/adapters/verifyBasics';
import { createInitialState } from '../../../../../src/app/store';

test('空の枠は固有条件とイベント対応を持たない', () => {
  expect(VERIFY_BASICS_ADAPTER.conditions(createInitialState())).toEqual({});
  expect(VERIFY_BASICS_ADAPTER.risingEvents).toEqual({});
});
