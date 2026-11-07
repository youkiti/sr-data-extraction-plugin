// S6 の合格基準と確認手順・結果を表示する（issue #382）。
// 正典は docs/ui-states.md「S6 合格基準」と requirements.md §8。
import { CRITERIA_GROUPS, CRITERIA_LEVELS, RATE_KEYS, currentCriteria,
  type AcceptanceCriteria, type CriteriaDraft } from '../../features/verification/acceptanceCriteria';
import { t, type MessageKey } from '../../lib/i18n';
import { emptyCriteriaState, type CriteriaState } from '../services/acceptanceCriteriaService';
import type { AppState } from '../store';
import { el } from '../ui/dom';
import { headingWithHelp } from '../ui/helpButton';
import type { PilotViewCallbacks } from './types';

const GROUP_LABELS = { independent: 'dashboard.compareIndependent', consensus: 'dashboard.compareConsensus',
  human_independent: 'dashboard.compareFinalIndependent', human_with_ai: 'dashboard.compareAssisted' } as const;
const LEVEL_LABELS = { study: 'verify.tabStudy', arm: 'verify.tabArm', outcome_result: 'verify.tabOutcome', rob_domain: 'verify.tabRob' } as const;
const CRITERIA_LABELS = { min_accuracy: 'criteria.minAccuracy', max_fabrication_rate: 'criteria.maxFabricationRate',
  max_omission_rate: 'criteria.maxOmissionRate', max_wrong_value_rate: 'criteria.maxWrongValueRate',
  min_compared_cells: 'criteria.minComparedCells', note: 'criteria.note', met: 'criteria.met', not_met: 'criteria.notMet',
  not_evaluable: 'criteria.notEvaluable', no_pilot: 'criteria.noPilot', no_compared_cells: 'criteria.noComparedCells',
  below_minimum: 'criteria.belowMinimum' } as const;

function versionLabel(criteria: AcceptanceCriteria): string {
  return t('criteria.version', { version: criteria.version, date: criteria.confirmed_at, by: criteria.confirmed_by,
    timing: t(criteria.pilot_runs_before === 0 ? 'criteria.before' : 'criteria.after') });
}

function button(id: string, key: MessageKey, action: () => void, disabled: boolean): HTMLButtonElement {
  const node = el('button', { id, text: t(key), attributes: { type: 'button' } });
  node.disabled = disabled;
  node.addEventListener('click', action);
  return node;
}

function renderDraft(form: CriteriaState, ctx: PilotViewCallbacks): HTMLElement {
  const { draft } = form;
  const update = (changes: Partial<CriteriaDraft>): void => ctx.onCriteriaDraft?.({ ...draft, ...changes });
  const select = el('select', { id: 'pilot-criteria-comparator' });
  for (const group of CRITERIA_GROUPS) {
    select.append(el('option', { text: t(GROUP_LABELS[group]), attributes: { value: group } }));
  }
  select.value = draft.comparator;
  select.addEventListener('change', () => update({ comparator: select.value as CriteriaDraft['comparator'] }));
  const children: HTMLElement[] = [el('p', { text: t('criteria.reference') }),
    el('label', { text: t('criteria.comparator'), attributes: { for: select.id } }), select];
  const levels = el('fieldset', {}, [el('legend', { text: t('criteria.levels') })]);
  for (const level of CRITERIA_LEVELS) {
    const input = el('input', { id: `pilot-criteria-level-${level}`, attributes: { type: 'checkbox' } });
    input.checked = draft.entity_levels.includes(level);
    input.addEventListener('change', () => update({ entity_levels: input.checked ? [...draft.entity_levels, level]
      : draft.entity_levels.filter((value) => value !== level) }));
    levels.append(el('label', {}, [input, t(LEVEL_LABELS[level])]));
  }
  children.push(levels);
  for (const key of [...RATE_KEYS, 'min_compared_cells', 'note'] as const) {
    const input = key === 'note' ? el('textarea', { id: `pilot-criteria-${key}` }) : el('input', {
      id: `pilot-criteria-${key}`, attributes: { type: 'number', min: key === 'min_compared_cells' ? '1' : '0',
        ...(key === 'min_compared_cells' ? { step: '1' } : { max: '100', step: 'any' }) },
    });
    input.value = draft[key];
    input.addEventListener('input', () => update({ [key]: input.value }));
    children.push(el('div', {}, [el('label', { text: t(CRITERIA_LABELS[key]), attributes: { for: input.id } }), input]));
  }
  if (draft.comparator === 'human_with_ai') {
    children.push(el('p', { text: t('criteria.assisted') }));
  }
  if (form.pilotCount > 0) {
    children.push(el('p', { text: t('criteria.afterWarning') }));
  }
  children.push(button('pilot-criteria-confirm', 'criteria.confirm', () => ctx.onConfirmCriteria?.(false), form.loading || form.saving));
  if (form.confirming) {
    children.push(el('div', { id: 'pilot-criteria-confirmation', attributes: { role: 'group', 'aria-label': t('criteria.confirm') } }, [
      el('p', { text: t('criteria.confirmPrompt') }),
      button('pilot-criteria-save', 'criteria.confirmSave', () => ctx.onConfirmCriteria?.(true), form.saving),
      button('pilot-criteria-cancel', 'common.cancel', () => ctx.onCancelCriteria?.(), form.saving),
    ]));
  }
  const fieldset = el('fieldset', {}, children);
  fieldset.disabled = form.saving;
  return fieldset;
}

function renderCurrent(current: AcceptanceCriteria, form: CriteriaState): HTMLElement {
  const children: HTMLElement[] = [el('p', { text: versionLabel(current) }),
    el('p', { text: `${t('criteria.comparator')}: ${t(GROUP_LABELS[current.comparator])}` }),
    el('p', { text: `${t('criteria.levels')}: ${current.entity_levels.map((level) => t(LEVEL_LABELS[level])).join(', ')}` })];
  const result = form.evaluation;
  const resultKeys = { min_accuracy: 'accuracy', max_fabrication_rate: 'fabrication_rate',
    max_omission_rate: 'omission_rate', max_wrong_value_rate: 'wrong_value_rate' } as const;
  for (const key of RATE_KEYS) {
    const value = result?.[resultKeys[key]];
    children.push(el('p', { text: `${t(CRITERIA_LABELS[key])}: ${current[key] ?? t('criteria.unused')}` +
      (result === null ? '' : ` / ${value == null ? '—' : `${value.toFixed(2)}%`}`) }));
  }
  children.push(el('p', { text: `${t('criteria.minComparedCells')}: ${current.min_compared_cells ?? t('criteria.unused')}` }));
  if (current.note !== '') {
    children.push(el('p', { text: current.note }));
  }
  if (current.comparator === 'human_with_ai') {
    children.push(el('p', { text: t('criteria.assisted') }));
  }
  if (result !== null) {
    children.push(el('p', { id: 'pilot-criteria-result', text: t(CRITERIA_LABELS[result.result]), attributes: { role: 'status' } }),
      el('p', { text: t('criteria.count', { n: result.compared, studies: result.pilot_studies }) }));
    if (result.not_evaluable_reason !== '') {
      children.push(el('p', { text: t(CRITERIA_LABELS[result.not_evaluable_reason]) }));
    }
  }
  return el('div', { id: 'pilot-criteria-current' }, children);
}

export function renderPilotCriteria(state: AppState, ctx: PilotViewCallbacks): HTMLElement {
  const form = state.pilot.criteria ?? emptyCriteriaState();
  const current = currentCriteria(form.versions ?? []);
  const children: HTMLElement[] = [headingWithHelp('h3', t('criteria.title'), 'pilot-criteria')];
  if (form.loading) {
    children.push(el('p', { text: t('common.loading'), attributes: { role: 'status' } }));
  }
  if (form.error !== null) {
    children.push(el('p', { id: 'pilot-criteria-error', text: form.error, attributes: { role: 'alert' } }),
      button('pilot-criteria-reload', 'common.retry', () => ctx.onReloadCriteria?.(), form.loading || form.saving));
  }
  if (form.ignoredCount > 0) {
    children.push(el('p', { text: t('criteria.ignored', { n: form.ignoredCount }), attributes: { role: 'alert' } }));
  }
  children.push(current === null ? el('p', { text: t('criteria.empty') }) : renderCurrent(current, form));
  if (current !== null) {
    children.push(button('pilot-criteria-calculate', 'criteria.calculate', () => ctx.onCalculateCriteria?.(), form.calculating || form.saving));
  }
  if (form.calculating) {
    children.push(el('p', { text: t('criteria.calculating'), attributes: { role: 'status' } }));
  }
  if ((state.role.role ?? 'owner') === 'owner') {
    children.push(renderDraft(form, ctx));
  }
  if ((form.versions?.length ?? 0) > 1) {
    children.push(el('h4', { text: t('criteria.history') }), el('ul', {}, form.versions!
      .filter((row) => row !== current).map((row) => el('li', { text: versionLabel(row) }))));
  }
  return el('section', { id: 'pilot-criteria' }, children);
}
