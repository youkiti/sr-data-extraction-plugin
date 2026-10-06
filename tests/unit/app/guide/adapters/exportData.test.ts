import { EXPORT_DATA_ADAPTER } from '../../../../../src/app/guide/adapters/exportData';
import { createInitialState } from '../../../../../src/app/store';

test('空の枠は固有条件とイベント対応を持たない', () => {
  expect(EXPORT_DATA_ADAPTER.conditions(createInitialState())).toEqual({});
  expect(EXPORT_DATA_ADAPTER.risingEvents).toEqual({});
});
