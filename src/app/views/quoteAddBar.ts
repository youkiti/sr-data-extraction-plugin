// PDF で選んだ文の追加バー。検証と裁定で入力規則と DOM を共有する。
import type { CellQuote } from '../../domain/quoteSet';
import type { SchemaField } from '../../domain/schemaField';
import { isMultiSelectField, splitPipeList } from '../../domain/multiSelect';
import { normalizeText } from '../../features/anchoring/normalizeText';
import { entityKeyLabel } from '../../features/verification/cells';
import { t } from '../../lib/i18n';
import { el } from '../ui/dom';

interface QuoteAddTarget { cellKey: string; field: SchemaField; entityKey: string }

/** 引用を追加できない理由を返す。 */
export function quoteAddReason(input: {
  target: QuoteAddTarget | undefined; busy: boolean; text: string; documentId: string | null;
  quotes: readonly CellQuote[]; theme: string;
}): string | null {
  if (input.target === undefined) return t('verify.quoteAddNoTarget');
  if (input.busy) return t('verify.quoteAddBusy');
  if (input.text.length > 1000) return t('verify.quoteAddTooLong');
  if (input.quotes.some((quote) => quote.documentId === input.documentId &&
      normalizeText(quote.quote) === normalizeText(input.text))) return t('verify.quoteAddDuplicate');
  if (isMultiSelectField(input.target.field) && input.theme === '') return t('verify.quoteAddChooseOption');
  return null;
}

/** PDF で選んだ文の追加先と入力欄を描画する。 */
export function createQuoteAddBar(input: {
  prefix: 'verify' | 'adjudicate'; target: QuoteAddTarget | undefined; section: string;
  onTheme(value: string): void; onSection(value: string): void;
  onConfirm(): void; onCancel(): void;
}): HTMLElement {
  const { prefix, target: cell } = input;
  const children: HTMLElement[] = [
    el('span', { className: prefix + '__quote-add-text' }),
    el('span', { text: cell === undefined ? t('verify.quoteAddNoTarget') : t('verify.quoteAddTarget', {
      label: cell.field.fieldLabel + (cell.entityKey === '-' ? '' : ' (' + entityKeyLabel(cell.entityKey) + ')'),
    }) }),
  ];
  if (cell !== undefined && isMultiSelectField(cell.field)) {
    const theme = el('select', { className: prefix + '__quote-add-theme',
      attributes: { 'aria-label': t('verify.quoteAddChooseOption') } }, [
      el('option', { text: t('verify.quoteAddChooseOption'), attributes: { value: '' } }),
      ...splitPipeList(cell.field.allowedValues).map((value) => el('option', { text: value, attributes: { value } })),
    ]);
    theme.addEventListener('change', () => input.onTheme(theme.value));
    children.push(theme);
  } else if (cell !== undefined && cell.field.maxQuotes !== null) {
    const theme = el('input', { className: prefix + '__quote-add-theme',
      attributes: { type: 'text', 'aria-label': t('verify.quoteAddTheme'), placeholder: t('verify.quoteAddTheme') } });
    theme.addEventListener('input', () => input.onTheme(theme.value));
    children.push(theme);
  }
  const section = el('input', { className: prefix + '__quote-add-section',
    attributes: { type: 'text', 'aria-label': t('verify.quoteAddSection'), placeholder: t('verify.quoteAddSection') } });
  section.value = input.section;
  section.addEventListener('input', () => input.onSection(section.value));
  const confirm = el('button', { className: prefix + '__quote-add-confirm', text: t('verify.quoteAddConfirm'),
    attributes: { type: 'button' } });
  confirm.addEventListener('click', input.onConfirm);
  const cancel = el('button', { className: prefix + '__quote-add-cancel', text: t('verify.quoteAddCancel'),
    attributes: { type: 'button' } });
  cancel.addEventListener('click', input.onCancel);
  children.push(section, confirm, cancel, el('p', { className: prefix + '__quote-add-note' }));
  return el('div', { className: prefix + '__quote-add',
    attributes: { role: 'group', 'aria-label': t('verify.quoteAddAria') } }, children);
}

/** 選択した文と追加可否を表示へ反映する。 */
export function updateQuoteAddBar(host: HTMLElement, prefix: 'verify' | 'adjudicate',
  text: string, reason: string | null): void {
  host.querySelector('.' + prefix + '__quote-add-text')!.textContent =
    text.slice(0, 80) + (text.length > 80 ? '…' : '');
  host.querySelector<HTMLButtonElement>('.' + prefix + '__quote-add-confirm')!.disabled = reason !== null;
  host.querySelector('.' + prefix + '__quote-add-note')!.textContent = reason ?? '';
}
