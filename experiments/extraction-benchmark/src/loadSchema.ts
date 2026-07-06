// benchmark-schema.json（snake_case）→ 本番 SchemaField（camelCase + 追加フィールド）への変換。
// buildExtractDataUserPrompt / validateAiOutput が受ける形状に既定値で埋める（IMPLEMENTATION.md §7）。
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

export async function loadBenchmarkSchema(): Promise<SchemaField[]> {
  const raw = await readFile(path.join(benchRoot, 'schema', 'benchmark-schema.json'), 'utf8');
  const parsed = JSON.parse(raw) as { schema_version: number; fields: RawField[] };
  return parsed.fields.map((f, i) => ({
    schemaVersion: parsed.schema_version,
    fieldId: f.field_id,
    fieldIndex: i, // 配列順 = 表示順
    section: '', // ベンチマークでは未使用
    fieldName: f.field_name,
    fieldLabel: f.field_name, // 表示名は未使用なので field_name を流用
    entityLevel: f.entity_level,
    dataType: f.data_type,
    unit: null,
    allowedValues: null,
    required: true,
    extractionInstruction: f.extraction_instruction,
    example: null,
    aiGenerated: false,
    note: null,
  }));
}
