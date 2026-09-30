// 担当セットカードの全状態と、入力・保存・再分割確認のコールバックを検証する。
import { renderReviewSetsCard } from '../../../../src/app/views/reviewSetsCard';
import { createInitialState } from '../../../../src/app/store';
import type { ViewContext, HomeViewCallbacks } from '../../../../src/app/views/types';
import type { DocumentRecord } from '../../../../src/domain/document';
import { study, reviewSet } from '../../features/review/reviewSetFixtures';

const doc = (studyId: string): DocumentRecord => ({
  documentId: studyId,
  studyId,
  documentRole: 'article',
  driveFileId: studyId,
  sourceFileId: null,
  filename: '研究.pdf',
  pmid: null,
  doi: null,
  textRef: null,
  textStatus: 'ok',
  pageCount: null,
  charCount: null,
  importedAt: 't0',
  importedBy: 'owner@example.com',
  note: null,
  excluded: false,
  exclusionReason: null,
  exclusionNote: null,
  excludedAt: null,
});
function fixture(used = false) {
  const state = createInitialState();
  state.reviewSets.sets = used
    ? [
        reviewSet({ setId: 'group-10', reviewerEmails: ['c@example.com'], seed: '42' }),
        reviewSet({ setId: 'calibration', reviewerEmails: [], seed: null }),
        reviewSet({ seed: null }),
      ]
    : [];
  state.documents.studies = [
    study({ reviewSet: used ? 'group-1' : null }),
    study({ studyId: 'cal', reviewSet: used ? 'calibration' : null }),
    study({ studyId: 'new', reviewSet: null }),
    study({ studyId: 'retired' }),
  ];
  state.documents.records = ['s1', 'cal', 'new'].map(doc);
  const callbacks = {
    onSplitReviewSets: jest.fn(),
    onSaveReviewSetEmails: jest.fn(),
    onAssignStudyReviewSet: jest.fn(),
    onConfirmResplit: jest.fn(),
    onCancelResplit: jest.fn(),
    onReloadReviewSets: jest.fn(),
  };
  const ctx = { home: callbacks as unknown as HomeViewCallbacks } as ViewContext;
  return { state, callbacks, ctx, render: () => renderReviewSetsCard(state, ctx) };
}

test('未使用なら本数入力と分割ボタンを表示する', () => {
  const f = fixture();
  const view = f.render();
  expect(view.id).toBe('home-review-sets');
  expect(view.textContent).toContain('担当セット');
  const calibration = view.querySelector('#review-sets-calibration') as HTMLInputElement;
  const groups = view.querySelector('#review-sets-groups') as HTMLInputElement;
  expect(calibration.min).toBe('0');
  expect(calibration.value).toBe('0');
  expect(groups.min).toBe('1');
  expect(groups.value).toBe('1');
  calibration.value = '1';
  groups.value = '2';
  view.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
  expect(f.callbacks.onSplitReviewSets).toHaveBeenCalledWith({
    calibrationCount: 1,
    groupCount: 2,
  });
  expect(view.querySelector('#review-sets-list')).toBeNull();
});
test('参照されていない study しか無ければ案内だけを出す', () => {
  const f = fixture();
  f.state.documents.records = [];
  const view = f.render();
  expect(view.querySelector('#review-sets-empty')?.textContent).toContain('文献を取り込んで');
  expect(view.querySelector('form')).toBeNull();
});
test('使用中は seed・数値順の表・全員・二人でない注記・未割当を出す', () => {
  const f = fixture(true);
  const view = f.render();
  expect(view.querySelector('#review-sets-seed')?.textContent).toBe('乱数種: 42');
  expect(
    [...view.querySelectorAll('#review-sets-list tbody th')].map((node) => node.textContent),
  ).toEqual(['calibration', 'group-1', 'group-10']);
  expect(view.querySelector('#review-sets-list tbody tr')?.textContent).toContain('全員');
  expect(view.querySelectorAll('.review-sets__pair-note')).toHaveLength(1);
  expect(view.querySelector('.review-sets__emails')?.getAttribute('aria-label')).toBe(
    'group-1 の担当者の email',
  );
  expect(view.querySelectorAll('.review-sets__assign')).toHaveLength(1);
  expect(view.querySelector('#review-sets-resplit')).not.toBeNull();
  const email = view.querySelector('.review-sets__emails') as HTMLInputElement;
  email.value = ' x@example.com , y@example.com';
  (view.querySelector('.review-sets__save') as HTMLButtonElement).click();
  expect(f.callbacks.onSaveReviewSetEmails).toHaveBeenCalledWith('group-1', [
    ' x@example.com ',
    ' y@example.com',
  ]);
  email.value = ' ';
  (view.querySelector('.review-sets__save') as HTMLButtonElement).click();
  expect(f.callbacks.onSaveReviewSetEmails).toHaveBeenLastCalledWith('group-1', []);
  const select = view.querySelector('.review-sets__assign') as HTMLSelectElement;
  select.value = 'calibration';
  select.dispatchEvent(new Event('change'));
  expect(f.callbacks.onAssignStudyReviewSet).toHaveBeenCalledWith('new', 'calibration');
  select.value = '';
  select.dispatchEvent(new Event('change'));
  expect(f.callbacks.onAssignStudyReviewSet).toHaveBeenLastCalledWith('new', null);
});
test('seed が無い・未割当が無いセットも崩れない', () => {
  const f = fixture(true);
  f.state.reviewSets.sets = [reviewSet({ setId: 'calibration', seed: null })];
  f.state.documents.studies = [study({ reviewSet: 'calibration' })];
  const view = f.render();
  expect(view.querySelector('#review-sets-seed')?.textContent).toBe('乱数種: —');
  expect(view.querySelector('#review-sets-unassigned')).toBeNull();
  expect((view.querySelector('#review-sets-groups') as HTMLInputElement).value).toBe('1');
});
test.each(['setsLoading', 'documentsLoading', 'setsNull', 'studiesNull', 'recordsNull'] as const)(
  'ロード待ち %s はフォームを出さない',
  (mode) => {
    const f = fixture();
    if (mode === 'setsLoading') f.state.reviewSets.loading = true;
    if (mode === 'documentsLoading') f.state.documents.loading = true;
    if (mode === 'setsNull') f.state.reviewSets.sets = null;
    if (mode === 'studiesNull') f.state.documents.studies = null;
    if (mode === 'recordsNull') f.state.documents.records = null;
    expect(f.render().querySelector('#review-sets-loading')).not.toBeNull();
    expect(f.render().querySelector('form')).toBeNull();
  },
);
test.each(['load', 'documents', 'save'] as const)('エラー %s は alert と再試行を出す', (mode) => {
  const f = fixture(true);
  if (mode === 'load') f.state.reviewSets.error = '読込失敗';
  if (mode === 'documents') f.state.documents.loadError = '読込失敗';
  if (mode === 'save') f.state.reviewSets.saveError = '保存失敗';
  const view = f.render();
  expect(view.querySelector('#review-sets-error')?.getAttribute('role')).toBe('alert');
  (view.querySelector('#review-sets-reload') as HTMLButtonElement).click();
  expect(f.callbacks.onReloadReviewSets).toHaveBeenCalled();
  expect(view.querySelector('#review-sets-list') !== null).toBe(mode === 'save');
});
test.each([false, true])('改ざん警告・再分割確認・保存中=%s の無効化', (saving) => {
  const f = fixture(true);
  f.state.reviewSets.ignoredCount = 2;
  f.state.reviewSets.saving = saving;
  f.state.reviewSets.confirmingResplit = { calibrationCount: 1, groupCount: 1 };
  const view = f.render();
  expect(view.querySelector('#review-sets-tampered')?.getAttribute('role')).toBe('alert');
  expect(view.textContent).toContain('2 行を無視');
  expect(view.querySelector('#review-sets-resplit-confirm')?.getAttribute('role')).toBe(
    'alertdialog',
  );
  for (const button of view.querySelectorAll('button')) expect(button.disabled).toBe(saving);
  expect((view.querySelector('.review-sets__assign') as HTMLSelectElement).disabled).toBe(saving);
  (view.querySelector('#review-sets-resplit-ok') as HTMLButtonElement).click();
  (view.querySelector('#review-sets-resplit-cancel') as HTMLButtonElement).click();
  expect(f.callbacks.onConfirmResplit).toHaveBeenCalledTimes(saving ? 0 : 1);
  expect(f.callbacks.onCancelResplit).toHaveBeenCalledTimes(saving ? 0 : 1);
});
test('空文字の未割当と保存エラー中の無効化にも対応する', () => {
  const f = fixture(true);
  f.state.documents.studies![2]!.reviewSet = '';
  f.state.reviewSets.saving = true;
  f.state.reviewSets.saveError = '保存失敗';
  const view = f.render();
  expect(view.querySelector('.review-sets__assign')).not.toBeNull();
  expect((view.querySelector('#review-sets-reload') as HTMLButtonElement).disabled).toBe(true);
});

test('再分割で退役したグループは表・割当選択肢・既定グループ数から除く', () => {
  const f = fixture(true);
  f.state.reviewSets.sets = [
    reviewSet({ seed: '2', updatedAt: 't2' }),
    reviewSet({ setId: 'calibration', seed: '2', updatedAt: 't2' }),
    reviewSet({ setId: 'group-10', seed: '1', updatedAt: 't1' }),
  ];
  const view = f.render();
  expect(
    [...view.querySelectorAll('#review-sets-list tbody th')].map((cell) => cell.textContent),
  ).toEqual(['calibration', 'group-1']);
  expect(
    [...view.querySelectorAll('.review-sets__assign option')].map(
      (option) => (option as HTMLOptionElement).value,
    ),
  ).toEqual(['', 'calibration', 'group-1']);
  expect((view.querySelector('#review-sets-groups') as HTMLInputElement).value).toBe('1');
  f.state.documents.studies = f.state.documents.studies!.map((study) =>
    study.studyId === 's1' ? { ...study, reviewSet: 'group-10' } : study,
  );
  expect(f.render().querySelector('#review-sets-list')?.textContent).toContain('group-10');
  expect((f.render().querySelector('#review-sets-groups') as HTMLInputElement).value).toBe('2');
});
