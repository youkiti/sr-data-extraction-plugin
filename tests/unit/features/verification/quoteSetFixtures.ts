import type { Evidence } from '../../../../src/domain/evidence';
import type { QuoteSetRow } from '../../../../src/domain/quoteSet';

export const evidence = (overrides: Partial<Evidence> = {}): Evidence => ({
  evidenceId: 'ev', runId: 'run', studyId: 'study', documentId: 'doc',
  fieldId: 'field', entityKey: '-', value: 'value', notReported: false,
  quote: 'quote', page: 1, confidence: 'high', anchorStatus: 'exact',
  bbox: { ymin: 1, xmin: 2, ymax: 3, xmax: 4 }, bboxPage: 2,
  relocatedFrom: null, quoteTheme: 'theme', quoteSeq: null, section: 'Results',
  ...overrides,
});

export const quoteRow = (overrides: Partial<QuoteSetRow> = {}): QuoteSetRow => ({
  setId: 'set', savedAt: 'time', savedBy: 'editor', annotator: 'reviewer',
  annotatorType: 'human_with_ai', studyId: 'study', fieldId: 'field', entityKey: '-',
  schemaVersion: 1, kind: 'quote', seq: 1, quoteId: 'ev', source: 'ai', evidenceId: 'ev',
  originAnnotator: null, documentId: 'doc', quote: 'quote', page: 1, section: 'Results',
  theme: 'theme', anchorStatus: 'exact', baseRunId: 'run', ...overrides,
});
