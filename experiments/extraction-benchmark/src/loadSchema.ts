// snake_case の benchmark-schema.json → 本番 SchemaField 形状への変換（IMPLEMENTATION.md §7）。
// ここが唯一の"変換"作業。buildExtractDataUserPrompt / validateAiOutput は camelCase の
// SchemaField（追加フィールド込み）を要求するため、欠けている列は既定値で埋める
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { EntityLevel, FieldDataType, SchemaField } from '../../../src/domain/schemaField.js';
import { benchRoot } from './config.js';

interface RawField {
  field_id: string;
  field_name: string;
  entity_level: EntityLevel;
  data_type: FieldDataType;
  extraction_instruction: string;
}

interface RawSchema {
  schema_version: number;
  fields: RawField[];
}

export async function loadBenchmarkSchema(): Promise<SchemaField[]> {
  const raw = await readFile(path.join(benchRoot, 'schema', 'benchmark-schema.json'), 'utf8');
  const parsed = JSON.parse(raw) as RawSchema;
  return parsed.fields.map((f, i) => ({
    schemaVersion: parsed.schema_version,
    fieldId: f.field_id,
    fieldIndex: i, // 配列順 = プロンプト内の表示順
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
