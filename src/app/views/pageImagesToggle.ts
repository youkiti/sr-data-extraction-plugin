// S6 / S7 の実行前に置く、本文と全ページ画像を併用するチェックボックス。
import type { LlmProviderId } from '../../domain/llmApiLog';
import { t } from '../../lib/i18n';
import { isRunBlockedByImageUnsupportedModel, resolveEffectivePageImages } from '../../lib/llm/providerFactory';
import { el } from '../ui/dom';

export interface PageImagesToggleProps {
  idPrefix: string;
  enabled: boolean;
  model: string;
  providerOverride: LlmProviderId | null;
  onToggle(enabled: boolean): void;
}

export function renderPageImagesToggle(props: PageImagesToggleProps): HTMLElement {
  const id = `${props.idPrefix}-page-images`;
  const checkbox = el('input', {
    id,
    attributes: { type: 'checkbox', 'aria-describedby': `${id}-description` },
  });
  checkbox.disabled = isRunBlockedByImageUnsupportedModel(props.model, true, props.providerOverride);
  checkbox.checked = resolveEffectivePageImages(props.enabled, props.model, props.providerOverride);
  checkbox.addEventListener('change', () => props.onToggle(checkbox.checked));
  const children = [
    el('label', {}, [checkbox, t('extraction.pageImagesLabel')]),
    el('p', { id: `${id}-description`, className: 'page-images__note', text: t('extraction.pageImagesDescription') }),
  ];
  if (checkbox.disabled) {
    children.push(el('p', { className: 'page-images__note', text: t('extraction.pageImagesUnsupported') }));
  }
  return el('div', { className: 'page-images' }, children);
}
