import { createModelSelect } from '../../../../src/app/ui/modelSelect';
import { buildModelCatalog, buildModelCatalogFor } from '../../../../src/lib/llm/modelCatalog';

afterEach(() => {
  document.body.replaceChildren();
});

/** 操作に使うキーイベントを送る。 */
function key(input: HTMLInputElement, value: string): void {
  input.dispatchEvent(new KeyboardEvent('keydown', { key: value, cancelable: true }));
}

function mount(value: string, onChange = jest.fn()) {
  const container = createModelSelect(document, {
    id: 'test-model', ariaLabel: 'モデル', value,
    placeholderLabel: '選択してください', onChange,
  });
  const input = container.querySelector('input')!;
  document.body.append(container);
  return { container, input, onChange };
}

test('入力欄と単価表の候補をカタログ順に生成する', () => {
  const { container, input } = mount('');
  expect(container.className).toBe('model-select');
  expect(input.id).toBe('test-model');
  expect(input.type).toBe('text');
  expect(input.getAttribute('aria-label')).toBe('モデル');
  expect(input.autocomplete).toBe('off');
  expect(input.placeholder).toBe('選択してください');
  expect(input.getAttribute('aria-controls')).toBe('test-model-listbox');
  const list = container.querySelector('[role="listbox"]')!;
  expect(list.id).toBe('test-model-listbox');
  expect([...list.querySelectorAll<HTMLElement>('[role="option"]')].map((option) => option.dataset.value))
    .toEqual(buildModelCatalog().flatMap((group) => group.models));
  expect([...list.querySelectorAll('[role="presentation"]')].every((row) => row.textContent === '単価表')).toBe(true);
});

test('現在値でも全候補を開き、入力後だけ部分一致で絞り、0 件も表示する', () => {
  const { container, input, onChange } = mount('gemini-3.8-flash');
  const scroll = jest.fn();
  HTMLElement.prototype.scrollIntoView = scroll;
  input.focus();
  input.click();
  const list = container.querySelector<HTMLElement>('[role="listbox"]')!;
  expect(list.hidden).toBe(false);
  expect(list.querySelectorAll('[role="option"]').length)
    .toBe(buildModelCatalog().flatMap((group) => group.models).length);
  expect(list.querySelector('[aria-selected="true"]')!.textContent).toBe('✓gemini-3.8-flash');
  expect(scroll).toHaveBeenCalledWith({ block: 'nearest' });
  input.value = 'GEMINI';
  input.dispatchEvent(new Event('input'));
  expect([...list.querySelectorAll<HTMLElement>('[role="option"]')]
    .every((row) => row.dataset.value!.includes('gemini'))).toBe(true);
  input.value = 'no-such-model';
  input.dispatchEvent(new Event('input'));
  expect(list.textContent).toBe('候補なし（この名前のまま使えます）');
  key(input, 'ArrowDown');
  key(input, 'Enter');
  input.dispatchEvent(new Event('change'));
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledWith('no-such-model');
  delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
});

test('フォーカスだけでは開かない（作り直し後のフォーカス復元でリストが開き直さない）', () => {
  const { container, input } = mount('gemini-3.8-flash');
  const list = container.querySelector<HTMLElement>('[role="listbox"]')!;
  input.focus();
  expect(document.activeElement).toBe(input);
  expect(list.hidden).toBe(true);
  expect(input.getAttribute('aria-expanded')).toBe('false');
});

test('矢印で移動して Enter で選び、Escape と外のクリックで閉じる', () => {
  const { container, input, onChange } = mount('');
  const list = container.querySelector<HTMLElement>('[role="listbox"]')!;
  key(input, 'ArrowDown');
  key(input, 'ArrowDown');
  key(input, 'ArrowDown');
  key(input, 'ArrowUp');
  const first = list.querySelector<HTMLElement>('[role="option"]')!;
  expect(input.getAttribute('aria-activedescendant')).toBe(first.id);
  key(input, 'Enter');
  expect(input.value).toBe(first.dataset.value);
  input.dispatchEvent(new Event('change'));
  expect(onChange).toHaveBeenCalledTimes(1);
  key(input, 'ArrowUp');
  key(input, 'Escape');
  expect(list.hidden).toBe(true);
  expect(input.value).toBe(first.dataset.value);
  input.click();
  document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  expect(list.hidden).toBe(true);
  key(input, 'a');
  expect(onChange).toHaveBeenCalledTimes(1);
});

test('クリック選択はフォーカスを保ち、同期的に取り外されても 1 回だけ通知する', async () => {
  const { container, input, onChange } = mount('');
  onChange.mockImplementation(() => container.remove());
  input.focus();
  input.click();
  const row = container.querySelector<HTMLElement>('[role="option"]')!;
  const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
  row.dispatchEvent(down);
  expect(down.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(input);
  row.click();
  input.dispatchEvent(new Event('change'));
  await Promise.resolve();
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(container.isConnected).toBe(false);
});

test('開閉ボタンと DOM 取り外しで外部 listener を解放する', async () => {
  const remove = jest.spyOn(document, 'removeEventListener');
  const { container, input } = mount('');
  const button = container.querySelector('button')!;
  const list = container.querySelector<HTMLElement>('[role="listbox"]')!;
  const down = new MouseEvent('mousedown', { cancelable: true });
  button.dispatchEvent(down);
  expect(down.defaultPrevented).toBe(true);
  button.click();
  expect(list.hidden).toBe(false);
  // 接続を保ったままの DOM 更新では閉じない。
  container.append(document.createElement('span'));
  await Promise.resolve();
  expect(list.hidden).toBe(false);
  button.click();
  expect(list.hidden).toBe(true);
  button.click();
  container.remove();
  await Promise.resolve();
  expect(list.hidden).toBe(true);
  expect(input.getAttribute('aria-expanded')).toBe('false');
  expect(remove).toHaveBeenCalledWith('mousedown', expect.any(Function));
  remove.mockRestore();
});

test.each(['', 'gemini-2.5-pro', 'gemini-test', '  private-model  '])('現在値 %s をそのまま復元する', (value) => {
  expect(mount(value).input.value).toBe(value);
});

test('指定候補の順序と取得区分を保持し、追加クラスを設定する', () => {
  const groups = buildModelCatalogFor('gemini', ['custom-model']);
  const container = createModelSelect(document, {
    id: 'test-model', ariaLabel: 'モデル', value: 'custom-model',
    placeholderLabel: '未設定', onChange: jest.fn(), className: 'extra', groups,
  });
  expect(container.className).toBe('model-select extra');
  const options = [...container.querySelectorAll<HTMLElement>('[role="option"]')];
  expect(options.map((option) => option.dataset.value)).toEqual(groups.flatMap((group) => group.models));
  const headings = container.querySelectorAll('[role="presentation"]');
  expect(headings[headings.length - 1]!.textContent).toBe('取得したモデル');
  expect(headings[0]!.textContent).toBe('単価表');
});

test('取得グループの単価表同名モデルも取得区分にする', () => {
  const container = createModelSelect(document, {
    id: 'test-model', ariaLabel: 'モデル', value: 'gemini-3.8-flash',
    placeholderLabel: '未設定', onChange: jest.fn(),
    groups: buildModelCatalogFor('openai_compatible', ['gemini-3.8-flash']),
  });
  expect(container.querySelector('input')!.value).toBe('gemini-3.8-flash');
  expect(container.querySelector('[role="presentation"]')!.textContent).toBe('取得したモデル');
});

test.each([' gemini-2.0-flash ', ' org/custom-model ', '   '])('change だけで trim 値を通知する: %s', (value) => {
  const { input, onChange } = mount('');
  input.value = value;
  input.dispatchEvent(new Event('input'));
  expect(onChange).not.toHaveBeenCalled();
  input.dispatchEvent(new Event('change'));
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledWith(value.trim());
});
