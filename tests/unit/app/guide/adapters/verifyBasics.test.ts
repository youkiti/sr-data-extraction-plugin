import { VERIFY_BASICS_ADAPTER } from '../../../../../src/app/guide/adapters/verifyBasics';
import { guardRoute } from '../../../../../src/app/guards';
import { computeGuideConditions } from '../../../../../src/app/guide/tourConditions';
import { availableTours } from '../../../../../src/lib/guide/tourProgress';
import { createInitialState, type AppState, type VerifyTarget } from '../../../../../src/app/store';

function owner(): AppState {
  const state = createInitialState();
  state.currentProject = { projectId: 'project', spreadsheetId: 'sheet', driveFolderId: 'folder', name: '検証' };
  state.role.role = 'owner';
  state.counts.schemaVersions = 1;
  state.counts.documents = 1;
  state.counts.evidenceRows = 1;
  return state;
}

function targets(hasEvidence: boolean): VerifyTarget[] {
  // 条件が読むのは根拠配列だけなので、画面描画用の値は省く。
  return [{ evidence: hasEvidence ? [{}] : [] }] as VerifyTarget[];
}

function unavailable(state: AppState): boolean {
  return VERIFY_BASICS_ADAPTER.conditions(state)['verify-basics-unavailable'];
}

test('未読込のオーナーは件数から判定し、読み込み後は実際の検証対象を優先する', () => {
  const state = owner();
  expect(unavailable(state)).toBe(false);
  expect(guardRoute('#/verify', state, 'owner').allowed).toBe(true);
  state.verify.targets = [];
  expect(unavailable(state)).toBe(true);
  state.verify.targets = targets(false);
  expect(unavailable(state)).toBe(true);
  state.verify.targets = targets(true);
  state.counts.evidenceRows = 0;
  expect(unavailable(state)).toBe(false);
});

test.each<[string, (state: AppState) => void]>([
  ['プロジェクトなし', state => { state.currentProject = null; }],
  ['解決中', state => { state.role.resolving = true; }],
  ['解決失敗', state => { state.role.error = '失敗'; }],
  ['スキーマなし', state => { state.counts.schemaVersions = 0; }],
  ['文献なし', state => { state.counts.documents = 0; }],
  ['根拠なし', state => { state.counts.evidenceRows = 0; }],
  ['ロール未解決', state => { state.role.role = null; }],
  ['独立入力', state => { state.role.role = 'reviewer_independent'; }],
  ['裁定者', state => { state.role.role = 'adjudicator'; }],
  ['未登録', state => { state.role.role = 'unregistered'; }],
])('%s では一覧から除外する', (_label, change) => {
  const state = owner();
  change(state);
  expect(unavailable(state)).toBe(true);
  expect(availableTours(undefined, computeGuideConditions(state)).map(tour => tour.id)).not.toContain('verify-basics');
});

test('AI 併用レビュアーはファイルアクセスと読み込み済みの根拠を必要とする', () => {
  const state = owner();
  state.role.role = 'reviewer_with_ai';
  state.role.folderAccessGranted = true;
  expect(unavailable(state)).toBe(true);
  state.counts = createInitialState().counts;
  state.verify.targets = targets(true);
  expect(unavailable(state)).toBe(false);
  expect(guardRoute('#/verify', state, 'reviewer_with_ai').allowed).toBe(true);
  expect(availableTours(undefined, computeGuideConditions(state)).map(tour => tour.id)).toContain('verify-basics');
  state.role.folderAccessGranted = false;
  expect(unavailable(state)).toBe(true);
});

test('判定保存の件数をイベントにせず、固有の立ち上がりイベントは持たない', () => {
  expect(VERIFY_BASICS_ADAPTER.risingEvents).toEqual({});
});
