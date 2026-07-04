// ゴールドスタンダード JSON のフォーマット検証（IMPLEMENTATION.md §3）。
// gold/{pdf_id}.json はドメインエキスパート（ユーザー）が手作業で作成する（README.md §6.3 が正典）。
// このスクリプトは採点（score.ts）を壊れたゴールドで走らせないための受け入れ検査
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseEntityKey } from '../../../src/utils/entityKey.js';
import { benchRoot } from './config.js';
import { loadBenchmarkSchema } from './loadSchema.js';

/** 検証対象は unknown のまま受け取り、型ガードで 1 件ずつ確認する */
interface GoldRowLike {
  field_id?: unknown;
  entity_key?: unknown;
  not_reported?: unknown;
  value_gold?: unknown;
  acceptable_values?: unknown;
}

interface GoldFileLike {
  pdf_id?: unknown;
  schema_version?: unknown;
  rows?: unknown;
}

interface Violation {
  file: string;
  /** ファイル全体レベルの違反は null */
  rowIndex: number | null;
  message: string;
}

async function validateFile(
  fileName: string,
  fields: Awaited<ReturnType<typeof loadBenchmarkSchema>>,
): Promise<Violation[]> {
  const violations: Violation[] = [];
  const filePath = path.join(benchRoot, 'gold', fileName);
  const raw = await readFile(filePath, 'utf8');

  let parsed: GoldFileLike;
  try {
    parsed = JSON.parse(raw) as GoldFileLike;
  } catch (error) {
    violations.push({ file: fileName, rowIndex: null, message: `JSON パース不能: ${String(error)}` });
    return violations;
  }

  if (typeof parsed.pdf_id !== 'string' || parsed.pdf_id === '') {
    violations.push({ file: fileName, rowIndex: null, message: 'pdf_id が文字列で存在しません' });
  }
  if (typeof parsed.schema_version !== 'number') {
    violations.push({ file: fileName, rowIndex: null, message: 'schema_version が数値で存在しません' });
  }
  if (!Array.isArray(parsed.rows)) {
    violations.push({ file: fileName, rowIndex: null, message: 'rows が配列で存在しません' });
    return violations;
  }

  const fieldById = new Map(fields.map((f) => [f.fieldId, f]));

  parsed.rows.forEach((rowUnknown, index) => {
    const row = rowUnknown as GoldRowLike;
    const prefix = `row[${index}]`;

    if (typeof row.field_id !== 'string' || row.field_id === '') {
      violations.push({ file: fileName, rowIndex: index, message: `${prefix}: field_id が文字列で存在しません` });
      return; // field 依存のチェックはこれ以上できないので打ち切り
    }
    if (typeof row.entity_key !== 'string' || row.entity_key === '') {
      violations.push({ file: fileName, rowIndex: index, message: `${prefix}: entity_key が文字列で存在しません` });
    }
    if (typeof row.not_reported !== 'boolean') {
      violations.push({ file: fileName, rowIndex: index, message: `${prefix}: not_reported が boolean で存在しません` });
    }

    const field = fieldById.get(row.field_id);
    if (field === undefined) {
      violations.push({
        file: fileName,
        rowIndex: index,
        message: `${prefix}: field_id "${row.field_id}" が schema/benchmark-schema.json に存在しません`,
      });
    }

    if (row.not_reported === false && (row.value_gold === null || row.value_gold === undefined)) {
      violations.push({
        file: fileName,
        rowIndex: index,
        message: `${prefix}: not_reported=false なのに value_gold が null です`,
      });
    }
    if (row.not_reported === true && row.value_gold !== null && row.value_gold !== undefined) {
      violations.push({
        file: fileName,
        rowIndex: index,
        message: `${prefix}: not_reported=true なのに value_gold が null ではありません`,
      });
    }

    if (typeof row.entity_key === 'string') {
      const parsedKey = parseEntityKey(row.entity_key);
      if (parsedKey === null) {
        violations.push({
          file: fileName,
          rowIndex: index,
          message: `${prefix}: entity_key "${row.entity_key}" の形式が不正です（requirements.md §3.3 参照）`,
        });
      } else if (field !== undefined && parsedKey.level !== field.entityLevel) {
        violations.push({
          file: fileName,
          rowIndex: index,
          message:
            `${prefix}: entity_key "${row.entity_key}"（level=${parsedKey.level}）が ` +
            `field "${row.field_id}" の entity_level "${field.entityLevel}" と整合しません`,
        });
      }
    }
  });

  return violations;
}

async function main(): Promise<void> {
  const goldDir = path.join(benchRoot, 'gold');
  let files: string[];
  try {
    files = (await readdir(goldDir)).filter((f) => f.endsWith('.json'));
  } catch {
    files = [];
  }
  if (files.length === 0) {
    console.log('gold/ にゴールドスタンダード JSON がまだありません（未着）。検証はスキップします。');
    return; // ゴールド未着はエラー扱いにしない（IMPLEMENTATION.md §3）
  }

  const fields = await loadBenchmarkSchema();
  const allViolations: Violation[] = [];
  for (const file of files) {
    allViolations.push(...(await validateFile(file, fields)));
  }

  if (allViolations.length > 0) {
    console.error(`ゴールドスタンダードの検証で ${allViolations.length} 件の違反が見つかりました:`);
    for (const v of allViolations) {
      console.error(`  [${v.file}]${v.rowIndex !== null ? ` row=${v.rowIndex}` : ''} ${v.message}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`gold/ の ${files.length} 件のファイルを検証しました。違反なし。`);
}

await main();
