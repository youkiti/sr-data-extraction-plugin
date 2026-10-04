import { renderMultiEnumChoiceEditor, type MultiEnumChoiceEditorOptions } from '../../../../src/app/views/multiEnumChoiceEditor';
import type { SchemaField } from '../../../../src/domain/schemaField';

const field: SchemaField = {
  schemaVersion: 1, fieldId: 'f', fieldIndex: 1, section: 'methods', fieldName: 'design',
  fieldLabel: 'デザイン', entityLevel: 'study', dataType: 'enum', unit: null,
  allowedValues: 'Students|Records themselves|Other|unclear', required: false,
  extractionInstruction: '', example: null, aiGenerated: false, note: null, maxQuotes: null,
  multiSelect: { exclusiveValues: ['unclear'], freeTextValues: ['Other'] },
};
function setup(overrides: Partial<MultiEnumChoiceEditorOptions> = {}) {
  const options = { field, currentValue: null, confirmLabel: '確定', onConfirm: jest.fn(), onCancel: jest.fn(), ...overrides };
  const editor = renderMultiEnumChoiceEditor(options)!;
  document.body.replaceChildren(editor.element);
  const chip = (option: string) => [...editor.element.querySelectorAll<HTMLButtonElement>('.verify__enum-chip')]
    .find((node) => node.getAttribute('aria-label') === option)!;
  const input = () => editor.element.querySelector<HTMLInputElement>('.verify__multi-free-text')!;
  return { ...editor, options, chip, input };
}
function key(node: HTMLElement, value: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...init });
  node.dispatchEvent(event);
  return event;
}

test('対象外は null、初期値 null は全件未選択で確定不可、初期描画でフォーカスを奪わない', () => {
  expect(renderMultiEnumChoiceEditor({ field: { ...field, multiSelect: null }, currentValue: null, confirmLabel: '', onConfirm: jest.fn() })).toBeNull();
  const s = setup();
  expect(document.activeElement).toBe(document.body);
  expect(s.element.className).toBe('verify__editor verify__editor--enum verify__editor--multi');
  expect(s.element.querySelector('[role="group"]')?.getAttribute('aria-label')).toContain('デザイン');
  expect(s.element.querySelectorAll('[aria-pressed="false"]')).toHaveLength(4);
  expect(s.element.querySelector<HTMLButtonElement>('.verify__edit-confirm')!.disabled).toBe(true);
  expect(s.confirm()).toBe(false);
  expect(s.options.onConfirm).not.toHaveBeenCalled();
  s.chip('Students').click();
  expect(document.activeElement).toBe(s.chip('Students'));
  expect(s.element.querySelector<HTMLButtonElement>('.verify__edit-confirm')!.disabled).toBe(false);
  s.chip('Students').click();
  expect(s.confirm()).toBe(false);
});

test('数字キーとクリックで排他制約を守り、Enter は切り替えず確定する', () => {
  const s = setup({ currentValue: 'Students|Records themselves' });
  expect(s.chip('Students').getAttribute('aria-pressed')).toBe('true');
  expect(key(s.chip('Students'), '4').defaultPrevented).toBe(true);
  expect(s.chip('Students').getAttribute('aria-pressed')).toBe('false');
  expect(s.chip('unclear').getAttribute('aria-pressed')).toBe('true');
  expect(s.chip('unclear').classList.contains('verify__enum-chip--exclusive')).toBe(true);
  expect(s.chip('unclear').title).toBe('ほかの選択肢と同時に選べません');
  s.chip('Students').click();
  expect(s.chip('unclear').getAttribute('aria-pressed')).toBe('false');
  expect(key(s.chip('Students'), 'Enter').defaultPrevented).toBe(true);
  expect(s.options.onConfirm).toHaveBeenLastCalledWith('Students');
  expect(s.chip('Students').getAttribute('aria-pressed')).toBe('true');
  for (const init of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) key(s.chip('Students'), '2', init);
  for (const value of ['0', '9', 'x', ' ']) expect(key(s.chip('Students'), value).defaultPrevented).toBe(false);
  expect(s.chip('Records themselves').getAttribute('aria-pressed')).toBe('false');
  key(s.chip('Students'), 'Escape');
  s.element.querySelector<HTMLButtonElement>('.verify__edit-cancel')!.click();
  expect(s.options.onCancel).toHaveBeenCalledTimes(2);
});

test('自由記述は初期値を表示し、再描画後も入力を保持し、数字や IME を横取りしない', () => {
  const s = setup({ currentValue: 'Other: 初期' });
  expect(s.input().value).toBe('初期');
  expect(s.input().getAttribute('aria-label')).toBe('Other の内容');
  expect(s.input().classList.contains('verify__edit-input')).toBe(false);
  s.input().value = '説明123';
  s.chip('Students').click();
  expect(s.input().value).toBe('説明123');
  expect(document.activeElement).toBe(s.chip('Students'));
  expect(key(s.input(), '2').defaultPrevented).toBe(false);
  expect(s.chip('Records themselves').getAttribute('aria-pressed')).toBe('false');
  for (const init of [{ isComposing: true }, { keyCode: 229 }, { ctrlKey: true }, { metaKey: true }, { altKey: true }]) key(s.input(), 'Enter', init);
  expect(s.options.onConfirm).not.toHaveBeenCalled();
  expect(key(s.input(), 'Enter').defaultPrevented).toBe(true);
  expect(s.options.onConfirm).toHaveBeenLastCalledWith('Students|Other: 説明123');
  key(s.input(), 'Escape');
  expect(s.options.onCancel).toHaveBeenCalledTimes(1);
  s.input().value = '変更';
  s.element.querySelector<HTMLButtonElement>('.verify__edit-confirm')!.click();
  expect(s.options.onConfirm).toHaveBeenLastCalledWith('Students|Other: 変更');
});

test('未知のチップは除去すると消え、先頭へフォーカスを戻す。キャンセル省略時は Escape が無操作', () => {
  const s = setup({ currentValue: '未知|Other', onCancel: undefined });
  expect(s.input().value).toBe('');
  expect(s.chip('未知').classList.contains('verify__enum-chip--unknown')).toBe(true);
  expect(s.chip('未知').getAttribute('aria-pressed')).toBe('true');
  s.chip('未知').click();
  expect(s.chip('未知')).toBeUndefined();
  expect(document.activeElement).toBe(s.chip('Students'));
  expect(s.element.querySelector('.verify__edit-cancel')).toBeNull();
  key(s.chip('Students'), 'Escape');
  key(s.input(), 'Escape');
  expect(s.options.onConfirm).not.toHaveBeenCalled();
  expect(s.confirm()).toBe(true);
  expect(s.options.onConfirm).toHaveBeenCalledWith('Other');
});

test('10 個以上も全てチップで表示し、数字ヒントは先頭 9 個だけ', () => {
  const s = setup({ field: { ...field, allowedValues: 'A|B|C|D|E|F|G|H|I|J' } });
  expect(s.element.querySelectorAll('.verify__enum-chip')).toHaveLength(10);
  expect(s.element.querySelectorAll('.verify__enum-chip-key')).toHaveLength(9);
  expect(s.element.querySelector('.verify__enum-chip-key')?.getAttribute('aria-hidden')).toBe('true');
  expect(s.element.querySelector('datalist')).toBeNull();
  s.chip('J').click();
  key(s.chip('J'), '9');
  s.confirm();
  expect(s.options.onConfirm).toHaveBeenCalledWith('I|J');
});
