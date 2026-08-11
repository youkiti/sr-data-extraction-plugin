// enum 項目の値入力 UI（issue #254）。判定画面 / 裁定画面から共有する描画・操作のテスト。
// 判定規則そのもの（許容値のパース・許容値外判定・候補の絞り込み）は
// tests/unit/features/verification/enumOptions.test.ts が担う
import {
  allowedValuesWarningText,
  renderAllowedValuesBadge,
  renderAllowedValuesNote,
  renderEnumChoiceEditor,
  resetEnumDatalistSeq,
  type EnumChoiceEditorOptions,
} from '../../../../src/app/views/enumChoiceEditor';
import { NOT_REPORTED_TOKEN } from '../../../../src/domain/annotation';
import type { SchemaField } from '../../../../src/domain/schemaField';

function makeField(overrides: Partial<SchemaField> = {}): SchemaField {
  return {
    schemaVersion: 1,
    fieldId: 'f-rob',
    fieldIndex: 1,
    section: 'risk_of_bias',
    fieldName: 'rob_d1_judgement',
    fieldLabel: 'D1 判定',
    entityLevel: 'rob_domain',
    dataType: 'enum',
    unit: null,
    allowedValues: 'low|some_concerns|high',
    required: true,
    extractionInstruction: 'ドメイン 1 の判定',
    example: null,
    aiGenerated: false,
    note: null,
    ...overrides,
  };
}

function makeOptions(overrides: Partial<EnumChoiceEditorOptions> = {}): EnumChoiceEditorOptions {
  return {
    field: makeField(),
    currentValue: null,
    candidates: [],
    ariaLabel: 'D1 判定 の値',
    confirmLabel: '修正して確定',
    onConfirm: jest.fn(),
    onCancel: jest.fn(),
    ...overrides,
  };
}

function render(overrides: Partial<EnumChoiceEditorOptions> = {}): HTMLElement {
  const node = renderEnumChoiceEditor(makeOptions(overrides)) as HTMLElement;
  document.body.replaceChildren(node);
  return node;
}

function chipValues(root: HTMLElement): string[] {
  return [...root.querySelectorAll('.verify__enum-chip')].map((chip) => chip.textContent ?? '');
}

beforeEach(() => {
  resetEnumDatalistSeq();
});

afterEach(() => {
  document.body.replaceChildren();
});

describe('renderEnumChoiceEditor: 対象外の項目', () => {
  test('enum 以外は null を返す（呼び出し側が従来の自由入力へフォールバックする）', () => {
    expect(renderEnumChoiceEditor(makeOptions({ field: makeField({ dataType: 'text' }) }))).toBeNull();
  });

  test('許容値が取れない enum も null', () => {
    expect(
      renderEnumChoiceEditor(makeOptions({ field: makeField({ allowedValues: null }) })),
    ).toBeNull();
  });
});

describe('renderEnumChoiceEditor: チップ列', () => {
  test('許容値ぶんのチップ + 「その他（自由入力）」を出す', () => {
    const root = render();
    const values = chipValues(root);
    expect(values).toHaveLength(4);
    expect(values[0]).toContain('low');
    expect(values[3]).toContain('その他');
    expect(root.querySelector('.verify__enum-chip--other')).not.toBeNull();
  });

  test('既定選択を置かない（automation bias 対策。aria-pressed / aria-current を付けない）', () => {
    const root = render({ currentValue: 'low' });
    for (const chip of root.querySelectorAll('.verify__enum-chip')) {
      expect(chip.getAttribute('aria-pressed')).toBeNull();
      expect(chip.getAttribute('aria-current')).toBeNull();
    }
  });

  test('チップ列は role=group + 項目ラベル入りの aria-label を持つ', () => {
    const group = render().querySelector('.verify__enum-choices') as HTMLElement;
    expect(group.getAttribute('role')).toBe('group');
    expect(group.getAttribute('aria-label')).toContain('D1 判定');
  });

  test('チップのクリックでその値を確定する', () => {
    const onConfirm = jest.fn();
    const root = render({ onConfirm });
    (root.querySelectorAll('.verify__enum-chip')[1] as HTMLButtonElement).click();
    expect(onConfirm).toHaveBeenCalledWith('some_concerns');
  });

  test('数字キーで N 番目の許容値を確定する', () => {
    const onConfirm = jest.fn();
    const group = render({ onConfirm }).querySelector('.verify__enum-choices') as HTMLElement;
    group.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true }));
    expect(onConfirm).toHaveBeenCalledWith('high');
  });

  test('許容値の数を超える数字キー・数字以外のキーは無視する', () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    const group = render({ onConfirm, onCancel }).querySelector('.verify__enum-choices') as HTMLElement;
    group.dispatchEvent(new KeyboardEvent('keydown', { key: '4', bubbles: true }));
    group.dispatchEvent(new KeyboardEvent('keydown', { key: '0', bubbles: true }));
    group.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  test('修飾キー併用（Ctrl+1 等）は判定に使わない', () => {
    const onConfirm = jest.fn();
    const group = render({ onConfirm }).querySelector('.verify__enum-choices') as HTMLElement;
    group.dispatchEvent(new KeyboardEvent('keydown', { key: '1', ctrlKey: true, bubbles: true }));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  test('Escape でキャンセルする', () => {
    const onCancel = jest.fn();
    const group = render({ onCancel }).querySelector('.verify__enum-choices') as HTMLElement;
    group.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onCancel).toHaveBeenCalled();
  });

  test('キャンセルボタンでキャンセルする', () => {
    const onCancel = jest.fn();
    const root = render({ onCancel });
    (root.querySelector('.verify__edit-cancel') as HTMLButtonElement).click();
    expect(onCancel).toHaveBeenCalled();
  });

  test('onCancel を渡さない呼び出し（S12 裁定）ではキャンセルボタンを出さず Escape も無害', () => {
    const node = renderEnumChoiceEditor({ ...makeOptions(), onCancel: undefined }) as HTMLElement;
    expect(node.querySelector('.verify__edit-cancel')).toBeNull();
    const group = node.querySelector('.verify__enum-choices') as HTMLElement;
    expect(() =>
      group.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    ).not.toThrow();
  });
});

describe('renderEnumChoiceEditor: 「その他（自由入力）」', () => {
  test('「その他」を押すと自由入力へ切り替わり、候補が datalist に載る', () => {
    const root = render({ candidates: ['low risk'] });
    (root.querySelector('.verify__enum-chip--other') as HTMLButtonElement).click();
    const input = root.querySelector('.verify__edit-input') as HTMLInputElement;
    expect(input).not.toBeNull();
    const listId = input.getAttribute('list') as string;
    const options = [...(root.querySelector(`#${listId}`) as HTMLElement).querySelectorAll('option')];
    expect(options.map((option) => option.value)).toEqual(['low risk']);
  });

  test('候補が 0 件なら datalist を作らない', () => {
    const root = render();
    (root.querySelector('.verify__enum-chip--other') as HTMLButtonElement).click();
    expect(root.querySelector('datalist')).toBeNull();
    expect((root.querySelector('.verify__edit-input') as HTMLInputElement).getAttribute('list')).toBeNull();
  });

  test('datalist の id はモジュール内連番（同一 field_id が複数展開されても衝突しない）', () => {
    const first = render({ candidates: ['low risk'] });
    (first.querySelector('.verify__enum-chip--other') as HTMLButtonElement).click();
    const second = renderEnumChoiceEditor(makeOptions({ candidates: ['low risk'] })) as HTMLElement;
    (second.querySelector('.verify__enum-chip--other') as HTMLButtonElement).click();
    const idOf = (root: HTMLElement): string =>
      (root.querySelector('.verify__edit-input') as HTMLInputElement).getAttribute('list') as string;
    expect(idOf(first)).not.toBe(idOf(second));
  });

  test('確定ボタン・Enter で入力値を確定する', () => {
    const onConfirm = jest.fn();
    const root = render({ onConfirm });
    (root.querySelector('.verify__enum-chip--other') as HTMLButtonElement).click();
    const input = root.querySelector('.verify__edit-input') as HTMLInputElement;
    input.value = '自由入力の値';
    (root.querySelector('.verify__edit-confirm') as HTMLButtonElement).click();
    expect(onConfirm).toHaveBeenCalledWith('自由入力の値');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onConfirm).toHaveBeenCalledTimes(2);
  });

  test('自由入力欄の Escape でキャンセルする', () => {
    const onCancel = jest.fn();
    const root = render({ onCancel });
    (root.querySelector('.verify__enum-chip--other') as HTMLButtonElement).click();
    const input = root.querySelector('.verify__edit-input') as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onCancel).toHaveBeenCalled();
  });

  test('自由入力欄では Enter / Escape 以外のキーは素通しする（通常の文字入力を妨げない）', () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    const root = render({ onConfirm, onCancel });
    (root.querySelector('.verify__enum-chip--other') as HTMLButtonElement).click();
    const input = root.querySelector('.verify__edit-input') as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  test('onCancel なしの自由入力欄では Escape が無害', () => {
    const node = renderEnumChoiceEditor({ ...makeOptions(), onCancel: undefined }) as HTMLElement;
    (node.querySelector('.verify__enum-chip--other') as HTMLButtonElement).click();
    const input = node.querySelector('.verify__edit-input') as HTMLInputElement;
    expect(() =>
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    ).not.toThrow();
  });

  test('「選択肢に戻る」でチップ列へ戻る', () => {
    const root = render();
    (root.querySelector('.verify__enum-chip--other') as HTMLButtonElement).click();
    (root.querySelector('.verify__enum-back') as HTMLButtonElement).click();
    expect(root.querySelector('.verify__enum-choices')).not.toBeNull();
    expect(root.querySelector('.verify__edit-input')).toBeNull();
  });
});

describe('renderEnumChoiceEditor: 初期モード', () => {
  test('現在値が許容値外なら自由入力側を開いた状態で既存値を保持する', () => {
    const root = render({ currentValue: 'low risk' });
    expect(root.querySelector('.verify__enum-choices')).toBeNull();
    expect((root.querySelector('.verify__edit-input') as HTMLInputElement).value).toBe('low risk');
    // チップ列へ戻れる（許容値の数はチップ上限内のため）
    expect(root.querySelector('.verify__enum-back')).not.toBeNull();
  });

  test('現在値が許容値内ならチップ列から始まる', () => {
    const root = render({ currentValue: 'high' });
    expect(root.querySelector('.verify__enum-choices')).not.toBeNull();
  });

  test('許容値がチップ上限を超えると datalist 付き入力へフォールバックし、戻る導線は出さない', () => {
    const allowedValues = Array.from({ length: 10 }, (_, i) => `v${i + 1}`).join('|');
    const root = render({ field: makeField({ allowedValues }), candidates: ['v1', 'その他の値'] });
    expect(root.querySelector('.verify__enum-choices')).toBeNull();
    expect(root.querySelector('.verify__enum-back')).toBeNull();
    const input = root.querySelector('.verify__edit-input') as HTMLInputElement;
    const listId = input.getAttribute('list') as string;
    const options = [
      ...(root.querySelector(`#${listId}`) as HTMLElement).querySelectorAll('option'),
    ].map((option) => option.value);
    // 許容値 10 件 + 重複しない候補 1 件（'v1' は許容値と重複するため 1 度だけ）
    expect(options).toHaveLength(11);
    expect(options[10]).toBe('その他の値');
  });
});

describe('許容値外の警告', () => {
  test('allowedValuesWarningText: 許容値外の値には値と選択肢を含む文言を返す', () => {
    const message = allowedValuesWarningText(makeField(), 'low risk') as string;
    expect(message).toContain('low risk');
    expect(message).toContain('low / some_concerns / high');
  });

  test('allowedValuesWarningText: 許容値内・未入力・未報告トークンは null', () => {
    expect(allowedValuesWarningText(makeField(), 'low')).toBeNull();
    expect(allowedValuesWarningText(makeField(), null)).toBeNull();
    expect(allowedValuesWarningText(makeField(), NOT_REPORTED_TOKEN)).toBeNull();
  });

  test('形態 A: role=note の警告 + owner には `#/schema` 導線を出す', () => {
    const note = renderAllowedValuesNote(makeField(), 'low risk', true) as HTMLElement;
    expect(note.getAttribute('role')).toBe('note');
    expect(note.querySelector('.verify__enum-out-of-range-text')?.textContent).toContain('low risk');
    expect(note.querySelector('a')?.getAttribute('href')).toBe('#/schema');
  });

  test('形態 A: 非 owner にはリンクを出さない（guards.ts で弾かれる死んだリンクにしない）', () => {
    const note = renderAllowedValuesNote(makeField(), 'low risk', false) as HTMLElement;
    expect(note.querySelector('a')).toBeNull();
  });

  test('形態 A: 許容値内なら描画しない', () => {
    expect(renderAllowedValuesNote(makeField(), 'low', true)).toBeNull();
  });

  test('形態 B: aria-hidden のバッジ（読み上げは親ボタンの aria-label に委ねる）', () => {
    const badge = renderAllowedValuesBadge();
    expect(badge.className).toBe('verify__enum-badge');
    expect(badge.getAttribute('aria-hidden')).toBe('true');
  });
});
