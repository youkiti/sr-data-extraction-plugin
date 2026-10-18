// fields.ts（正典）→ schema/benchmark-schema.json（loadSchema.ts が読む形状）。
// 既存 extraction-benchmark と同じ { schema_version, fields:[{field_id, field_name, entity_level,
// data_type, extraction_instruction}] } 形式で書き出す。
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { benchRoot } from './config';
import { ALL_FIELDS } from './fields';

const SCHEMA_VERSION = 1;

async function main(): Promise<void> {
  const fields = ALL_FIELDS.map((f) => ({
    field_id: f.fieldId,
    field_name: f.fieldId,
    entity_level: f.entityLevel,
    data_type: f.dataType,
    extraction_instruction: f.extractionInstruction,
  }));

  // field_id の重複チェック（gold との突合が壊れるため）
  const seen = new Set<string>();
  for (const f of fields) {
    if (seen.has(f.field_id)) throw new Error(`field_id が重複しています: ${f.field_id}`);
    seen.add(f.field_id);
  }

  const outDir = path.join(benchRoot, 'schema');
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, 'benchmark-schema.json');
  await writeFile(outPath, JSON.stringify({ schema_version: SCHEMA_VERSION, fields }, null, 2), 'utf8');
  console.log(`schema 生成: ${fields.length} 項目 -> ${path.relative(benchRoot, outPath)}`);
  const study = fields.filter((f) => f.entity_level === 'study').length;
  const arm = fields.filter((f) => f.entity_level === 'arm').length;
  console.log(`  study 級 ${study} / arm 級 ${arm}`);
}

await main();
