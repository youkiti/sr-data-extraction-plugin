import { createPilotOutcomeAdd } from '../../../../src/app/views/pilotOutcomeAdd';
import type { OutcomeListContext } from '../../../../src/features/schema/outcomeListContext';
import type { SchemaOutcome } from '../../../../src/domain/schemaOutcome';

const context: OutcomeListContext = {
  schemaVersion: 2,
  outcomes: [{ outcomeId: 'pain', outcomeLabel: '痛み' } as SchemaOutcome],
  currentIds: new Set(['pain']),
  everIds: new Set(['pain', 'removed']),
};

function setup(onAdd = jest.fn().mockResolvedValue(undefined)) {
  const form = createPilotOutcomeAdd(context, onAdd);
  const host = document.createElement('div');
  host.append(form.root);
  document.body.replaceChildren(host);
  const input = (id: string, value: string): void => {
    const element = host.querySelector<HTMLInputElement>(`#verify-outcome-${id}`)!;
    element.value = value;
    element.dispatchEvent(new Event('input'));
  };
  const button = host.querySelector<HTMLButtonElement>('#verify-outcome-add-button')!;
  return { ...form, host, input, button, onAdd };
}

test('表示名から id を作り、直接編集後は追従を止め、説明を保存する', async () => {
  const form = setup();
  form.input('label', 'Sleep quality');
  expect(form.host.querySelector<HTMLInputElement>('#verify-outcome-key')!.value).toBe('sleep_quality');
  form.input('key', 'sleep');
  form.input('label', '睡眠');
  form.input('description', '説明');
  form.button.click();
  expect(form.onAdd).toHaveBeenCalledWith(expect.objectContaining({ outcomeId: 'sleep', outcomeLabel: '睡眠', description: '説明', addedVia: 'pilot_verify' }));
  expect(form.host.querySelector('#verify-outcome-time')).toBeNull();
  await Promise.resolve();
  expect(form.button.disabled).toBe(false);
});

test('空の表示名、不正な id、現行の id を拒み、過去の id には復元の案内を出す', () => {
  const form = setup();
  form.button.click();
  expect(form.onAdd).not.toHaveBeenCalled();
  form.input('label', '追加');
  form.input('key', 'invalid-id');
  form.button.click();
  expect(form.host.querySelector('[role="alert"]')!.textContent).not.toBe('');
  form.input('key', 'pain');
  form.button.click();
  expect(form.onAdd).not.toHaveBeenCalled();
  form.input('key', 'removed');
  expect(form.host.textContent).toContain('以前の版で外したアウトカムです');
  form.button.click();
  expect(form.onAdd).toHaveBeenCalledTimes(1);
});

test.each([new Error('保存失敗'), '保存失敗'])('保存中は候補も無効にし、二重押しを防いで失敗を表示する: %s', async (reason) => {
  let reject!: (reason: unknown) => void;
  const onAdd = jest.fn(() => new Promise((_resolve, fail) => { reject = fail; }));
  const form = setup(onAdd);
  const candidate = document.createElement('button');
  candidate.className = 'verify__outcome-candidate-add';
  form.host.append(candidate);
  form.addCandidate('sleep', '睡眠');
  form.addCandidate('other', '別');
  expect(onAdd).toHaveBeenCalledTimes(1);
  expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ addedVia: 'pilot_candidate', description: null }));
  expect(candidate.disabled).toBe(true);
  reject(reason);
  await Promise.resolve();
  expect(form.host.querySelector('[role="alert"]')!.textContent).toBe('保存失敗');
  expect(candidate.disabled).toBe(false);
});

test('親要素が無いフォームでも保存できる', async () => {
  const onAdd = jest.fn().mockResolvedValue(undefined);
  const form = createPilotOutcomeAdd(context, onAdd);
  form.addCandidate('sleep', '睡眠');
  expect(onAdd).toHaveBeenCalledTimes(1);
  await Promise.resolve();
});
