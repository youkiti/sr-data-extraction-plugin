import { DUAL_REVIEW_ADAPTER } from '../../../../../src/app/guide/adapters/dualReview';
import { createInitialState } from '../../../../../src/app/store';
import { guardRoute } from '../../../../../src/app/guards';
import { availableTours } from '../../../../../src/lib/guide/tourProgress';
import { DUAL_REVIEW_TOUR } from '../../../../../src/lib/guide/tours/dualReview';

function readyState() {
  const state = createInitialState();
  state.currentProject = { projectId: 'p', spreadsheetId: 's', driveFolderId: 'f', name: 'テスト' };
  state.role.role = 'owner';
  state.counts.documents = 1;
  return state;
}

test('文献のあるプロジェクトの解決済み owner に公開し、判定前でも全ルートへ入れる', () => {
  const state = readyState();
  const conditions = DUAL_REVIEW_ADAPTER.conditions(state);
  expect(conditions).toEqual({ 'dual-review-unavailable': false });
  expect(availableTours(undefined, conditions).map(tour => tour.id)).toContain('dual-review');
  for (const route of ['#/home', '#/adjudicate', ...DUAL_REVIEW_TOUR.steps.flatMap(step => step.route ? [step.route] : [])]) {
    expect(guardRoute(route, state, 'owner').allowed).toBe(true);
  }
});

test.each(['role', 'resolving', 'error', 'project', 'documents'] as const)('%s が前提を満たさなければ一覧に出さない', reason => {
  const state = readyState();
  if (reason === 'role') state.role.role = 'reviewer_independent';
  if (reason === 'resolving') state.role.resolving = true;
  if (reason === 'error') state.role.error = '失敗';
  if (reason === 'project') state.currentProject = null;
  if (reason === 'documents') state.counts.documents = 0;
  const conditions = DUAL_REVIEW_ADAPTER.conditions(state);
  expect(conditions).toEqual({ 'dual-review-unavailable': true });
  expect(availableTours(undefined, conditions).map(tour => tour.id)).not.toContain('dual-review');
});

test('未解決の初期状態では利用不可で、固有の立ち上がりイベントはない', () => {
  expect(DUAL_REVIEW_ADAPTER.conditions(createInitialState())).toEqual({ 'dual-review-unavailable': true });
  expect(DUAL_REVIEW_ADAPTER.risingEvents).toEqual({});
});
