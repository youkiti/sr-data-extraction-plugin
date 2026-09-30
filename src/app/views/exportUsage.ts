// 使用量 CSV のカードは既存の形式選択・未検証セル確認から独立する。
import { t } from '../../lib/i18n';
import type { ExportState } from '../store';
import { el } from '../ui/dom';
import type { ExportViewCallbacks } from './types';

export function renderExportUsage(
  usage: ExportState['usage'],
  callbacks: ExportViewCallbacks,
): HTMLElement {
  const generate = el('button', {
    id: 'export-usage-generate',
    text: t('export.usageGenerate'),
    attributes: { type: 'button' },
  });
  generate.disabled = usage?.generating ?? false;
  generate.addEventListener('click', () => callbacks.onGenerateUsage());
  const children: HTMLElement[] = [
    el('h3', { text: t('export.usageTitle') }),
    el('p', { text: t('export.usageDescription') }),
    generate,
  ];
  if (usage?.generating) {
    children.push(el('p', { id: 'export-usage-generating', text: t('export.usageGenerating') }));
  }
  if (usage?.error) {
    children.push(
      el('p', {
        id: 'export-usage-error',
        className: 'export__error',
        text: t('export.usageError', { reason: usage.error }),
        attributes: { role: 'alert' },
      }),
    );
  }
  if (usage?.result) {
    const download = el('button', {
      id: 'export-usage-download',
      text: t('export.download'),
      attributes: { type: 'button' },
    });
    download.addEventListener('click', () => callbacks.onDownloadUsage());
    children.push(
      el('div', { id: 'export-usage-result', className: 'export__result' }, [
        el('p', { text: t('export.saved', { filename: usage.result.filename }) }),
        el('a', {
          id: 'export-usage-result-link',
          text: t('export.openInDrive'),
          attributes: { href: usage.result.fileRef, target: '_blank', rel: 'noopener' },
        }),
        download,
      ]),
    );
  }
  return el('section', { id: 'export-usage', className: 'export__methods' }, children);
}
