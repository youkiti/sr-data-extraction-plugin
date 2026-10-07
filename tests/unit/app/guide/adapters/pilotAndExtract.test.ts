import { PILOT_AND_EXTRACT_ADAPTER as adapter } from '../../../../../src/app/guide/adapters/pilotAndExtract';
import { computeGuideConditions } from '../../../../../src/app/guide/tourConditions';
import { guideEvents } from '../../../../../src/app/guide/guideEvents';
import { guardRoute } from '../../../../../src/app/guards';
import { createInitialState } from '../../../../../src/app/store';
import type { ExtractionRun, RunStatus } from '../../../../../src/domain/extractionRun';

function readyState() {
  const state = createInitialState();
  state.role.role = 'owner';
  state.counts.schemaVersions = 1;
  state.counts.documents = 1;
  return state;
}

test('解決済み owner・確定スキーマ・文書がそろう場合だけ利用できる', () => {
  const state = readyState();
  expect(adapter.conditions(state)['pilot-and-extract-unavailable']).toBe(false);
  for (const route of ['#/pilot', '#/extract']) expect(guardRoute(route, state, 'owner').allowed).toBe(true);
  expect(guardRoute('#/extract', state, 'owner')).toHaveProperty('warning');
  state.counts.documents = 0;
  expect(adapter.conditions(state)['pilot-and-extract-unavailable']).toBe(true);
  state.counts.documents = 1;
  state.counts.schemaVersions = 0;
  expect(adapter.conditions(state)['pilot-and-extract-unavailable']).toBe(true);
  state.counts.schemaVersions = 1;
  state.role.resolving = true;
  expect(adapter.conditions(state)['pilot-and-extract-unavailable']).toBe(true);
  state.role.resolving = false;
  state.role.error = '失敗';
  expect(adapter.conditions(state)['pilot-and-extract-unavailable']).toBe(true);
  state.role.error = null;
  state.role.role = 'reviewer_with_ai';
  expect(adapter.conditions(state)['pilot-and-extract-unavailable']).toBe(true);
  expect(adapter.conditions(createInitialState())['pilot-and-extract-unavailable']).toBe(true);
});

test('パイロット実行数と一括抽出の完了状態から結果の有無を計算する', () => {
  const state = readyState();
  expect(adapter.conditions(state)['pilot-and-extract-has-pilot']).toBe(false);
  expect(adapter.conditions(state)['pilot-and-extract-has-full']).toBe(false);
  state.counts.pilotRuns = 1;
  state.counts.evidenceRows = 5;
  expect(adapter.conditions(state)['pilot-and-extract-has-pilot']).toBe(true);
  expect(adapter.conditions(state)['pilot-and-extract-has-full']).toBe(false);
  for (const status of ['queued', 'running', 'done', 'partial_failure'] as RunStatus[]) {
    state.extract.run = { status } as ExtractionRun;
    expect(adapter.conditions(state)['pilot-and-extract-has-full']).toBe(['done', 'partial_failure'].includes(status));
  }
});

test('結果条件の偽から真への変化だけをイベントにする', () => {
  expect(adapter.risingEvents).toEqual({
    'pilot-and-extract-has-pilot': 'pilot-and-extract-pilot-ready',
    'pilot-and-extract-has-full': 'pilot-and-extract-full-ready',
  });
  const state = readyState();
  const before = computeGuideConditions(state);
  state.counts.pilotRuns = 1;
  state.extract.run = { status: 'done' } as ExtractionRun;
  const after = computeGuideConditions(state);
  expect(guideEvents(before, after)).toEqual(['pilot-and-extract-pilot-ready', 'pilot-and-extract-full-ready']);
  expect(guideEvents(after, after)).toEqual([]);
  expect(guideEvents(after, before)).toEqual([]);
});
