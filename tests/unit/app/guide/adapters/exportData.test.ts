import { availableTours } from '../../../../../src/lib/guide/tourProgress';
import { computeGuideConditions } from '../../../../../src/app/guide/tourConditions';
import { EXPORT_DATA_TOUR } from '../../../../../src/lib/guide/tours/exportData';
import { EXPORT_DATA_ADAPTER } from '../../../../../src/app/guide/adapters/exportData';
import { createInitialState } from '../../../../../src/app/store';
import { guardRoute } from '../../../../../src/app/guards';

test('解決済みでエラーの無い owner と書き出すデータが必要', () => {
  const state = createInitialState();
  const unavailable = () => EXPORT_DATA_ADAPTER.conditions(state)['export-data-unavailable'];
  expect(unavailable()).toBe(true);
  state.counts.dataRows = 1;
  expect(unavailable()).toBe(true);
  state.role.role = 'reviewer_with_ai';
  expect(unavailable()).toBe(true);
  state.role.role = 'owner';
  expect(unavailable()).toBe(false);
  state.role.resolving = true;
  expect(unavailable()).toBe(true);
  state.role.resolving = false;
  state.role.error = '失敗';
  expect(unavailable()).toBe(true);
  state.role.error = null;
  state.counts.dataRows = 0;
  expect(unavailable()).toBe(true);
});

test('利用可能なら全手順の画面のガードを通る', () => {
  const state = createInitialState();
  state.role.role = 'owner';
  state.counts.dataRows = 1;
  expect(EXPORT_DATA_ADAPTER.conditions(state)['export-data-unavailable']).toBe(false);
  for (const route of ['#/dashboard', '#/export']) {
    expect(guardRoute(route, state, 'owner').allowed).toBe(true);
  }
});

test('固有の立ち上がりイベントは不要', () => {
  expect(EXPORT_DATA_ADAPTER.risingEvents).toEqual({});
});

test('前提を満たすときだけ一覧に出る', () => {
  const state = createInitialState();
  const tours = () => availableTours([EXPORT_DATA_TOUR], computeGuideConditions(state));
  expect(tours()).toEqual([]);
  state.role.role = 'owner';
  expect(tours()).toEqual([]);
  state.counts.dataRows = 1;
  expect(tours()).toEqual([EXPORT_DATA_TOUR]);
  state.role.role = 'reviewer_independent';
  expect(tours()).toEqual([]);
});
