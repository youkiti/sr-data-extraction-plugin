// 複数選択 enum の値入力 UI。判定画面の verificationCellCard と裁定画面の adjudicateView から呼ぶ。
// 選択・排他・自由記述の判定規則は src/domain/multiSelect.ts を正典とし、ここでは描画と操作を担う。
import type { SchemaField } from '../../domain/schemaField';
import {
  formatMultiSelectValue, isMultiSelectField, multiSelectConfigOf, parseMultiSelectValue,
  splitPipeList, toggleMultiSelectOption,
} from '../../domain/multiSelect';
import { t } from '../../lib/i18n';
import { el } from '../ui/dom';

export interface MultiEnumChoiceEditorOptions {
  field: SchemaField;
  /** 初期値（null = 未選択から） */
  currentValue: string | null;
  confirmLabel: string;
  onConfirm(value: string): void;
  /** 省略時はキャンセルボタンを出さず Escape も何もしない */
  onCancel?: () => void;
}

export interface MultiEnumChoiceEditor {
  element: HTMLElement;
  /** 現在の選択で確定する。未選択なら何もせず false を返す */
  confirm(): boolean;
}

/** 複数選択でなければ null を返し、呼び出し側の既存エディタへ落とす。 */
export function renderMultiEnumChoiceEditor(options: MultiEnumChoiceEditorOptions): MultiEnumChoiceEditor | null {
  const { field } = options;
  const config = multiSelectConfigOf(field);
  if (config === null || !isMultiSelectField(field)) return null;
  const { exclusiveValues, freeTextValues } = config;
  const allowed = splitPipeList(field.allowedValues);
  let selected = parseMultiSelectValue(field, options.currentValue);
  // 描画し直す前に現在値を読むため、入力イベントの有無に依存しない。
  const inputs = new Map<string, HTMLInputElement>();
  const element = el('div', { className: 'verify__editor verify__editor--enum verify__editor--multi' });
  function readInputs(): void {
    selected = selected.map((item) => {
      const input = inputs.get(item.option);
      return input === undefined ? item : { ...item, text: input.value };
    });
  }
  function confirm(): boolean {
    readInputs();
    if (selected.length === 0) return false;
    options.onConfirm(formatMultiSelectValue(field, selected)!);
    return true;
  }
  function toggle(option: string): void {
    readInputs();
    selected = toggleMultiSelectOption(field, selected, option);
    render(option);
  }
  function render(focusOption?: string): void {
    inputs.clear();
    const chips = new Map<string, HTMLButtonElement>();
    const values = [...allowed, ...selected.filter((item) => !item.known).map((item) => item.option)];
    const group = el('div', {
      className: 'verify__enum-choices',
      attributes: { role: 'group', 'aria-label': t('verify.enumChooseAria', { label: field.fieldLabel }) },
    });
    values.forEach((option, index) => {
      const exclusive = exclusiveValues.includes(option);
      const known = allowed.includes(option);
      const chip = el('button', {
        className: `verify__enum-chip${exclusive ? ' verify__enum-chip--exclusive' : ''}${known ? '' : ' verify__enum-chip--unknown'}`,
        attributes: {
          type: 'button', 'aria-label': option,
          'aria-pressed': String(selected.some((item) => item.option === option)),
          ...(exclusive ? { title: t('verify.multiExclusiveTitle') } : {}),
        },
      });
      if (known && index < 9) {
        chip.append(el('span', {
          className: 'verify__enum-chip-key', attributes: { 'aria-hidden': 'true' }, text: String(index + 1),
        }));
      }
      chip.append(el('span', { className: 'verify__enum-chip-value', text: option }));
      chip.addEventListener('click', () => toggle(option));
      chips.set(option, chip);
      group.append(chip);
    });
    group.addEventListener('keydown', (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        confirm();
      } else if (event.key === 'Escape') {
        options.onCancel?.();
      } else if (/^[1-9]$/.test(event.key)) {
        const option = allowed[Number(event.key) - 1];
        if (option !== undefined) {
          event.preventDefault();
          toggle(option);
        }
      }
    });
    const children: HTMLElement[] = [group];
    for (const item of selected) {
      if (!freeTextValues.includes(item.option)) continue;
      const input = el('input', {
        className: 'verify__multi-free-text',
        attributes: { type: 'text', 'aria-label': t('verify.multiFreeTextAria', { option: item.option }) },
      });
      input.value = item.text ?? '';
      input.addEventListener('keydown', (event) => {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        if (event.key === 'Enter') {
          if (event.isComposing || event.keyCode === 229) return;
          event.preventDefault();
          confirm();
        } else if (event.key === 'Escape') {
          options.onCancel?.();
        }
      });
      inputs.set(item.option, input);
      children.push(input);
    }
    const button = el('button', {
      className: 'verify__edit-confirm', text: options.confirmLabel, attributes: { type: 'button' },
    });
    button.disabled = selected.length === 0;
    button.addEventListener('click', confirm);
    children.push(button, el('p', { className: 'verify__enum-hint', text: t('verify.multiEnumHint') }));
    if (options.onCancel !== undefined) {
      const cancel = el('button', {
        className: 'verify__edit-cancel', text: t('common.cancel'), attributes: { type: 'button' },
      });
      cancel.addEventListener('click', options.onCancel);
      children.push(cancel);
    }
    element.replaceChildren(...children);
    if (focusOption !== undefined) (chips.get(focusOption) ?? chips.get(allowed[0]!))!.focus();
  }
  render();
  return { element, confirm };
}
