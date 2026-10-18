// 実Chrome A/B用に、同一68項目を SchemaVersions / SchemaFields へ投入できるTSVを生成する。
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { benchRoot } from './config';
import { loadBenchmarkSchema } from './loadSchema';

function cell(value: string | number | boolean | null): string {
  if (value === null) return '';
  return String(value).replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
}

async function main(): Promise<void> {
  const fields = await loadBenchmarkSchema();
  const outDir = path.join(benchRoot, 'outputs', 'chrome-fixture-issue176');
  await mkdir(outDir, { recursive: true });
  const createdAt = new Date().toISOString();
  const versionRows = [
    ['schema_version', 'parent_version', 'protocol_version', 'created_by_type', 'created_at', 'created_by', 'note'],
    [1, null, 1, 'user_edit', createdAt, 'issue176-benchmark', 'issue #176 A/B共通68項目スキーマ'],
  ];
  const fieldHeader = [
    'schema_version', 'field_id', 'field_index', 'section', 'field_name', 'field_label',
    'entity_level', 'data_type', 'unit', 'allowed_values', 'required', 'extraction_instruction',
    'example', 'ai_generated', 'note',
  ];
  const fieldRows = fields.map((field) => [
    field.schemaVersion, field.fieldId, field.fieldIndex, field.section, field.fieldName,
    field.fieldLabel, field.entityLevel, field.dataType, field.unit, field.allowedValues,
    field.required, field.extractionInstruction, field.example, field.aiGenerated, field.note,
  ]);
  await writeFile(
    path.join(outDir, 'SchemaVersions.tsv'),
    versionRows.map((row) => row.map(cell).join('\t')).join('\n'),
    'utf8',
  );
  await writeFile(
    path.join(outDir, 'SchemaFields.tsv'),
    [fieldHeader, ...fieldRows].map((row) => row.map(cell).join('\t')).join('\n'),
    'utf8',
  );
  console.log(`Chrome確認用TSVを生成しました: ${outDir}（fields=${fields.length}）`);
}

await main();
