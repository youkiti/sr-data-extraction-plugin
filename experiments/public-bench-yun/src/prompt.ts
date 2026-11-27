import { buildExtractDataSystemPrompt, buildExtractDataUserContent, extractDataResponseSchema } from '../../../src/features/extraction/skills/extractData';
import { EXTRACT_DATA_TEMPERATURE } from '../../../src/features/extraction/executeRun';
import type { SchemaField } from '../../../src/domain/schemaField';
import type { ChatMessage, ChatOptions } from '../../../src/lib/llm/LLMProvider';
import type { Document, Ico, Study } from './dataset';
export { promptCharacters } from '../../cochrane-numeric-benchmark/src/prompt';
export const FIELD_ORDER = ['intervention_events', 'intervention_group_size', 'intervention_mean', 'intervention_standard_deviation',
  'comparator_events', 'comparator_group_size', 'comparator_mean', 'comparator_standard_deviation'] as const;
export function buildFields(icos: Ico[]): SchemaField[] {
  return FIELD_ORDER.flatMap((field, index): SchemaField[] => {
    const group = field.startsWith('intervention_') ? 'intervention' : 'comparator';
    const kind = field.slice(group.length + 1);
    if (!icos.some((ico) => kind === 'group_size' || (ico.outcome_type === 'binary' ? kind === 'events' : kind === 'mean' || kind === 'standard_deviation'))) return [];
    const noun = kind === 'events' ? 'Number of participants with the event' : kind === 'group_size' ? 'Number of participants in the group' : kind === 'mean' ? 'Mean' : 'Standard deviation';
    return [{ schemaVersion: 1, fieldId: field, fieldName: field, fieldIndex: index, section: 'outcomes',
      fieldLabel: `${noun} in the ${group} group`, entityLevel: 'outcome_result', dataType: 'float',
      unit: null, allowedValues: null, required: true,
      extractionInstruction: `${noun} in the ${group} group, for the outcome named in entity_key. If the value is not reported directly but is easy to calculate from what is reported (for example, the number of events from a percentage and the group size), calculate it. If there are data for pre- and post-intervention, use the post-intervention data. If the outcome is reported at several timepoints, use the timepoint closest to the outcome timepoint of interest, or the last one. If the value is unavailable, not extractable, or not easy to calculate, mark it as not reported.`,
      example: null, aiGenerated: false, note: null, maxQuotes: null, multiSelect: null }];
  });
}
export function buildOutcomeList(icos: Ico[]) {
  return icos.map((ico) => ({ outcomeId: ico.outcomeId, outcomeLabel: ico.outcome.trim(),
    description: `Intervention group: ${ico.intervention.trim()} | Comparator group: ${ico.comparator.trim()} | Outcome: ${ico.outcome.trim()} | Data type: ${ico.outcome_type}`,
    typicalTimepoints: null }));
}
export function buildStudyRequest(study: Study, documents: Document[]) {
  const fields = buildFields(study.icos);
  const messages: ChatMessage[] = [
    { role: 'system', content: buildExtractDataSystemPrompt(false, false) },
    { role: 'user', content: buildExtractDataUserContent({ fields, outcomeList: buildOutcomeList(study.icos), protocolContext: null, documents }) },
  ];
  const chatOptions: ChatOptions = { temperature: EXTRACT_DATA_TEMPERATURE, responseSchema: extractDataResponseSchema(false) };
  return { fields, messages, chatOptions, documentCount: documents.length };
}
