import { GETTING_STARTED_ADAPTER } from '../../../../../src/app/guide/adapters/gettingStarted';
import { createInitialState } from '../../../../../src/app/store';

test('解決済みでエラーの無い owner だけが利用できる', () => {
  const state = createInitialState();
  expect(GETTING_STARTED_ADAPTER.conditions(state)).toEqual({ 'not-owner': true });
  state.role.role = 'owner';
  expect(GETTING_STARTED_ADAPTER.conditions(state)).toEqual({ 'not-owner': false });
  state.role.resolving = true;
  expect(GETTING_STARTED_ADAPTER.conditions(state)).toEqual({ 'not-owner': true });
  state.role.resolving = false;
  state.role.error = '失敗';
  expect(GETTING_STARTED_ADAPTER.conditions(state)).toEqual({ 'not-owner': true });
});

test('取り込み・プロトコル保存・スキーマ確定を対応付ける', () => {
  expect(GETTING_STARTED_ADAPTER.risingEvents).toEqual({
    'has-documents': 'documents-imported',
    'has-protocol': 'protocol-saved',
    'has-confirmed-schema': 'schema-confirmed',
  });
});
