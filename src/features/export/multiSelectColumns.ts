// buildStudyWideCsv から呼ぶ、複数選択 enum の選択肢列・自由記述列の生成と値の展開。
// 選択値の判定規則は src/domain/multiSelect.ts を正典とし、列名の衝突回避と CSV 用の変換を担う。
import { NOT_REPORTED_TOKEN } from '../../domain/annotation';
import { isMultiSelectField, multiSelectConfigOf, parseMultiSelectValue, splitPipeList } from '../../domain/multiSelect';
import type { SchemaField } from '../../domain/schemaField';

export interface MultiSelectColumn {
  name: string;
  option: string;
  text: boolean;
}

/** ヘッダ全体の使用済み名を更新しながら、選択肢と説明の列を作る。 */
export function buildMultiSelectColumns(field: SchemaField, used: Set<string>): MultiSelectColumn[] {
  const config = multiSelectConfigOf(field);
  if (config === null || !isMultiSelectField(field)) return [];
  const columns: MultiSelectColumn[] = [];
  function add(base: string, option: string, text: boolean): void {
    let name = base;
    for (let suffix = 2; used.has(name); suffix++) name = `${base}_${suffix}`;
    used.add(name);
    columns.push({ name, option, text });
  }
  splitPipeList(field.allowedValues).forEach((option, index) => {
    const slug = option.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || `opt${index + 1}`;
    const base = `${field.fieldName}__${slug}`;
    add(base, option, false);
    if (config.freeTextValues.includes(option)) add(`${base}_text`, option, true);
  });
  return columns;
}

/** 未検証と NR を空欄に保ち、それ以外の選択状態を 1/0 に展開する。 */
export function multiSelectColumnValues(field: SchemaField, value: string | null, columns: readonly MultiSelectColumn[]): string[] {
  const selected = parseMultiSelectValue(field, value);
  return columns.map((column) => {
    if (value === null || value === '' || value === NOT_REPORTED_TOKEN) return '';
    const item = selected.find((element) => element.option === column.option);
    return column.text ? item?.text ?? '' : item === undefined ? '0' : '1';
  });
}
