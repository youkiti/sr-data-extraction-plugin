import type { GuideTourId } from '../guide/tours';
import type { UiLanguage } from '../i18n';
import { HELP_URL, withUiLanguage } from '../publicPages';

export interface HelpTopic {
  helpAnchor: string;
  route?: string;
  tourId?: GuideTourId;
}

/** 画面・機能と公開ヘルプの対応表。説明文は hosted/help.html に置く。 */
export const HELP_TOPICS = {
  home: { tourId: 'getting-started', route: '#/home', helpAnchor: 'project' },
  documents: { tourId: 'getting-started', route: '#/documents', helpAnchor: 'documents' },
  protocol: { tourId: 'getting-started', route: '#/protocol', helpAnchor: 'protocol' },
  schema: { tourId: 'getting-started', route: '#/schema', helpAnchor: 'schema' },
  pilot: { tourId: 'pilot-and-extract', route: '#/pilot', helpAnchor: 'pilot' },
  extract: { tourId: 'pilot-and-extract', route: '#/extract', helpAnchor: 'extract' },
  verify: { tourId: 'verify-basics', route: '#/verify', helpAnchor: 'verify' },
  dashboard: { tourId: 'export-data', route: '#/dashboard', helpAnchor: 'dashboard' },
  export: { tourId: 'export-data', route: '#/export', helpAnchor: 'export' },
  adjudicate: { tourId: 'dual-review', route: '#/adjudicate', helpAnchor: 'dual-review' },
  options: { route: '#/options', helpAnchor: 'options' },
  'ask-paper': { tourId: 'verify-basics', helpAnchor: 'verify-ask-paper' },
  'review-sets': { tourId: 'dual-review', helpAnchor: 'project-review-sets' },
  tours: { helpAnchor: 'project-tours' },
  usage: { tourId: 'export-data', helpAnchor: 'dashboard-usage' },
  'usage-export': { tourId: 'export-data', helpAnchor: 'export-usage' },
  'pilot-matrix': { tourId: 'pilot-and-extract', helpAnchor: 'pilot-matrix' },
  'pilot-notes': { tourId: 'pilot-and-extract', helpAnchor: 'pilot-notes' },
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
