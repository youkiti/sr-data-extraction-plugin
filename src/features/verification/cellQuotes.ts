import type { AnnotatorType } from '../../domain/annotation';
import type { Evidence } from '../../domain/evidence';
import type { CellQuote, QuoteSetRow, ResolvedCellQuotes } from '../../domain/quoteSet';
import type { EvidenceBundle } from './evidenceBundles';

export interface QuoteSnapshot {
  setId: string;
  kind: QuoteSetRow['kind'];
  rows: QuoteSetRow[];
  baseRunId: string | null;
  savedAt: string;
  savedBy: string;
}

export function quoteSetKeyOf(parts: {
  studyId: string; fieldId: string; entityKey: string;
  annotator: string; annotatorType: AnnotatorType;
}): string {
  return JSON.stringify([parts.studyId, parts.fieldId, parts.entityKey, parts.annotator, parts.annotatorType]);
}

const bySeq = (a: QuoteSetRow, b: QuoteSetRow): number => (a.seq ?? 0) - (b.seq ?? 0);

/** 時刻ではなくシート行順で最後に現れた set を採用する。 */
export function foldQuoteSets(rows: readonly QuoteSetRow[]): Map<string, QuoteSnapshot> {
  const groups = new Map<string, Map<string, QuoteSetRow[]>>();
  const latest = new Map<string, QuoteSetRow>();
  for (const row of rows) {
    const key = quoteSetKeyOf(row);
    const sets = groups.get(key) ?? new Map<string, QuoteSetRow[]>();
    const set = sets.get(row.setId) ?? [];
    set.push(row);
    sets.set(row.setId, set);
    groups.set(key, sets);
    latest.set(key, row);
  }
  return new Map([...latest].map(([key, last]) => [key, {
    setId: last.setId, kind: last.kind, baseRunId: last.baseRunId,
    savedAt: last.savedAt, savedBy: last.savedBy,
    rows: last.kind === 'quote'
      ? groups.get(key)!.get(last.setId)!.filter((row) => row.kind === 'quote').sort(bySeq) : [],
  }]));
}

export function aiCellQuotes(bundle: EvidenceBundle | null): CellQuote[] {
  if (bundle === null) return [];
  const rows = bundle.quotes.length > 0
    ? [...bundle.quotes].sort((a, b) => (a.quoteSeq ?? 0) - (b.quoteSeq ?? 0)) : [bundle.evidence];
  return rows.filter((row) => row.quote !== null).map((row) => ({
    quoteId: row.evidenceId, evidenceId: row.evidenceId, source: 'ai', originAnnotator: null,
    studyId: row.studyId, fieldId: row.fieldId, entityKey: row.entityKey,
    documentId: row.documentId, quote: row.quote!, page: row.page, section: row.section,
    theme: row.quoteTheme, anchorStatus: row.anchorStatus,
    bboxPage: row.bboxPage, bbox: row.bbox, confidence: row.confidence,
  }));
}

export function resolveCellQuotes(
  bundle: EvidenceBundle | null,
  snapshot: QuoteSnapshot | null,
  evidenceById: ReadonlyMap<string, Evidence>,
): ResolvedCellQuotes {
  if (snapshot === null || snapshot.kind === 'reset') {
    return { quotes: aiCellQuotes(bundle), edited: false, newerAiAvailable: false,
      baseRunId: bundle?.evidence.runId ?? null };
  }
  const quotes = snapshot.kind === 'empty' ? [] : [...snapshot.rows].sort(bySeq)
    .filter((row) => row.quote !== null && row.quote !== '' && row.quoteId !== null)
    .map((row): CellQuote => {
      const evidence = row.source === 'ai' && row.evidenceId !== null
        ? evidenceById.get(row.evidenceId) : undefined;
      return {
        quoteId: row.quoteId!, studyId: row.studyId, fieldId: row.fieldId, entityKey: row.entityKey,
        source: row.source === 'ai' ? 'ai' : 'human', evidenceId: row.evidenceId,
        originAnnotator: row.originAnnotator, documentId: row.documentId, quote: row.quote!,
        page: row.page, section: row.section, theme: row.theme, anchorStatus: row.anchorStatus,
        bboxPage: evidence?.bboxPage ?? null, bbox: evidence?.bbox ?? null,
        confidence: evidence?.confidence ?? null,
      };
    });
  return { quotes, edited: true,
    newerAiAvailable: bundle !== null && snapshot.baseRunId !== bundle.evidence.runId,
    baseRunId: snapshot.baseRunId };
}

export function removeCellQuote(quotes: readonly CellQuote[], quoteId: string): CellQuote[] {
  return quotes.filter((quote) => quote.quoteId !== quoteId);
}

export function setCellQuoteTheme(
  quotes: readonly CellQuote[], quoteId: string, theme: string | null,
): CellQuote[] {
  return quotes.map((quote) => quote.quoteId === quoteId
    ? { ...quote, theme: theme?.trim() || null } : quote);
}

export function buildQuoteSetRows(params: {
  setId: string; savedAt: string; savedBy: string;
  annotator: string; annotatorType: AnnotatorType;
  studyId: string; fieldId: string; entityKey: string; schemaVersion: number;
  quotes: readonly CellQuote[]; baseRunId: string | null;
}): QuoteSetRow[] {
  const { quotes, ...metadata } = params;
  if (quotes.length === 0) return [{ ...buildQuoteSetResetRow(metadata), kind: 'empty' }];
  return quotes.map((quote, index) => ({
    ...metadata, kind: 'quote', seq: index + 1,
    quoteId: quote.quoteId, source: quote.source, evidenceId: quote.evidenceId,
    originAnnotator: quote.originAnnotator, documentId: quote.documentId,
    quote: quote.quote, page: quote.page, section: quote.section, theme: quote.theme,
    anchorStatus: quote.anchorStatus,
  }));
}

export function buildQuoteSetResetRow(
  params: Omit<Parameters<typeof buildQuoteSetRows>[0], 'quotes'>,
): QuoteSetRow {
  return { ...params, kind: 'reset', seq: null, quoteId: null, source: null,
    evidenceId: null, originAnnotator: null, documentId: null, quote: null, page: null,
    section: null, theme: null, anchorStatus: null };
}
