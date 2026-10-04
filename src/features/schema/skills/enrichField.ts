// enrich-field skill: 項目定義を変更せず探索先・出力制約だけを下書きする純粋関数。
import { z } from 'zod';
import type { SchemaField } from '../../../domain/schemaField';

export const ENRICH_FIELD_SKILL_NAME = 'enrich-field';
export const ENRICH_FIELD_PROMPT_VERSION = 1;

export type EnrichFieldInput = Pick<SchemaField,
  'fieldId' | 'fieldName' | 'fieldLabel' | 'entityLevel' | 'dataType' |
  'unit' | 'allowedValues' | 'extractionInstruction' | 'example'>;

export interface EnrichFieldPromptInput {
  fields: readonly EnrichFieldInput[];
  protocolSummary: string;
}

export const ENRICH_FIELD_SYSTEM_PROMPT = `
Suggest only where to look and hard output constraints for each extraction field.
Return ONLY JSON: {"fields":[{"field_id":"...","location_hint":null,"rules":null}]}.
- Do not change or paraphrase the meaning of the instruction. Output only location_hint and rules.
- Return null when you cannot say something specific to that field. Do not repeat the same generic caution across multiple fields.
- Do not create or change examples.
- Do not include numbers, arm names or author names from a particular paper: these definitions must apply to any paper.
- Do not instruct changes to the meaning or format of classification codes (allowed_values).
- Describe location_hint using section, table or figure types (e.g. Methods randomisation section, CONSORT diagram, Table 1), never page numbers.
- Write in Japanese for Japanese field definitions and English for English definitions.
- Each location_hint and rules value must be a string of at most 500 characters or null.
- Use only supplied field_id values, at most once each.
`.trim();

export function buildEnrichFieldUserPrompt(input: EnrichFieldPromptInput): string {
  const fields = input.fields.map((field) => ({
    field_id: field.fieldId,
    field_name: field.fieldName,
    field_label: field.fieldLabel,
    entity_level: field.entityLevel,
    data_type: field.dataType,
    unit: field.unit,
    allowed_values: field.allowedValues,
    instruction: field.extractionInstruction,
    example: field.example,
  }));
  return `## Protocol summary\n${input.protocolSummary}\n\n## Fields\n${JSON.stringify(fields, null, 2)}`;
}

export type EnrichFieldErrorReason = 'invalid_json' | 'invalid_fields' | 'unknown_field_id' |
  'duplicate_field_id' | 'invalid_value';

export class EnrichFieldFormatError extends Error {
  constructor(public readonly reason: EnrichFieldErrorReason, message: string) {
    super(message);
    this.name = 'EnrichFieldFormatError';
  }
}

export interface EnrichedField {
  fieldId: string;
  locationHint: string | null;
  rules: string | null;
}

export interface EnrichFieldResult {
  /** 入力順。出力に無い項目・長さ超過の項目は両値 null。 */
  fields: EnrichedField[];
  rejected: { fieldId: string; reason: 'too_long'; detail: string }[];
}

const envelopeSchema = z.object({ fields: z.array(z.unknown()) });
const itemSchema = z.object({
  field_id: z.string(),
  location_hint: z.string().nullable(),
  rules: z.string().nullable(),
});

function normalizeHint(value: string | null): string | null {
  return value === null || value.trim() === '' ? null : value.trim();
}

/** 形式不正は理由付き例外、長さ超過は項目単位の破棄として返す。 */
export function parseEnrichFieldResponse(text: string, fields: readonly EnrichFieldInput[]): EnrichFieldResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new EnrichFieldFormatError('invalid_json', 'AI 応答が JSON としてパースできません');
  }
  const envelope = envelopeSchema.safeParse(raw);
  if (!envelope.success) {
    throw new EnrichFieldFormatError('invalid_fields', 'AI 応答の fields が配列ではありません');
  }
  const knownIds = new Set(fields.map((field) => field.fieldId));
  const seen = new Set<string>();
  const proposals = new Map<string, EnrichedField>();
  const rejected: EnrichFieldResult['rejected'] = [];
  for (const item of envelope.data.fields) {
    const parsed = itemSchema.safeParse(item);
    if (!parsed.success) {
      throw new EnrichFieldFormatError('invalid_value', '項目 ID は文字列、探索先・制約は文字列または null が必要です');
    }
    const { field_id: fieldId, location_hint: locationHint, rules } = parsed.data;
    if (!knownIds.has(fieldId)) {
      throw new EnrichFieldFormatError('unknown_field_id', `入力に無い field_id: ${fieldId}`);
    }
    if (seen.has(fieldId)) {
      throw new EnrichFieldFormatError('duplicate_field_id', `重複した field_id: ${fieldId}`);
    }
    seen.add(fieldId);
    if ((locationHint !== null && locationHint.length > 500) || (rules !== null && rules.length > 500)) {
      rejected.push({ fieldId, reason: 'too_long', detail: '探索先または制約が 500 文字を超えています' });
      continue;
    }
    proposals.set(fieldId, { fieldId, locationHint: normalizeHint(locationHint), rules: normalizeHint(rules) });
  }
  return {
    fields: fields.map(({ fieldId }) => proposals.get(fieldId) ?? { fieldId, locationHint: null, rules: null }),
    rejected,
  };
}
