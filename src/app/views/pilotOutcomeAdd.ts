import type { OutcomeListContext } from '../../features/schema/outcomeListContext';
import { isValidOutcomeId, slugifyOutcomeLabel, suggestOutcomeId, validateOutcomeRows } from '../../features/schema/schemaOutcomes';
import type { SchemaOutcomeEditorRow } from '../../features/schema/types';
import { t } from '../../lib/i18n';
import { el } from '../ui/dom';

/** パイロットの一覧への追加を、フォームと候補で共有する。 */
export function createPilotOutcomeAdd(context: OutcomeListContext, onAdd: (row: SchemaOutcomeEditorRow) => Promise<void>): {
  root: HTMLElement;
  addCandidate(id: string, label: string): void;
} {
  const root = el('section', { id: 'verify-outcome-add', className: 'verify__outcome-add' });
  const label = el('input', { id: 'verify-outcome-label', attributes: { required: '' } });
  const key = el('input', { id: 'verify-outcome-key' });
  const description = el('textarea', { id: 'verify-outcome-description' });
  const warning = el('p', { attributes: { role: 'status' } });
  const error = el('p', { id: 'verify-outcome-error', attributes: { role: 'alert' } });
  const button = el('button', { id: 'verify-outcome-add-button', text: t('verify.outcomeAddToSchema'), attributes: { type: 'button' } });
  let edited = false;
  let saving = false;
  const updateWarning = (): void => {
    warning.textContent = context.everIds.has(key.value.trim()) && !context.currentIds.has(key.value.trim())
      ? t('verify.outcomeRestoreWarning') : '';
  };
  key.value = slugifyOutcomeLabel('', context.currentIds);
  label.addEventListener('input', () => {
    if (!edited) {
      key.value = slugifyOutcomeLabel(label.value, context.currentIds);
    }
    updateWarning();
  });
  key.addEventListener('input', () => {
    edited = true;
    updateWarning();
  });
  for (const [input, text] of [[label, t('verify.outcomeLabel')], [key, t('verify.outcomeKeyLabel')], [description, t('verify.outcomeDescription')]] as const) {
    root.append(el('label', { text, attributes: { for: input.id } }), input);
  }
  root.append(warning, button, error);
  const add = async (id: string, name: string, addedVia: 'pilot_verify' | 'pilot_candidate'): Promise<void> => {
    if (saving) {
      return;
    }
    const row: SchemaOutcomeEditorRow = {
      // 説明欄はフォームの入力なので、候補から足すときは使わない
      outcomeId: id.trim(), outcomeLabel: name.trim(), description: addedVia === 'pilot_verify' ? description.value.trim() || null : null,
      typicalTimepoints: null, addedVia, note: null, idLocked: false, idEdited: edited, aliases: [],
    };
    if (addedVia === 'pilot_candidate' && !isValidOutcomeId(id.trim())) {
      row.outcomeId = suggestOutcomeId(id, [...context.everIds, ...context.aliasToId.keys()]);
      row.aliases = [id.trim()];
    }
    const errors = validateOutcomeRows([...context.outcomes, row], { listModeBefore: true });
    error.textContent = errors.map((item) => item.message).join(' ');
    if (errors.length > 0) {
      return;
    }
    saving = true;
    const buttons = root.parentElement?.querySelectorAll<HTMLButtonElement>('#verify-outcome-add-button, .verify__outcome-candidate-add') ?? [button];
    buttons.forEach((item) => { item.disabled = true; });
    try {
      await onAdd(row);
    } catch (err) {
      error.textContent = err instanceof Error ? err.message : String(err);
    } finally {
      saving = false;
      buttons.forEach((item) => { item.disabled = false; });
    }
  };
  button.addEventListener('click', () => { void add(key.value, label.value, 'pilot_verify'); });
  return { root, addCandidate: (id, name) => { void add(id, name, 'pilot_candidate'); } };
}
