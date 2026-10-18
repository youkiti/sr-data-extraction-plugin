// benchmark-schema.json（snake_case）→ 本番 SchemaField（camelCase + 既定値）への変換。
// buildExtractDataUserPrompt / validateAiOutput が受ける形状に埋める。
// 既存 extraction-benchmark/src/loadSchema.ts の踏襲。
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { EntityLevel, FieldDataType, SchemaField } from '../../../src/domain/schemaField';
import { benchRoot } from './config';

interface RawField {
  field_id: string;
  field_name: string;
  entity_level: EntityLevel;
  data_type: FieldDataType;
  extraction_instruction: string;
}

export function localName(value: string | undefined, fallback: string): string {
  const name = value ?? fallback;
  if (!name || /[/\\]/.test(name) || name.includes('..')) throw new Error(`不正なファイル・ディレクトリ名: ${name}`);
  return name;
}

export function schemaFileName(): string {
  return localName(process.env.BENCH_SCHEMA_FILE, 'benchmark-schema.json');
}

export async function loadBenchmarkSchema(): Promise<SchemaField[]> {
  const raw = await readFile(path.join(benchRoot, 'schema', schemaFileName()), 'utf8');
  const parsed = JSON.parse(raw) as { schema_version: number; fields: RawField[] };
  return parsed.fields.map((f, i) => ({
    schemaVersion: parsed.schema_version,
    fieldId: f.field_id,
    fieldIndex: i,
    section: '',
    fieldName: f.field_name,
    fieldLabel: f.field_name,
    entityLevel: f.entity_level,
    dataType: f.data_type,
    unit: null,
    allowedValues: null,
    required: true,
    extractionInstruction: f.extraction_instruction,
    example: null,
    aiGenerated: false,
    note: null,
    // 版数 10（issue #275）で SchemaField に追加。ベンチの項目は全て単一引用
    maxQuotes: null,
    multiSelect: null,
  }));
}
