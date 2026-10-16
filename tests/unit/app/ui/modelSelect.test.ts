import { createModelSelect } from '../../../../src/app/ui/modelSelect';
import { buildModelCatalog, buildModelCatalogFor } from '../../../../src/lib/llm/modelCatalog';

function mount(value: string, onChange = jest.fn()) {
  const container = createModelSelect(document, {
    id: 'test-model', ariaLabel: 'モデル', value,
    placeholderLabel: '選択してください', onChange,
  });
  const input = container.querySelector('input')!;
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
  expect(input.getAttribute('list')).toBe('test-model-options');
  const list = container.querySelector('datalist')!;
  expect(list.id).toBe('test-model-options');
  expect([...list.options].map((option) => option.value))
    .toEqual(buildModelCatalog().flatMap((group) => group.models));
  expect([...list.options].every((option) => option.label === '単価表')).toBe(true);
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
  const options = [...container.querySelectorAll('option')];
  expect(options.map((option) => option.value)).toEqual(groups.flatMap((group) => group.models));
  expect(options.at(-1)!.label).toBe('取得したモデル');
  expect(options[0]!.label).toBe('単価表');
});

test('取得グループの単価表同名モデルも取得区分にする', () => {
  const container = createModelSelect(document, {
    id: 'test-model', ariaLabel: 'モデル', value: 'gemini-3.8-flash',
    placeholderLabel: '未設定', onChange: jest.fn(),
    groups: buildModelCatalogFor('openai_compatible', ['gemini-3.8-flash']),
  });
  expect(container.querySelector('input')!.value).toBe('gemini-3.8-flash');
  expect(container.querySelector('option')!.label).toBe('取得したモデル');
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
