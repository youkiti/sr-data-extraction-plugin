import type { Decision } from '../../domain/decision';
import type { AnchoredCitation } from '../verification/askPaper';
// 裁定セルの両者の引用と、独立した最終の根拠を解決する。
import type { AnnotatorType, StudyDataRow, ResultsDataRow } from '../../domain/annotation';
import type { Evidence } from '../../domain/evidence';
import type { CellQuote, QuoteSetRow } from '../../domain/quoteSet';
import { normalizeText } from '../anchoring/normalizeText';
import { foldQuoteSets, quoteSetKeyOf, resolveCellQuotes } from '../verification/cellQuotes';
import { cellKeyOf } from '../verification/cellState';
import { bundleEvidence } from '../verification/evidenceBundles';
import { remapArmEntityKey } from './armMatch';

export function sameAdjudicateQuote(a: CellQuote, b: CellQuote): boolean {
  return a.quoteId === b.quoteId ||
    (a.documentId === b.documentId && normalizeText(a.quote) === normalizeText(b.quote));
}

export interface AdjudicateQuoteCandidate {
  quote: CellQuote;
  owner: 'A' | 'B' | 'both';
  originAnnotator: string;
  adopted: boolean;
}

export function resolveAdjudicateQuotes(input: {
  studyId: string; fieldId: string; entityKey: string;
  annotatorA: string; annotatorB: string;
  annotatorTypeA: AnnotatorType; annotatorTypeB: AnnotatorType;
  quoteSetRows: readonly QuoteSetRow[];
  evidence: readonly Evidence[]; quoteEvidence: readonly Evidence[];
  armKeyRemap: ReadonlyMap<string, string>;
}) {
  const snapshots = foldQuoteSets(input.quoteSetRows.map((row) => row.annotator === input.annotatorB
    ? { ...row, entityKey: remapArmEntityKey(row.entityKey, input.armKeyRemap) } : row));
  const evidenceById = new Map(input.quoteEvidence.map((row) => [row.evidenceId, row]));
  const bundle = bundleEvidence(input.evidence).get(cellKeyOf(input.fieldId, input.entityKey)) ?? null;
  const resolve = (annotator: string, annotatorType: AnnotatorType) => resolveCellQuotes(
    annotatorType === 'human_with_ai' ? bundle : null,
    snapshots.get(quoteSetKeyOf({ ...input, annotator, annotatorType })) ?? null, evidenceById);
  const quotesA = resolve(input.annotatorA, input.annotatorTypeA).quotes;
  const quotesB = resolve(input.annotatorB, input.annotatorTypeB).quotes;
  const consensus = resolve('consensus', 'consensus');
  const candidates: AdjudicateQuoteCandidate[] = [];
  for (const [quotes, owner, originAnnotator] of [
    [quotesA, 'A', input.annotatorA], [quotesB, 'B', input.annotatorB],
  ] as const) {
    for (const quote of quotes) {
      const existing = candidates.find((candidate) => sameAdjudicateQuote(candidate.quote, quote));
      if (existing !== undefined) {
        if (existing.owner !== owner) existing.owner = 'both';
      } else {
        candidates.push({ quote, owner, originAnnotator,
          adopted: consensus.quotes.some((chosen) => sameAdjudicateQuote(chosen, quote)) });
      }
    }
  }
  const added = consensus.quotes.filter((quote) =>
    !candidates.some((candidate) => sameAdjudicateQuote(candidate.quote, quote)));
  return { quotesA, quotesB, consensus, candidates, added };
}

/** 型が混在する旧データでも、セルの現在値に使う行の型に合わせる。 */
export function reviewerQuoteType(
  studyRow: StudyDataRow | null, results: readonly ResultsDataRow[], decisions: readonly Decision[],
  fieldId: string, entityKey: string,
): 'human_with_ai' | 'human_independent' {
  const valueRow = entityKey === '-' ? studyRow :
    results.filter((row) => row.fieldId === fieldId && row.entityKey === entityKey).at(-1);
  const decision = [...decisions].filter((row) => row.fieldId === fieldId && row.entityKey === entityKey)
    .sort((a, b) => a.decidedAt.localeCompare(b.decidedAt)).at(-1);
  return (valueRow ?? decision)?.annotatorType === 'human_with_ai' ? 'human_with_ai' : 'human_independent';
}

export function quoteCitation(quote: CellQuote): AnchoredCitation {
  return { documentIndex: 1, documentId: quote.documentId, quote: quote.quote, page: quote.page,
    anchorStatus: quote.anchorStatus ?? 'failed', anchoredPage: quote.page,
    highlightable: quote.anchorStatus !== null && quote.anchorStatus !== 'failed' };
}
