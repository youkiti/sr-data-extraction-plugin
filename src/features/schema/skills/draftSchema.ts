// draft-schema skill のプロンプト管理（requirements.md §4.3）
// - extract-data skill（features/extraction/skills/extractData.ts）と同じ構成:
//   プロンプト構築 → 構造化出力スキーマ → 応答パース の純粋関数のみ。LLM 呼び出しは
//   app/services/schemaService.ts が withRetry(withLogging(provider)) で配線する
// - 抽出対象論文は英語を主想定のため、プロンプト本文は英語（requirements.md §6）
import { z } from 'zod';
import type { EntityLevel, FieldDataType } from '../../../domain/schemaField';
import type { SchemaEditorRow } from '../types';

/** LLMApiLog.purpose（draft_schema）と対応づける skill 識別子 */
export const DRAFT_SCHEMA_SKILL_NAME = 'draft-schema';

/** プロンプト版数。プロンプト文言・スキーマを変えたら必ずインクリメントする */
export const DRAFT_SCHEMA_PROMPT_VERSION = 1;

/** サンプル論文 1 本ぶんのページ別本文（extracted_texts/{id}.txt 由来） */
export interface DraftSchemaSamplePaper {
  /** 表示名（study_label）。プロンプト内の見出しになる */
  label: string;
  pages: readonly { page: number; text: string }[];
}

export interface DraftSchemaPromptInput {
  /** プロトコル本文（Protocol.raw_text_inline または raw_protocols/ の退避テキスト） */
  protocolText: string;
  /** サンプル論文 1〜3 本（requirements.md §1.3） */
  samples: readonly DraftSchemaSamplePaper[];
}

/**
 * システムプロンプト。field_name の snake_case・entity_level の 3 レベル制約・
 * enum の許容値規約は後続の抽出品質と CSV 列名に直結するため、
 * 文言を変える場合は DRAFT_SCHEMA_PROMPT_VERSION を上げる
 */
export const DRAFT_SCHEMA_SYSTEM_PROMPT = `
You are an experienced systematic review methodologist designing a data extraction schema (coding sheet).
Read the review protocol and the sample articles, then propose the extraction fields and return ONLY a JSON array — no markdown fences, no commentary.

Rules:
- "field_name": a unique snake_case identifier (lowercase letters, digits, underscores; must start with a letter). It becomes a CSV column name.
- "field_label": a short human-readable label in Japanese.
- "section": one of "identification", "methods", "population", "intervention", "outcomes", or another short lowercase group name.
- "entity_level": "study" for once-per-article fields (design, country, total N), "arm" for per-group fields (arm name, intervention detail, group N), "outcome_result" for per-outcome-per-timepoint results (events, totals, means, SDs). Never use any other level.
- "data_type": one of "text", "integer", "float", "boolean", "enum", "date".
- "allowed_values": ONLY when data_type is "enum" — the permitted values joined by "|" (e.g. "rct|quasi_rct|observational"). Otherwise null.
- "unit": the expected unit (e.g. "mg/day") or null. Values are extracted as reported; units are never converted.
- "required": true for fields essential to the review question; extraction must report not_reported explicitly for them.
- "extraction_instruction": a concrete instruction in English telling the extractor exactly what to look for and how to report it.
- "example": a realistic example value as it would appear in an article, or null.
- Cover the protocol's PICO: identification and methods fields, population fields, arm-level intervention fields, and outcome_result fields for every protocol-defined outcome (for binary outcomes: events and totals per arm; for continuous: mean, SD and N per arm).
- Propose 10-40 fields. Do not include risk-of-bias domains.
`.trim();

/**
 * ユーザープロンプトを組み立てる。samples は 1〜3 本（requirements.md §1.3）を強制する
 */
export function buildDraftSchemaUserPrompt(input: DraftSchemaPromptInput): string {
  if (input.protocolText.trim() === '') {
    throw new Error('draft-schema skill にプロトコル本文が渡されていません');
  }
  if (input.samples.length < 1 || input.samples.length > 3) {
    throw new Error(
      `draft-schema skill のサンプル論文は 1〜3 本です（指定: ${input.samples.length} 本）`,
    );
  }
  const sections: string[] = [`## Review protocol\n\n${input.protocolText.trim()}`];
  for (const sample of input.samples) {
    const body = sample.pages.map((page) => `[PAGE ${page.page}]\n${page.text}`).join('\n\n');
    sections.push(`## Sample article: ${sample.label}\n\n${body}`);
  }
  sections.push(
    `## Output format\n\nReturn a JSON array. Each element must be:\n` +
      `{ "section": "<group>", "field_name": "<snake_case>", "field_label": "<日本語の表示名>", ` +
      `"entity_level": "study" | "arm" | "outcome_result", ` +
      `"data_type": "text" | "integer" | "float" | "boolean" | "enum" | "date", ` +
      `"unit": "<unit>" | null, "allowed_values": "<v1|v2|...>" | null, "required": true | false, ` +
      `"extraction_instruction": "<instruction in English>", "example": "<example>" | null }`,
  );
  return sections.join('\n\n');
}

/**
 * 構造化出力（constrained decoding）用の JSON Schema。
 * LLMProvider の ChatOptions.responseSchema に渡す（標準 JSON Schema 方言）
 */
export const DRAFT_SCHEMA_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      section: { type: 'string' },
      field_name: { type: 'string' },
      field_label: { type: 'string' },
      entity_level: { type: 'string', enum: ['study', 'arm', 'outcome_result'] },
      data_type: { type: 'string', enum: ['text', 'integer', 'float', 'boolean', 'enum', 'date'] },
      unit: { type: ['string', 'null'] },
      allowed_values: { type: ['string', 'null'] },
      required: { type: 'boolean' },
      extraction_instruction: { type: 'string' },
      example: { type: ['string', 'null'] },
    },
    required: [
      'section',
      'field_name',
      'field_label',
      'entity_level',
      'data_type',
      'unit',
      'allowed_values',
      'required',
      'extraction_instruction',
      'example',
    ],
    additionalProperties: false,
  },
};

/** AI 応答が期待形式でないときの失敗（ドラフト全体の失敗として扱う） */
export class DraftSchemaFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DraftSchemaFormatError';
  }
}

const draftedFieldSchema = z.object({
  section: z.string().min(1),
  field_name: z.string().min(1),
  field_label: z.string().min(1),
  entity_level: z.enum(['study', 'arm', 'outcome_result']),
  data_type: z.enum(['text', 'integer', 'float', 'boolean', 'enum', 'date']),
  unit: z.string().nullable(),
  allowed_values: z.string().nullable(),
  required: z.boolean(),
  extraction_instruction: z.string().min(1),
  example: z.string().nullable(),
});

const draftedArraySchema = z.array(draftedFieldSchema).min(1);

/** 構造化出力を要求しても markdown フェンスで包むモデルがあるため防御的に剥がす */
function stripJsonFence(text: string): string {
  const trimmed = text.trim();
  const match = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/.exec(trimmed);
  return match?.[1] ?? trimmed;
}

/**
 * LLM 応答テキストをパースしてスキーマエディタの行（SchemaEditorRow）へ変換する。
 * fieldId は null（確定時に採番）・aiGenerated は true 固定。
 * JSON / 形式エラーは DraftSchemaFormatError
 */
export function parseDraftSchemaResponse(text: string): SchemaEditorRow[] {
  let raw: unknown;
  try {
    raw = JSON.parse(stripJsonFence(text));
  } catch (error) {
    throw new DraftSchemaFormatError(`AI 応答が JSON としてパースできません: ${String(error)}`);
  }
  const result = draftedArraySchema.safeParse(raw);
  if (!result.success) {
    throw new DraftSchemaFormatError(
      `AI 応答がスキーマドラフトの形式に合いません: ${result.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join(' / ')}`,
    );
  }
  return result.data.map((item) => ({
    fieldId: null,
    section: item.section,
    fieldName: item.field_name,
    fieldLabel: item.field_label,
    entityLevel: item.entity_level as EntityLevel,
    dataType: item.data_type as FieldDataType,
    unit: item.unit,
    allowedValues: item.allowed_values,
    required: item.required,
    extractionInstruction: item.extraction_instruction,
    example: item.example,
    aiGenerated: true,
    note: null,
  }));
}
