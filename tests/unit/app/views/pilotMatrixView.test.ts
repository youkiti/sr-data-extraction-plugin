import { emptyPilotMatrix } from '../../../../src/app/services/pilotMatrixService';
import { createInitialState } from '../../../../src/app/store';
import { pilotMatrixRows, renderPilotMatrix, renderSchemaPilotMisses } from '../../../../src/app/views/pilotMatrixView';
import type { ViewContext } from '../../../../src/app/views/types';
import { makeDecision, makeEvidence, makeField, makeRun } from '../../features/verification/pilotMatrixFixtures';

function stateOf() {
  const state = createInitialState();
  state.pilot.run = makeRun({ runId: 'run-1', studyIds: ['study-1'] });
  state.pilot.runFields = [makeField()];
  state.pilot.evidence = [makeEvidence()];
  state.pilot.matrix = { ...emptyPilotMatrix(), runId: 'run-1' };
  return state;
}
const callbacks = { onSortMatrix: jest.fn(), onRetryMatrix: jest.fn() };
const ctx = { pilot: callbacks } as unknown as ViewContext;

test('読み込み中・失敗と再試行・空を区別する', () => {
  const state = stateOf();
  state.pilot.matrix!.loading = true;
  expect(renderPilotMatrix(state, ctx).querySelector('#pilot-matrix-loading')).not.toBeNull();
  state.pilot.matrix!.loading = false;
  state.pilot.run = null;
  expect(renderPilotMatrix(state, ctx).querySelector('#pilot-matrix-loading')).not.toBeNull();
  state.pilot.run = makeRun({ runId: 'other' });
  expect(renderPilotMatrix(state, ctx).querySelector('#pilot-matrix-loading')).not.toBeNull();
  state.pilot.matrix!.error = 'offline';
  let root = renderPilotMatrix(state, ctx);
  expect(root.querySelector('#pilot-matrix-error')?.getAttribute('role')).toBe('alert');
  root.querySelector<HTMLButtonElement>('button')!.click();
  expect(callbacks.onRetryMatrix).toHaveBeenCalled();
  renderPilotMatrix(state, { pilot: {} } as ViewContext).querySelector<HTMLButtonElement>('button')!.click();
  state.pilot.matrix!.error = null;
  state.pilot.run = makeRun({ runId: 'run-1' });
  for (const evidence of [null, []]) {
    state.pilot.evidence = evidence;
    root = renderPilotMatrix(state, ctx);
    expect(root.querySelector('#pilot-matrix-empty')).not.toBeNull();
  }
  state.pilot.matrix!.compareError = 'offline';
  expect(renderPilotMatrix(state, ctx).querySelector('#pilot-matrix-compare-error')).not.toBeNull();
});

test('表見出し、表示だけのセル、凡例、リンクと並べ替え', () => {
  const state = stateOf();
  state.pilot.runFields!.push(makeField({ fieldId: 'arm', entityLevel: 'arm', fieldIndex: 2 }));
  let root = renderPilotMatrix(state, ctx);
  expect(root.querySelectorAll('details[open]')).toHaveLength(1);
  expect(root.querySelector('th[scope=col]')?.textContent).toBe('項目');
  expect(root.querySelector('tbody a')?.getAttribute('href')).toBe('#/schema?field=f-1');
  expect(root.querySelector('td button')).toBeNull();
  expect(root.querySelector('.pilot__matrix-legend')?.textContent).toContain('NR✓');
  root.querySelector<HTMLButtonElement>('#pilot-matrix-sort')!.click();
  expect(callbacks.onSortMatrix).toHaveBeenCalled();
  renderPilotMatrix(state, { pilot: {} } as ViewContext).querySelector<HTMLButtonElement>('button')!.click();
  state.pilot.matrix!.sortByMisses = true;
  state.pilot.evidence!.push(makeEvidence({ fieldId: 'arm', entityKey: 'arm:1', anchorStatus: 'failed' }));
  root = renderPilotMatrix(state, ctx);
  expect(root.querySelector('details')).toBeNull();
  expect(root.querySelector('button')?.getAttribute('aria-pressed')).toBe('true');
  expect(root.querySelector('tbody td')?.textContent).toBe('1/1');
});

test('前回比較・対象集合の違い・比較失敗を表示する', () => {
  const state = stateOf();
  state.documents.studies = [{ studyId: 'study-1', studyLabel: '研究 A', registrationId: null,
    reviewSet: null, createdAt: 't', createdBy: 'me', note: null }];
  state.pilot.runFields!.push(makeField({ fieldId: 'new', fieldIndex: 2 }));
  state.pilot.matrix!.previous = makeRun({ runId: 'previous', studyIds: ['study-2'] });
  expect(renderPilotMatrix(state, ctx).textContent).toContain('読み込み中');
  state.pilot.matrix!.compareLoaded = true;
  state.pilot.matrix!.previousEvidence = [makeEvidence({ runId: 'previous', studyId: 'study-2' })];
  state.pilot.matrix!.decisions = [makeDecision(), makeDecision({ studyId: 'study-2', action: 'edit' })];
  let root = renderPilotMatrix(state, ctx);
  expect(root.querySelector('#pilot-matrix-compare-note')).not.toBeNull();
  expect(root.textContent).toContain('研究 A');
  expect(root.textContent).toContain('前回 0/0 → 今回 0/0');
  expect(root.textContent).toContain('前回 1/1 → 今回 0/1');
  expect(root.querySelector('td[aria-label^="改善"]')).not.toBeNull();
  state.pilot.matrix!.previous.studyIds = ['study-1'];
  expect(renderPilotMatrix(state, ctx).querySelector('#pilot-matrix-compare-note')).toBeNull();
  state.pilot.matrix!.previous.studyIds = ['study-1', 'study-2'];
  expect(renderPilotMatrix(state, ctx).querySelector('#pilot-matrix-compare-note')).not.toBeNull();
  state.pilot.matrix!.compareError = '403';
  root = renderPilotMatrix(state, ctx);
  expect(root.querySelector('#pilot-matrix-compare-error')?.textContent).toContain('403');
  expect(root.querySelector('table')).not.toBeNull();
  state.pilot.runFields = null;
  expect(renderPilotMatrix(state, ctx).querySelector('table')).toBeNull();
  state.pilot.run = null;
  state.pilot.evidence = null;
  state.pilot.matrix = undefined;
  expect(pilotMatrixRows(state)).toEqual([]);
});

test('参考情報は外れ entity の AI 値・確定値・メモを表示する', () => {
  const state = stateOf();
  expect(renderSchemaPilotMisses(state, 'f-1')).toBeNull();
  state.pilot.matrix!.decisions = [makeDecision({ action: 'edit', value: '99', note: 'Table 2' })];
  expect(renderSchemaPilotMisses(state, 'f-1')?.textContent).toContain('120 → 99 (Table 2)');
  state.pilot.matrix!.decisions = [makeDecision({ action: 'reject' })];
  expect(renderSchemaPilotMisses(state, 'f-1')?.textContent).toContain('120 → 棄却');
  state.pilot.matrix!.decisions = [makeDecision({ action: 'not_reported' })];
  expect(renderSchemaPilotMisses(state, 'f-1')?.textContent).toContain('120 → 未報告');
  state.pilot.runFields = [makeField({ entityLevel: 'arm' })];
  state.pilot.evidence = [makeEvidence({ entityKey: 'arm:1', value: null, anchorStatus: 'failed' })];
  expect(renderSchemaPilotMisses(state, 'f-1')?.textContent).toContain('群 1');
  expect(renderSchemaPilotMisses(state, 'f-1')?.textContent).toContain('根拠の位置を特定できず');
  state.pilot.evidence = [makeEvidence()];
  state.pilot.matrix!.decisions = [makeDecision({ action: 'edit', value: null })];
  expect(renderSchemaPilotMisses(state, 'f-1')).not.toBeNull();
  expect(renderSchemaPilotMisses(state, 'missing')).toBeNull();
  state.pilot.matrix!.error = 'error';
  expect(renderSchemaPilotMisses(state, 'f-1')).toBeNull();
  state.pilot.run = null;
  expect(renderSchemaPilotMisses(state, 'f-1')).toBeNull();
});
