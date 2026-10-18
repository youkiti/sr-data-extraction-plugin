// 不眠 DE スキーマの正典（original_description_insomnia.json + analysis xlsx 列に基づく）。
// buildSchema.ts（schema/benchmark-schema.json 生成）と convertGold.ts（gold 生成）が共有する。
//
// - 数値変数（58 個）は numeric analysis xlsx の C6..C63 列に対応（順序も一致）。
// - 文字列変数（10 個）は string analysis xlsx の variable_name に対応。
// - entity_level: study（1 論文に 1 値）か arm（アーム別）か。
// - field_id は変数名を snake_case 正規化したもの（gold と schema で必ず一致させる）。
import { loadLocalConfig } from './localConfig';
import type { EntityLevel, FieldDataType } from '../../../src/domain/schemaField';

export interface FieldDef {
  /** analysis xlsx の生の変数名（列ヘッダ / variable_name） */
  rawName: string;
  fieldId: string;
  entityLevel: EntityLevel;
  dataType: FieldDataType;
  extractionInstruction: string;
}

/** 変数名 → field_id（snake_case・英数字と _ のみ） */
export function toFieldId(rawName: string): string {
  return rawName
    .trim()
    .replace(/%/g, 'percent')
    .replace(/[^0-9a-zA-Z]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase();
}

/** ローカル定義から同じ規則で項目 ID を生成する。 */
function fields(definitions: Array<Omit<FieldDef, 'fieldId'>>): FieldDef[] {
  return definitions.map((definition) => ({ ...definition, fieldId: toFieldId(definition.rawName) }));
}

export const STRING_FIELDS: FieldDef[] = fields(loadLocalConfig().fields.string);
export const NUMERIC_FIELDS: FieldDef[] = fields(loadLocalConfig().fields.numeric);

/** スキーマ全体（表示順: 文字列 → 数値）。 */
export const ALL_FIELDS: FieldDef[] = [...STRING_FIELDS, ...NUMERIC_FIELDS];
