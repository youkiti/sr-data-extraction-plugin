import { PILOT_AND_EXTRACT_ADAPTER } from '../../../../../src/app/guide/adapters/pilotAndExtract';
import { createInitialState } from '../../../../../src/app/store';

test('空の枠は固有条件とイベント対応を持たない', () => {
  expect(PILOT_AND_EXTRACT_ADAPTER.conditions(createInitialState())).toEqual({});
  expect(PILOT_AND_EXTRACT_ADAPTER.risingEvents).toEqual({});
});
