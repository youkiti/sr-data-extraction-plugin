import type { UiLanguage } from '../i18n';
import { HELP_URL, withUiLanguage } from '../publicPages';

export interface HelpTopic {
  helpAnchor: string;
  route?: string;
}

/** 画面・機能と公開ヘルプの対応表。説明文は hosted/help.html に置く。 */
export const HELP_TOPICS = {
  home: { route: '#/home', helpAnchor: 'project' },
  documents: { route: '#/documents', helpAnchor: 'documents' },
  protocol: { route: '#/protocol', helpAnchor: 'protocol' },
  schema: { route: '#/schema', helpAnchor: 'schema' },
  pilot: { route: '#/pilot', helpAnchor: 'pilot' },
  extract: { route: '#/extract', helpAnchor: 'extract' },
  verify: { route: '#/verify', helpAnchor: 'verify' },
  dashboard: { route: '#/dashboard', helpAnchor: 'dashboard' },
  export: { route: '#/export', helpAnchor: 'export' },
  adjudicate: { route: '#/adjudicate', helpAnchor: 'dual-review' },
  options: { route: '#/options', helpAnchor: 'options' },
} as const satisfies Record<string, HelpTopic>;

export type HelpTopicId = keyof typeof HELP_TOPICS;

export function buildHelpUrl(topicId: HelpTopicId, language: UiLanguage): string {
  const url = new URL(withUiLanguage(HELP_URL, language));
  url.hash = HELP_TOPICS[topicId].helpAnchor;
  return url.toString();
}

export function isHelpTopicId(value: string): value is HelpTopicId {
  return Object.prototype.hasOwnProperty.call(HELP_TOPICS, value);
}

export function helpTopicForRoute(hash: string): HelpTopicId | null {
  for (const topicId of Object.keys(HELP_TOPICS) as HelpTopicId[]) {
    const topic: HelpTopic = HELP_TOPICS[topicId];
    if (topic.route === hash) return topicId;
  }
  return null;
}
