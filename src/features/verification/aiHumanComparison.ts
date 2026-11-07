// issue #383: AI と人の現在値をセル単位で分類し、比較相手別に集計・CSV 化する。
// 定義の正典は docs/requirements.md §8「AI と人の比較（issue #383）」。
import { NOT_REPORTED_TOKEN, type AnnotatorType, type StudyDataRow, type ResultsDataRow } from '../../domain/annotation';
import type { Evidence } from '../../domain/evidence';
import { canonicalizeMultiSelectValue } from '../../domain/multiSelect';
import type { EntityLevel, SchemaField } from '../../domain/schemaField';
import type { CompletedRunMeta } from '../extraction/runRepository';
import { selectFinalAnnotator, type AnnotatorTagged } from '../export/finalAnnotator';
import { buildCsv, CSV_BOM } from '../export/csvEncode';
import { STUDY_ENTITY_KEY } from '../../utils/entityKey';
import { composeEvidenceByStudy } from './composeEvidence';
import { bundleEvidence, type EvidenceBundle } from './evidenceBundles';
import { cellKeyOf } from './cellState';

export type ComparisonGroup = 'independent' | 'consensus' | 'human_independent' | 'human_with_ai';
export type ComparisonCategory = 'match' | 'wrong_value' | 'fabrication' | 'omission' | 'incomparable';
export type ComparisonReason = 'human_unjudged' | 'ai_not_extracted' | null;

export interface ComparisonCell {
  studyId: string;
  studyLabel: string;
  fieldId: string;
  fieldName: string;
  fieldLabel: string;
  entityLevel: EntityLevel;
  entityKey: string;
  group: ComparisonGroup;
  annotator: string;
  annotatorType: AnnotatorType;
  category: ComparisonCategory;
  reason: ComparisonReason;
  aiValue: string | null;
  humanValue: string | null;
  missingQuote: boolean;
}

export interface ComparisonInput {
  studies: readonly { studyId: string; studyLabel: string }[];
  fields: readonly SchemaField[];
  studyRows: readonly StudyDataRow[];
  resultRows: readonly ResultsDataRow[];
  evidence: readonly Evidence[];
  runs: readonly CompletedRunMeta[];
}

export interface ComparisonReport {
  cells: ComparisonCell[];
  unextractedStudyIds: string[];
  noFinalStudyIds: string[];
}

function normalized(field: SchemaField, value: string | null): string {
  return (canonicalizeMultiSelectValue(field, value) ?? '').trim();
}

/** 値を先に判定し、引用の失敗は不一致の値にだけ区分として適用する。 */
export function classifyComparisonCell(
  field: SchemaField,
  humanValue: string | null,
  bundle: EvidenceBundle | undefined,
  targeted: boolean,
): Pick<ComparisonCell, 'category' | 'reason' | 'aiValue' | 'humanValue' | 'missingQuote'> {
  const human = normalized(field, humanValue);
  const aiValue = bundle === undefined ? null : bundle.evidence.notReported ? NOT_REPORTED_TOKEN : bundle.evidence.value;
  const ai = normalized(field, aiValue);
  const hasAiValue = (bundle?.evidence.value ?? '').trim() !== '' && bundle?.evidence.notReported !== true;
  const quotes = bundle === undefined ? [] : bundle.quotes.length === 0 ? [bundle.evidence] : bundle.quotes;
  const failed = quotes.length > 0 && quotes.every((quote) => quote.anchorStatus === 'failed');
  let category: ComparisonCategory;
  let reason: ComparisonReason = null;
  if (human === '') {
    category = 'incomparable';
    reason = 'human_unjudged';
  } else if (!targeted) {
    category = 'incomparable';
    reason = 'ai_not_extracted';
  } else if (human === NOT_REPORTED_TOKEN) {
    category = hasAiValue ? 'fabrication' : 'match';
  } else if (!hasAiValue) {
    category = 'omission';
  } else if (human === ai) {
    category = 'match';
  } else {
    category = failed ? 'fabrication' : 'wrong_value';
  }
  return { category, reason, aiValue, humanValue, missingQuote: category !== 'incomparable' && hasAiValue && failed };
}

/** Evidence と基準者の ResultsData の項目別和集合を比較する。群番号は対応付けない。 */
export function buildComparisonCells(input: ComparisonInput): ComparisonReport {
  const cells: ComparisonCell[] = [];
  const unextractedStudyIds: string[] = [];
  const noFinalStudyIds: string[] = [];
  const composed = composeEvidenceByStudy(input.evidence, input.runs);
  for (const { studyId, studyLabel } of input.studies) {
    const runs = input.runs.filter((run) => run.studyIds.includes(studyId));
    if (runs.length === 0) {
      unextractedStudyIds.push(studyId);
      continue;
    }
    const studyRows = input.studyRows.filter((row) => row.studyId === studyId);
    const resultRows = input.resultRows.filter((row) => row.studyId === studyId);
    const people = new Map<string, AnnotatorTagged>();
    for (const row of [...studyRows, ...resultRows]) {
      people.set(row.annotator, { annotator: row.annotator, annotatorType: row.annotatorType });
    }
    const references: Array<{ person: AnnotatorTagged; group: ComparisonGroup }> = [...people.values()]
      .filter((person) => person.annotatorType === 'human_independent')
      .map((person) => ({ person, group: 'independent' }));
    const final = selectFinalAnnotator([...people.values()]);
    if (final === null) {
      noFinalStudyIds.push(studyId);
    } else {
      references.push({ person: final, group: final.annotatorType as Exclude<ComparisonGroup, 'independent'> });
    }
    const evidence = composed.get(studyId)?.evidence ?? [];
    const bundles = bundleEvidence(evidence);
    for (const { person, group } of references) {
      const study = studyRows.find((row) => row.annotator === person.annotator);
      const results = resultRows.filter((row) => row.annotator === person.annotator);
      const resultIndex = new Map(results.map((row) => [cellKeyOf(row.fieldId, row.entityKey), row]));
      for (const field of input.fields) {
        const keys = field.entityLevel === 'study' ? [STUDY_ENTITY_KEY] : [...new Set([
          ...results.filter((row) => row.fieldId === field.fieldId).map((row) => row.entityKey),
          ...evidence.filter((row) => row.fieldId === field.fieldId).map((row) => row.entityKey),
        ])].sort();
        const targeted = runs.some((run) => run.fieldIds === null || run.fieldIds.length === 0 || run.fieldIds.includes(field.fieldId));
        for (const entityKey of keys) {
          const key = cellKeyOf(field.fieldId, entityKey);
          const result = resultIndex.get(key);
          const human = field.entityLevel === 'study' ? study?.values[field.fieldName] ?? null
            : result?.notReported === true ? NOT_REPORTED_TOKEN : result?.value ?? null;
          cells.push({ studyId, studyLabel, fieldId: field.fieldId, fieldName: field.fieldName,
            fieldLabel: field.fieldLabel, entityLevel: field.entityLevel,
            entityKey, group, annotator: person.annotator, annotatorType: person.annotatorType,
            ...classifyComparisonCell(field, human, bundles.get(key), targeted) });
        }
      }
    }
  }
  return { cells, unextractedStudyIds, noFinalStudyIds };
}

export interface ComparisonSummary {
  group: ComparisonGroup;
  entityLevel: EntityLevel | null;
  fieldId: string | null;
  fieldName: string | null;
  fieldLabel: string | null;
  compared: number;
  match: number;
  wrong_value: number;
  fabrication: number;
  omission: number;
  incomparable: number;
  humanUnjudged: number;
  aiNotExtracted: number;
  missingQuote: number;
  accuracy: number | null;
  wrongValueRate: number | null;
  fabricationRate: number | null;
  omissionRate: number | null;
}

export interface ComparisonFilter {
  studyIds?: ReadonlySet<string>;
  entityLevels?: ReadonlySet<EntityLevel>;
}

/** 全体・レベル別・項目別を比較相手ごとに集計する。種類をまたぐ最終値の合算は作らない。 */
export function summarizeComparison(cells: readonly ComparisonCell[], filter: ComparisonFilter = {}): ComparisonSummary[] {
  const summaries = new Map<string, ComparisonSummary>();
  for (const cell of cells) {
    if ((filter.studyIds !== undefined && !filter.studyIds.has(cell.studyId)) ||
        (filter.entityLevels !== undefined && !filter.entityLevels.has(cell.entityLevel))) {
      continue;
    }
    for (const scope of ['overall', 'level', 'field']) {
      const entityLevel = scope === 'overall' ? null : cell.entityLevel;
      const fieldId = scope === 'field' ? cell.fieldId : null;
      const key = JSON.stringify([cell.group, entityLevel, fieldId]);
      let summary = summaries.get(key);
      if (summary === undefined) {
        summary = { group: cell.group, entityLevel, fieldId, fieldName: scope === 'field' ? cell.fieldName : null,
          fieldLabel: scope === 'field' ? cell.fieldLabel : null,
          compared: 0, match: 0, wrong_value: 0, fabrication: 0, omission: 0, incomparable: 0,
          humanUnjudged: 0, aiNotExtracted: 0, missingQuote: 0,
          accuracy: null, wrongValueRate: null, fabricationRate: null, omissionRate: null };
        summaries.set(key, summary);
      }
      summary[cell.category] += 1;
      if (cell.category !== 'incomparable') {
        summary.compared += 1;
      }
      if (cell.reason === 'human_unjudged') {
        summary.humanUnjudged += 1;
      }
      if (cell.reason === 'ai_not_extracted') {
        summary.aiNotExtracted += 1;
      }
      if (cell.missingQuote) {
        summary.missingQuote += 1;
      }
    }
  }
  return [...summaries.values()].map((row) => ({ ...row,
    accuracy: row.compared === 0 ? null : row.match / row.compared,
    wrongValueRate: row.compared === 0 ? null : row.wrong_value / row.compared,
    fabricationRate: row.compared === 0 ? null : row.fabrication / row.compared,
    omissionRate: row.compared === 0 ? null : row.omission / row.compared,
  }));
}

const SUMMARY_KEYS = ['group', 'entityLevel', 'fieldId', 'fieldName', 'fieldLabel', 'compared', 'match', 'wrong_value',
  'fabrication', 'omission', 'incomparable', 'humanUnjudged', 'aiNotExtracted', 'missingQuote',
  'accuracy', 'wrongValueRate', 'fabricationRate', 'omissionRate'] as const;
const CELL_KEYS = ['studyLabel', 'studyId', 'fieldId', 'fieldName', 'fieldLabel', 'entityLevel', 'entityKey', 'group', 'annotator',
  'annotatorType', 'category', 'reason', 'aiValue', 'humanValue', 'missingQuote'] as const;
const SUMMARY_COLUMNS = ['group', 'entity_level', 'field_id', 'field_name', 'field_label', 'compared', 'match', 'wrong_value',
  'fabrication', 'omission', 'incomparable', 'human_unjudged', 'ai_not_extracted', 'missing_quote',
  'accuracy', 'wrong_value_rate', 'fabrication_rate', 'omission_rate', 'unextracted_studies', 'no_final_studies'] as const;
const CELL_COLUMNS = ['study_label', 'study_id', 'field_id', 'field_name', 'field_label', 'entity_level', 'entity_key', 'group',
  'annotator', 'annotator_type', 'category', 'reason', 'ai_value', 'human_value', 'missing_quote'] as const;

/** 一致度レポートと同じく、小数点以下 4 桁に丸めて出力する。 */
function numericCsvCell(value: number | null): string {
  return value === null ? '' : String(Math.round(value * 10000) / 10000);
}

export function buildComparisonSummaryCsv(report: ComparisonReport): string {
  const rows = summarizeComparison(report.cells).map((row) => [...SUMMARY_KEYS.map((key) =>
    key === 'accuracy' || key === 'wrongValueRate' || key === 'fabricationRate' || key === 'omissionRate'
      ? numericCsvCell(row[key]) : String(row[key] ?? '')),
    String(report.unextractedStudyIds.length), String(report.noFinalStudyIds.length)]);
  if (rows.length === 0) {
    rows.push([...SUMMARY_KEYS.map(() => ''), String(report.unextractedStudyIds.length), String(report.noFinalStudyIds.length)]);
  }
  return CSV_BOM + buildCsv(SUMMARY_COLUMNS, rows);
}

export function buildComparisonCellsCsv(cells: readonly ComparisonCell[]): string {
  return CSV_BOM + buildCsv(CELL_COLUMNS, cells.map((cell) => CELL_KEYS.map((key) => String(cell[key] ?? ''))));
}
