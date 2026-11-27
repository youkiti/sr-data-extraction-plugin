import type { SchemaField } from '../../../src/domain/schemaField';
import type { ExtractDataOutcomeListEntry } from '../../../src/features/extraction/skills/extractData';
import type { ReviewContext, Study, TaskItem } from './evaluationSet';

export const FIELD_ORDER = ['experimental_cases', 'experimental_n', 'experimental_mean', 'experimental_sd',
  'control_cases', 'control_n', 'control_mean', 'control_sd'] as const;

export function buildFields(items: TaskItem[]): SchemaField[] {
  const needed = new Set(items.flatMap((item) => item.fields));
  return FIELD_ORDER.flatMap((field, index) => {
    if (!needed.has(field)) return [];
    const group = field.startsWith('experimental_') ? 'experimental' : 'control';
    const kind = field.split('_')[1];
    const noun = kind === 'cases' ? 'Number of participants with the event' : kind === 'n' ? 'Number of participants analysed' :
      kind === 'mean' ? 'Mean' : 'Standard deviation';
    return [{ schemaVersion: 1, fieldId: field, fieldName: field, fieldIndex: index, section: 'outcomes',
      fieldLabel: `${noun} in the ${group} group`, entityLevel: 'outcome_result', dataType: 'float',
      unit: null, allowedValues: null, required: true,
      extractionInstruction: `${noun} in the ${group} group, for the outcome named in entity_key. Report the number exactly as written in the article; do not calculate, convert or round.`,
      example: null, aiGenerated: false, note: null, maxQuotes: null, multiSelect: null }];
  });
}
export function cleanFootnotes(text: string): string {
  const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" };
  return text.replace(/<\/?[A-Za-z][^>]*>/g, ' ').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot);|&#39;/gi, (match, code: string | undefined) => {
    const key = code ?? '#39';
    if (entities[key]) return entities[key];
    const n = key.toLowerCase().startsWith('#x') ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return Number.isInteger(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : match;
  }).replace(/\s+/g, ' ').trim();
}
export function buildOutcomeList(items: TaskItem[]): ExtractDataOutcomeListEntry[] {
  return items.map((item, i) => ({ outcomeId: `o${i + 1}`,
    outcomeLabel: (item.analysis_name ?? '') + (item.subgroup?.trim() ? ` - ${item.subgroup}` : ''),
    description: [
      item.analysis_group_name?.trim() ? `Comparison: ${item.analysis_group_name}` : '',
      `Experimental group: ${item.experimental_group_label?.trim() || item.experimental_intervention?.trim() || 'the intervention named first in the comparison'}`,
      `Control group: ${item.control_group_label?.trim() || item.control_intervention?.trim() || 'the intervention named second in the comparison'}`,
      item.outcome?.trim() ? `Outcome: ${item.outcome}` : '',
      `Data type: ${item.data_type}`,
      cleanFootnotes(item.footnotes ?? '') ? `Review note: ${cleanFootnotes(item.footnotes ?? '')}` : '',
    ].filter(Boolean).join(' | '), typicalTimepoints: null }));
}
export function resolveContext(contexts: (ReviewContext | null | undefined)[]): ReviewContext | null {
  const present = contexts.filter((context): context is ReviewContext => context != null);
  const canonical = (context: ReviewContext) => JSON.stringify({ timing_rules: context.timing_rules ?? [], outcome_definitions: context.outcome_definitions ?? '' });
  if (present.some((context) => canonical(context) !== canonical(present[0]!))) throw new Error('同じレビューの review_context が一致しません');
  return present[0] ?? null;
}
export function protocolContext(context: ReviewContext | null): string | null {
  const parts = [context?.timing_rules?.length ? `Timing rules from the review:\n${context.timing_rules.join('\n')}` : '',
    context?.outcome_definitions?.trim() ? `Outcome definitions from the review:\n${context.outcome_definitions}` : ''];
  return parts.filter(Boolean).join('\n') || null;
}
export function schemaInput(study: Study) {
  return { fields: buildFields(study.items), outcomeList: buildOutcomeList(study.items), protocolContext: protocolContext(study.context) };
}
