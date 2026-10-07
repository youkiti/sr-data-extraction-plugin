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

test('パイロットと一括抽出の完了状態から結果の有無を計算する', () => {
  const state = readyState();
  expect(adapter.conditions(state)['pilot-and-extract-has-pilot']).toBe(false);
  expect(adapter.conditions(state)['pilot-and-extract-has-full']).toBe(false);
  state.counts.pilotRuns = 1;
  state.counts.evidenceRows = 5;
  expect(adapter.conditions(state)['pilot-and-extract-has-pilot']).toBe(false);
  state.pilot.run = { status: 'done' } as ExtractionRun;
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
  state.pilot.run = { status: 'done' } as ExtractionRun;
  state.extract.run = { status: 'done' } as ExtractionRun;
  const after = computeGuideConditions(state);
  expect(guideEvents(before, after)).toEqual(['pilot-and-extract-pilot-ready', 'pilot-and-extract-full-ready']);
  expect(guideEvents(after, after)).toEqual([]);
  expect(guideEvents(after, before)).toEqual([]);
});

test('パイロットの未実行・実行中・完了・失敗を区別する', () => {
  const state = readyState();
  expect(adapter.conditions(state)['pilot-and-extract-has-pilot']).toBe(false);
  state.pilot.running = true;
  expect(adapter.conditions(state)['pilot-and-extract-has-pilot']).toBe(false);
  state.pilot.running = false;
  state.pilot.runError = '抽出に失敗しました';
  expect(adapter.conditions(state)['pilot-and-extract-has-pilot']).toBe(false);
  state.pilot.runError = null;
  for (const status of ['queued', 'running', 'done', 'partial_failure'] as RunStatus[]) {
    state.pilot.run = { status } as ExtractionRun;
    expect(adapter.conditions(state)['pilot-and-extract-has-pilot']).toBe(['done', 'partial_failure'].includes(status));
  }
});

test.each(['done', 'partial_failure'] as const)('再パイロットが %s で完了した時だけイベントを一度通知する', (status) => {
  const state = readyState();
  state.counts.pilotRuns = 1;
  state.pilot.run = { status: 'done' } as ExtractionRun;
  const completed = computeGuideConditions(state);
  expect(completed['pilot-and-extract-has-pilot']).toBe(true);
  state.pilot.running = true;
  const running = computeGuideConditions(state);
  expect(running['pilot-and-extract-has-pilot']).toBe(false);
  expect(guideEvents(completed, running)).toEqual([]);
  state.pilot.running = false;
  state.pilot.run = { status } as ExtractionRun;
  state.counts.pilotRuns = 2;
  const rerunCompleted = computeGuideConditions(state);
  expect(rerunCompleted['pilot-and-extract-has-pilot']).toBe(true);
  expect(guideEvents(running, rerunCompleted)).toEqual(['pilot-and-extract-pilot-ready']);
  expect(guideEvents(rerunCompleted, computeGuideConditions(state))).toEqual([]);
});

test('再パイロットが失敗した場合は前回の結果が残っていてもイベントを通知しない', () => {
  const state = readyState();
  state.counts.pilotRuns = 1;
  state.pilot.run = { status: 'done' } as ExtractionRun;
  const completed = computeGuideConditions(state);
  state.pilot.running = true;
  const running = computeGuideConditions(state);
  expect(guideEvents(completed, running)).toEqual([]);
  state.pilot.running = false;
  state.pilot.runError = '抽出に失敗しました';
  const failed = computeGuideConditions(state);
  expect(failed['pilot-and-extract-has-pilot']).toBe(false);
  expect(guideEvents(running, failed)).toEqual([]);
  expect(guideEvents(failed, failed)).toEqual([]);
});
