// data_dictionary.csv（issue #60 design-r-export.md §2）: 1 行 = 1 スキーマ項目。
// エクスポートに使う最新確定版の SchemaFields 全項目を、CSV 列名（field_name）↔ field_id の
// 対応表を兼ねて出力する（R 側の型付け・列選択の正典）。ma.csv の rob_tool / rob_overall_judgement は
// SchemaFields に実在しない複製列のため、ここには出さず design-r-export.md の文書側で説明する
import type { SchemaField } from '../../../domain/schemaField';
import { buildCsv } from '../csvEncode';

export const DATA_DICTIONARY_HEADER = [
  'field_id',
  'field_name',
  'field_label',
  'section',
  'entity_level',
  'data_type',
  'unit',
  'allowed_values',
  'required',
  'extraction_instruction',
  'example',
  'schema_version',
] as const;

export interface DataDictionaryBuildResult {
  csv: string;
  rowCount: number;
}

export function buildDataDictionaryCsv(fields: readonly SchemaField[]): DataDictionaryBuildResult {
  const sorted = [...fields].sort((a, b) => a.fieldIndex - b.fieldIndex);
  const rows = sorted.map((field) => [
    field.fieldId,
    field.fieldName,
    field.fieldLabel,
    field.section,
    field.entityLevel,
    field.dataType,
    field.unit ?? '',
    field.allowedValues ?? '',
    String(field.required),
    field.extractionInstruction,
    field.example ?? '',
    String(field.schemaVersion),
  ]);
  return { csv: buildCsv(DATA_DICTIONARY_HEADER, rows), rowCount: rows.length };
}
