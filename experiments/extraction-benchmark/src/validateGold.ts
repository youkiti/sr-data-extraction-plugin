// ゴールドスタンダード（gold/{pdf_id}.json）のフォーマット検証（README §6.3 / IMPLEMENTATION.md §3）。
// ドメインエキスパートが手作業で作る JSON なので、採点（score.ts）の前段で壊れた
// ゴールドを検出し、壊れたデータで採点が走らないようにする。
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEntityKey, STUDY_ENTITY_KEY } from '../../../src/utils/entityKey';
import { benchRoot, TARGETS } from './config';
import { loadBenchmarkSchema } from './loadSchema';

/** ゴールドスタンダード 1 行（README §6.3 の JSON スキーマ案） */
export interface GoldRow {
  field_id: string;
  entity_key: string;
  not_reported: boolean;
  value_gold: string | null;
  acceptable_values: string[];
  source_page: number | null;
  source_quote: string | null;
  note: string | null;
}

/** ゴールドスタンダード 1 論文分（gold/{pdf_id}.json のトップレベル） */
export interface GoldFile {
  pdf_id: string;
  pmcid: string;
  schema_version: number;
  created_by: string;
  created_at: string;
  rows: GoldRow[];
}

/**
 * ゴールドスタンダード JSON（パース済み・型不明の生オブジェクト）を検証する。
 * 例外は投げず、見つかったエラーを全て集めて返す（呼び出し側でまとめて報告するため）。
 *
 * @param gold ゴールドファイルを JSON.parse した結果（型未検証）
 * @param fieldLevelById ベンチマークスキーマの field_id → entity_level（validFieldIds はこの map の key から導出する）
 */
export async function validateGoldFile(
  gold: unknown,
  fieldLevelById: Map<string, string>,
): Promise<{ ok: boolean; errors: string[] }> {
  const errors: string[] = [];

  if (typeof gold !== 'object' || gold === null) {
    return { ok: false, errors: ['ゴールドファイルがオブジェクトではありません'] };
  }
  const g = gold as Record<string, unknown>;

  if (typeof g.pdf_id !== 'string') {
    errors.push('pdf_id が string ではありません');
  }
  if (typeof g.schema_version !== 'number') {
    errors.push('schema_version が number ではありません');
  }
  if (!Array.isArray(g.rows)) {
    errors.push('rows が配列ではありません');
    // rows が無ければ行単位の検証は続けられないためここで打ち切る
    return { ok: false, errors };
  }

  (g.rows as unknown[]).forEach((rawRow, index) => {
    const rowLabel = `rows[${index}]`;
    if (typeof rawRow !== 'object' || rawRow === null) {
      errors.push(`${rowLabel}: オブジェクトではありません`);
      return;
    }
    const row = rawRow as Record<string, unknown>;

    let fieldId: string | null = null;
    if (typeof row.field_id !== 'string') {
      errors.push(`${rowLabel}: field_id が string ではありません`);
    } else {
      fieldId = row.field_id;
    }

    let entityKey: string | null = null;
    if (typeof row.entity_key !== 'string') {
      errors.push(`${rowLabel}: entity_key が string ではありません`);
    } else {
      entityKey = row.entity_key;
    }

    let notReported: boolean | null = null;
    if (typeof row.not_reported !== 'boolean') {
      errors.push(`${rowLabel}: not_reported が boolean ではありません`);
    } else {
      notReported = row.not_reported;
    }

    let fieldLevel: string | undefined;
    if (fieldId !== null) {
      fieldLevel = fieldLevelById.get(fieldId);
      if (fieldLevel === undefined) {
        errors.push(`${rowLabel}: field_id "${fieldId}" がベンチマークスキーマに存在しません`);
      }
    }

    if (notReported === false) {
      if (typeof row.value_gold !== 'string' || row.value_gold.length === 0) {
        errors.push(`${rowLabel}: not_reported=false ですが value_gold が非空文字列ではありません`);
      }
    } else if (notReported === true) {
      if (row.value_gold !== null) {
        errors.push(`${rowLabel}: not_reported=true ですが value_gold が null ではありません`);
      }
    }

    if (row.acceptable_values !== undefined) {
      const av = row.acceptable_values;
      if (!Array.isArray(av) || av.some((v) => typeof v !== 'string')) {
        errors.push(`${rowLabel}: acceptable_values は string の配列である必要があります（省略時は [] 扱い）`);
      }
    }

    if (entityKey !== null) {
      const parsed = parseEntityKey(entityKey);
      if (parsed === null) {
        errors.push(`${rowLabel}: entity_key "${entityKey}" が requirements.md §3.3 の形式に一致しません`);
      } else if (fieldLevel !== undefined) {
        if (fieldLevel === 'study') {
          // study レベルは entity_key が STUDY_ENTITY_KEY 固定（1 document に 1 インスタンス）
          if (entityKey !== STUDY_ENTITY_KEY) {
            errors.push(
              `${rowLabel}: study レベルの entity_key は "${STUDY_ENTITY_KEY}" である必要があります（実際: "${entityKey}"）`,
            );
          }
        } else if (parsed.level !== fieldLevel) {
          errors.push(
            `${rowLabel}: entity_key のレベル "${parsed.level}" がフィールド "${fieldId}" のレベル "${fieldLevel}" と一致しません`,
          );
        }
      }
    }
  });

  return { ok: errors.length === 0, errors };
}

/**
 * TARGETS（README §6.1 の対象論文）の全 pdfId について gold/{pdfId}.json を読み込み・検証する。
 * - ファイル未着（作成中）は console.warn するだけで例外にしない（存在するものだけ返す）。
 * - 存在するファイルに検証エラーがあれば console.error で全件報告し、例外を投げて採点をブロックする。
 */
export async function validateAllGold(): Promise<Map<string, GoldFile>> {
  const fields = await loadBenchmarkSchema();
  const fieldLevelById = new Map<string, string>(fields.map((f) => [f.fieldId, f.entityLevel]));

  const result = new Map<string, GoldFile>();
  let hasErrors = false;

  for (const target of TARGETS) {
    const filePath = path.join(benchRoot, 'gold', `${target.pdfId}.json`);
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf8');
    } catch {
      console.warn(`ゴールドスタンダードが見つかりません（未作成としてスキップ）: ${filePath}`);
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      hasErrors = true;
      console.error(`ゴールドスタンダードの JSON パースに失敗しました: ${filePath}`);
      console.error(`  - ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }

    const { ok, errors } = await validateGoldFile(parsed, fieldLevelById);
    if (!ok) {
      hasErrors = true;
      console.error(`ゴールドスタンダードの検証エラー: ${filePath}`);
      for (const err of errors) {
        console.error(`  - ${err}`);
      }
      continue;
    }

    result.set(target.pdfId, parsed as GoldFile);
  }

  if (hasErrors) {
    throw new Error('ゴールドスタンダードの検証に失敗しました');
  }

  return result;
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  await validateAllGold()
    .then((gold) => {
      console.log('=== ゴールドスタンダードの検証結果 ===');
      if (gold.size === 0) {
        console.log('ゴールドファイルが 1 件も見つかりませんでした（gold/ に {pdfId}.json を作成してください）');
        return;
      }
      for (const [pdfId, file] of gold) {
        console.log(`  ${pdfId}: ${file.rows.length} 行`);
      }
      console.log('検証 OK');
    })
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    });
}
