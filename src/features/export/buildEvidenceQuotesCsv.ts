// AI と人の引用一覧を、出所と最終採用の情報を含む CSV にする。
// セルのスナップショットと判定者から、引用ごとの採用状態を求める。
import type { AnnotatorType, ResultsDataRow, StudyDataRow } from '../../domain/annotation';
import type { DocumentRecord } from '../../domain/document';
import type { Evidence } from '../../domain/evidence';
import type { CellQuote, QuoteSetRow } from '../../domain/quoteSet';
import type { SchemaField } from '../../domain/schemaField';
import type { StudyRecord } from '../../domain/study';
import { aiCellQuotes, foldQuoteSets, quoteSetKeyOf, resolveCellQuotes } from '../verification/cellQuotes';
import type { EvidenceBundle } from '../verification/evidenceBundles';
import { buildCsv, CSV_BOM } from './csvEncode';
import { selectFinalAnnotator } from './finalAnnotator';

export const EVIDENCE_QUOTES_HEADER = [
  'study_label', 'study_id', 'field_name', 'field_id', 'entity_key', 'annotator',
  'annotator_type', 'source', 'origin_annotator', 'theme', 'quote', 'page', 'section',
  'document_id', 'document_filename', 'anchor_status', 'is_final',
] as const;

/** 引用の出所と最終採用状態を含む CSV を生成する。 */
export function buildEvidenceQuotesCsv(params: {
  studies: readonly StudyRecord[];
  fields: readonly SchemaField[];
  bundlesByStudy: ReadonlyMap<string, ReadonlyMap<string, EvidenceBundle>>;
  quoteSetRows: readonly QuoteSetRow[];
  evidences: readonly Evidence[];
  documents: readonly DocumentRecord[];
  studyDataRows: readonly StudyDataRow[];
  resultsDataRows: readonly ResultsDataRow[];
}): { csv: string; rowCount: number; studyCount: number } {
  const snapshots = foldQuoteSets(params.quoteSetRows);
  const evidenceById = new Map(params.evidences.map((row) => [row.evidenceId, row]));
  const fieldById = new Map(params.fields.map((field) => [field.fieldId, field]));
  const filenames = new Map(params.documents.map((doc) => [doc.documentId, doc.filename]));
  const csvRows: string[][] = [];
  let studyCount = 0;
  for (const study of params.studies) {
    const studyRows = params.studyDataRows.filter((row) => row.studyId === study.studyId);
    // long 行は同じ annotator が複数セルを持つので、組を一意化して選ぶ。
    const resultAnnotators = new Map(params.resultsDataRows
      .filter((row) => row.studyId === study.studyId)
      .map((row) => [JSON.stringify([row.annotator, row.annotatorType]), row]));
    const studyFinal = selectFinalAnnotator(studyRows);
    const resultsFinal = selectFinalAnnotator([...resultAnnotators.values()]);
    const items: { quote: CellQuote; annotator: string; annotatorType: AnnotatorType; field: SchemaField }[] = [];
    const add = (quotes: CellQuote[], annotator: string, annotatorType: AnnotatorType): void => {
      for (const quote of quotes) {
        const field = fieldById.get(quote.fieldId);
        if (field !== undefined) items.push({ quote, annotator, annotatorType, field });
      }
    };
    for (const bundle of params.bundlesByStudy.get(study.studyId)?.values() ?? []) {
      add(aiCellQuotes(bundle), 'ai', 'ai');
    }
    for (const [key, snapshot] of snapshots) {
      const [studyId, , , annotator, annotatorType] = JSON.parse(key) as [string, string, string, string, AnnotatorType];
      if (studyId === study.studyId && snapshot.kind === 'quote') {
        add(resolveCellQuotes(null, snapshot, evidenceById).quotes, annotator, annotatorType);
      }
    }
    const compareText = (a: string, b: string): number => a === b ? 0 : a < b ? -1 : 1;
    items.sort((a, b) => compareText(a.quote.entityKey, b.quote.entityKey)
      || a.field.fieldIndex - b.field.fieldIndex
      || Number(b.annotator === 'ai') - Number(a.annotator === 'ai')
      || compareText(a.annotator, b.annotator));
    if (items.length > 0) studyCount++;
    for (const { quote, annotator, annotatorType, field } of items) {
      const final = field.entityLevel === 'study' ? studyFinal : resultsFinal;
      let isFinal = false;
      if (final !== null) {
        const snapshot = snapshots.get(quoteSetKeyOf({ ...quote,
          annotator: final.annotator, annotatorType: final.annotatorType }));
        if (final.annotatorType === 'consensus' || (snapshot !== undefined && snapshot.kind !== 'reset')) {
          isFinal = annotator === final.annotator && annotatorType === final.annotatorType;
        } else if (final.annotatorType === 'human_with_ai') {
          isFinal = annotatorType === 'ai';
        }
      }
      csvRows.push([
        study.studyLabel, study.studyId, field.fieldName, quote.fieldId, quote.entityKey,
        annotator, annotatorType, quote.source, quote.originAnnotator ?? '', quote.theme ?? '',
        quote.quote, quote.page === null ? '' : String(quote.page), quote.section ?? '',
        quote.documentId ?? '', filenames.get(quote.documentId ?? '') ?? '', quote.anchorStatus ?? '',
        isFinal ? 'TRUE' : 'FALSE',
      ]);
    }
  }
  return { csv: CSV_BOM + buildCsv(EVIDENCE_QUOTES_HEADER, csvRows), rowCount: csvRows.length, studyCount };
}
