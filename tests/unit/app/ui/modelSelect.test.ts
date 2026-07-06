// モデルセレクタ共有ウィジェットの単体テスト（docs/ui-states.md §2「モデルセレクタ」）
import {
  createModelSelect,
  MODEL_SELECT_OTHER_VALUE,
} from '../../../../src/app/ui/modelSelect';
import { MODEL_PRICING } from '../../../../src/lib/llm/pricing';

function mount(value: string, onChange: (model: string) => void = () => {}) {
  const container = createModelSelect(document, {
    id: 'test-model',
    ariaLabel: 'モデル名（requested_model）',
    value,
    placeholderLabel: '選択してください',
    onChange,
  });
  document.body.append(container);
  const select = container.querySelector('#test-model') as HTMLSelectElement;
  const custom = container.querySelector('#test-model-custom') as HTMLInputElement;
  return { container, select, custom };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('createModelSelect の構造', () => {
  test('プレースホルダ + Gemini / OpenRouter optgroup + その他 option を持つ', () => {
    const { select, custom } = mount('');
    expect(select.getAttribute('aria-label')).toBe('モデル名（requested_model）');
    expect(custom.getAttribute('aria-label')).toBe('モデル名（requested_model）（直接入力）');

    const first = select.options[0]!;
    expect(first.value).toBe('');
    expect(first.textContent).toBe('選択してください');

    const groups = [...select.querySelectorAll('optgroup')];
    expect(groups.map((g) => g.label)).toEqual(['Gemini', 'OpenRouter']);
    const optionValues = [...select.options].map((o) => o.value);
    for (const model of Object.keys(MODEL_PRICING)) {
      expect(optionValues).toContain(model);
    }
    expect(optionValues[optionValues.length - 1]).toBe(MODEL_SELECT_OTHER_VALUE);
  });
});

describe('state の値からの決定的な復元', () => {
  test("'' はプレースホルダ選択 + テキスト非表示", () => {
    const { select, custom } = mount('');
    expect(select.value).toBe('');
    expect(custom.hidden).toBe(true);
  });

  test('単価表のモデルは該当 option 選択 + テキスト非表示', () => {
    const { select, custom } = mount('gemini-2.5-pro');
    expect(select.value).toBe('gemini-2.5-pro');
    expect(custom.hidden).toBe(true);
  });

  test('単価表にないモデルは「その他」選択 + テキスト表示・値充填', () => {
    const { select, custom } = mount('gemini-test');
    expect(select.value).toBe(MODEL_SELECT_OTHER_VALUE);
    expect(custom.hidden).toBe(false);
    expect(custom.value).toBe('gemini-test');
  });
});

describe('イベント通知（sentinel は state へ漏らさない）', () => {
  test('カタログ option の選択でモデル ID を通知し、テキストを隠す', () => {
    const onChange = jest.fn();
    const { select, custom } = mount('gemini-test', onChange);
    select.value = 'gemini-2.0-flash';
    select.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith('gemini-2.0-flash');
    expect(custom.hidden).toBe(true);
  });

  test("プレースホルダの選択で '' を通知する", () => {
    const onChange = jest.fn();
    const { select } = mount('gemini-2.5-pro', onChange);
    select.value = '';
    select.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith('');
  });

  test('「その他」の選択でテキストを表示・フォーカスし、確定までは通知しない', () => {
    const onChange = jest.fn();
    const { select, custom } = mount('gemini-2.5-pro', onChange);
    select.value = MODEL_SELECT_OTHER_VALUE;
    select.dispatchEvent(new Event('change'));
    expect(custom.hidden).toBe(false);
    expect(document.activeElement).toBe(custom);
    // ここで通知すると store 再描画で選択が state 値へ戻るため、テキスト確定まで通知しない
    expect(onChange).not.toHaveBeenCalled();
  });

  test('テキストの change で trim した値を通知する', () => {
    const onChange = jest.fn();
    const { custom } = mount('gemini-test', onChange);
    custom.value = '  org/custom-model  ';
    custom.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith('org/custom-model');
  });
});
