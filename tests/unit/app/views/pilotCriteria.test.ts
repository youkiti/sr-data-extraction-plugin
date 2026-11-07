import { createInitialState } from '../../../../src/app/store';
import { emptyCriteriaState } from '../../../../src/app/services/acceptanceCriteriaService';
import { renderPilotCriteria } from '../../../../src/app/views/pilotCriteria';
import type { PilotViewCallbacks } from '../../../../src/app/views/types';
import { confirmCriteria, emptyCriteriaDraft, evaluateCriteria } from '../../../../src/features/verification/acceptanceCriteria';
import { registerMessages } from '../../../../src/lib/i18n';
import { jaApp } from '../../../../src/lib/i18n/ja.app';
import { enApp } from '../../../../src/lib/i18n/en.app';
registerMessages({ ja: jaApp, en: enApp });
const criteria = confirmCriteria({ ...emptyCriteriaDraft(), min_accuracy: '90', note: '事前に決定' }, [],
  'owner@example.com', '2026-11-07T00:00:00Z', []);
function callbacks(): PilotViewCallbacks {
  return { onCriteriaDraft: jest.fn(), onConfirmCriteria: jest.fn(), onCancelCriteria: jest.fn(),
    onCalculateCriteria: jest.fn(), onReloadCriteria: jest.fn() } as unknown as PilotViewCallbacks;
}

test('未設定は空入力、全レベル選択、各入力の変更と確認・取消を通知する', () => {
  const state = createInitialState();
  const ctx = callbacks();
  let view = renderPilotCriteria(state, ctx);
  expect(view.textContent).toContain('まだ確定していません');
  expect(view.querySelectorAll('input[type="checkbox"]:checked')).toHaveLength(4);
  const input = view.querySelector<HTMLInputElement>('#pilot-criteria-min_accuracy')!;
  expect(input.value).toBe('');
  input.value = '91.5';
  input.dispatchEvent(new Event('input'));
  expect(ctx.onCriteriaDraft).toHaveBeenCalledWith(expect.objectContaining({ min_accuracy: '91.5' }));
  const select = view.querySelector<HTMLSelectElement>('select')!;
  select.value = 'human_with_ai';
  select.dispatchEvent(new Event('change'));
  expect(ctx.onCriteriaDraft).toHaveBeenCalledWith(expect.objectContaining({ comparator: 'human_with_ai' }));
  const check = view.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  check.checked = false;
  check.dispatchEvent(new Event('change'));
  expect(ctx.onCriteriaDraft).toHaveBeenCalledWith(expect.objectContaining({ entity_levels: ['arm', 'outcome_result', 'rob_domain'] }));
  state.pilot.criteria = { ...emptyCriteriaState(), draft: { ...emptyCriteriaDraft(), entity_levels: [], comparator: 'human_with_ai' },
    confirming: true, pilotCount: 1 };
  view = renderPilotCriteria(state, ctx);
  const add = view.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  add.checked = true;
  add.dispatchEvent(new Event('change'));
  expect(ctx.onCriteriaDraft).toHaveBeenCalledWith(expect.objectContaining({ entity_levels: ['study'] }));
  expect(view.textContent).toContain('独立の比較ではありません');
  expect(view.textContent).toContain('パイロットの後に確定した版');
  for (const id of ['confirm', 'save', 'cancel']) {
    view.querySelector<HTMLButtonElement>(`#pilot-criteria-${id}`)!.click();
  }
  expect(ctx.onConfirmCriteria).toHaveBeenNthCalledWith(1, false);
  expect(ctx.onConfirmCriteria).toHaveBeenNthCalledWith(2, true);
  expect(ctx.onCancelCriteria).toHaveBeenCalled();
  const note = view.querySelector<HTMLTextAreaElement>('textarea')!;
  note.value = 'メモ';
  note.dispatchEvent(new Event('input'));
  expect(ctx.onCriteriaDraft).toHaveBeenCalledWith(expect.objectContaining({ note: 'メモ' }));
});

test('現行と過去版、計算・エラー・警告・読み取り専用、各結果と理由を表示する', () => {
  const state = createInitialState();
  const ctx = callbacks();
  const current = { ...criteria, version: 2, pilot_runs_before: 1, comparator: 'human_with_ai' as const, max_fabrication_rate: 3 };
  state.role.role = 'reviewer_independent';
  for (const result of ['met', 'not_met', 'not_evaluable'] as const) {
    for (const reason of ['', 'no_pilot', 'no_compared_cells', 'below_minimum'] as const) {
      state.pilot.criteria = { ...emptyCriteriaState(), versions: [criteria, current], ignoredCount: 1,
        evaluation: { ...evaluateCriteria(current, [], [], new Set()), result, not_evaluable_reason: reason,
          accuracy: 95, fabrication_rate: null } };
      const view = renderPilotCriteria(state, ctx);
      expect(view.querySelector('#pilot-criteria-result')).not.toBeNull();
      expect(view.textContent).toContain('版 2');
      expect(view.textContent).toContain('過去の版');
      expect(view.textContent).toContain('95.00%');
      expect(view.textContent).toContain('事前に決定');
      expect(view.querySelector('#pilot-criteria-confirm')).toBeNull();
      view.querySelector<HTMLButtonElement>('#pilot-criteria-calculate')!.click();
    }
  }
  expect(ctx.onCalculateCriteria).toHaveBeenCalled();
  state.pilot.criteria = { ...emptyCriteriaState(), versions: [criteria], error: 'failed', loading: true, calculating: true };
  let view = renderPilotCriteria(state, ctx);
  expect(view.querySelector('[role="alert"]')?.textContent).toBe('failed');
  expect(view.textContent).toContain('結果を計算中');
  state.pilot.criteria.loading = false;
  view = renderPilotCriteria(state, ctx);
  view.querySelector<HTMLButtonElement>('#pilot-criteria-reload')!.click();
  expect(ctx.onReloadCriteria).toHaveBeenCalled();
  state.role.role = 'owner';
  state.pilot.criteria = { ...emptyCriteriaState(), saving: true, confirming: true };
  view = renderPilotCriteria(state, ctx);
  expect(view.querySelector<HTMLFieldSetElement>('fieldset')!.disabled).toBe(true);
  expect(view.querySelector<HTMLButtonElement>('#pilot-criteria-save')!.disabled).toBe(true);
  state.pilot.criteria = { ...emptyCriteriaState(), versions: [{ ...criteria, note: '' }] };
  expect(renderPilotCriteria(state, ctx).textContent).not.toContain('事前に決定');
});

test('省略可能なコールバックがない場合も表示と操作は安全', () => {
  const state = createInitialState();
  state.pilot.criteria = { ...emptyCriteriaState(), confirming: true, versions: [criteria], error: 'failed' };
  const view = renderPilotCriteria(state, {} as PilotViewCallbacks);
  view.querySelectorAll('button').forEach((node) => node.click());
  view.querySelectorAll('input, textarea').forEach((node) => node.dispatchEvent(new Event('input')));
  view.querySelectorAll('select, input[type="checkbox"]').forEach((node) => node.dispatchEvent(new Event('change')));
});
