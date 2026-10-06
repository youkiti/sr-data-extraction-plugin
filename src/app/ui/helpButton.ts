import { buildHelpUrl, type HelpTopicId } from '../../lib/help/topics';
import { getUiLanguage, t } from '../../lib/i18n';
import { el } from './dom';

export function createHelpButton(topicId: HelpTopicId): HTMLAnchorElement {
  const label = t('help.openTopic');
  return el('a', {
    className: 'help-button',
    text: '?',
    attributes: {
      'data-help': topicId,
      href: buildHelpUrl(topicId, getUiLanguage()),
      target: '_blank',
      rel: 'noopener noreferrer',
      'aria-label': label,
      title: label,
    },
  });
}

export function headingWithHelp(level: 'h2' | 'h3', text: string, topicId: HelpTopicId): HTMLElement {
  return el('div', { className: 'heading-with-help' }, [
    el(level, { text }),
    createHelpButton(topicId),
  ]);
}
