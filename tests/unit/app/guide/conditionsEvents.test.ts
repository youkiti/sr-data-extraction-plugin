import { createInitialState } from '../../../../src/app/store';
import { computeGuideConditions } from '../../../../src/app/guide/tourConditions';
import { guideEvents, routeGuideEvent } from '../../../../src/app/guide/guideEvents';

test('件数と解決済み owner から条件を作り、立ち上がりだけを通知する', () => {
  const state = createInitialState();
  const before = computeGuideConditions(state);
  expect(before).toMatchObject({ 'has-documents': false, 'has-protocol': false, 'has-confirmed-schema': false, 'is-owner': false, 'not-owner': true });
  state.role.role = 'owner';
  state.counts.documents = state.counts.protocolVersions = state.counts.schemaVersions = 1;
  const after = computeGuideConditions(state);
  expect(after).toMatchObject({ 'has-documents': true, 'has-protocol': true, 'has-confirmed-schema': true, 'is-owner': true, 'not-owner': false });
  for (const conditions of [before, after]) {
    for (const value of Object.values(conditions)) expect(typeof value).toBe('boolean');
  }
  const events = guideEvents(before, after);
  expect(events.filter(event => ['documents-imported', 'protocol-saved', 'schema-confirmed'].includes(event)))
    .toEqual(['documents-imported', 'protocol-saved', 'schema-confirmed']);
  expect(guideEvents(after, after)).toEqual([]);
  expect(guideEvents(after, before)).toEqual([]);
  state.role.resolving = true;
  expect(computeGuideConditions(state)['not-owner']).toBe(true);
  state.role.resolving = false;
  state.role.error = '失敗';
  expect(computeGuideConditions(state)['not-owner']).toBe(true);
  expect(routeGuideEvent('#/documents')).toBe('route-opened-documents');
});
