// ヘルプ相談で共有する、言語・小節・結果の型。
export type HelpLanguage = 'ja' | 'en';

export interface HelpSection {
  id: string;
  kind: 'section' | 'subsection' | 'faq';
  sectionId: string;
  sectionTitle: string;
  title: string;
  when: string[];
  body: string;
}

export type ConsultFailureKind = 'no_key' | 'rate_limited' | 'auth' | 'timeout' | 'aborted'
  | 'network' | 'invalid_response' | 'unknown';

export type ConsultResult =
  | { status: 'failure'; kind: ConsultFailureKind }
  | { status: 'no_match' }
  | { status: 'success'; sectionIds: string[]; answer: string };
