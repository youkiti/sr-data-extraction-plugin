// スキーマエディタ行のバリデーション（ui-states.md §3「編集中」:
// field_name の snake_case・重複エラーほか）。「版として確定」前に全行を検査する
import { STUDY_DATA_FIXED_HEADERS } from '../../domain/sheetsSchema';
import type { SchemaEditorRow } from './types';

/** 1 件のバリデーションエラー。column はエディタの該当セル強調に使う */
export interface FieldValidationError {
  /** エディタ行の 0 始まり index */
  index: number;
  column: 'fieldName' | 'fieldLabel' | 'section' | 'allowedValues' | 'extractionInstruction';
  message: string;
}

/** CSV 列名になれる snake_case（先頭は英小文字） */
const FIELD_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

/** StudyData の固定列（衝突すると buildStudyDataHeader が落ちる。domain/sheetsSchema.ts） */
const RESERVED_FIELD_NAMES = new Set<string>(STUDY_DATA_FIXED_HEADERS);

/**
 * エディタ全行を検証してエラー一覧を返す（空配列 = 確定可能）。
 * 行単位の必須・形式チェックに加えて、field_name の行間重複も検出する
 */
export function validateEditorRows(rows: readonly SchemaEditorRow[]): FieldValidationError[] {
  const errors: FieldValidationError[] = [];

  const nameCounts = new Map<string, number>();
  for (const row of rows) {
    const name = row.fieldName.trim();
    if (name !== '') {
      nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
    }
  }

  rows.forEach((row, index) => {
    const name = row.fieldName.trim();
    if (name === '') {
      errors.push({ index, column: 'fieldName', message: 'field_name は必須です' });
    } else if (!FIELD_NAME_PATTERN.test(name)) {
      errors.push({
        index,
        column: 'fieldName',
        message: 'field_name は snake_case（英小文字始まり・英数と _ のみ）にしてください',
      });
    } else if (RESERVED_FIELD_NAMES.has(name)) {
      errors.push({
        index,
        column: 'fieldName',
        message: `"${name}" は StudyData の固定列名のため使えません`,
      });
      // 空でない name は直前のループで必ずカウント済み
    } else if ((nameCounts.get(name) as number) > 1) {
      errors.push({ index, column: 'fieldName', message: `field_name "${name}" が重複しています` });
    }

    if (row.fieldLabel.trim() === '') {
      errors.push({ index, column: 'fieldLabel', message: 'field_label は必須です' });
    }
    if (row.section.trim() === '') {
      errors.push({ index, column: 'section', message: 'section は必須です' });
    }
    if (row.extractionInstruction.trim() === '') {
      errors.push({
        index,
        column: 'extractionInstruction',
        message: 'extraction_instruction は必須です',
      });
    }

    if (row.dataType === 'enum') {
      const values = (row.allowedValues ?? '').split('|').map((value) => value.trim());
      if (row.allowedValues === null || values.some((value) => value === '') || values.length < 2) {
        errors.push({
          index,
          column: 'allowedValues',
          message: 'data_type = enum は許容値（| 区切りで 2 つ以上）が必須です',
        });
      }
    } else if (row.allowedValues !== null && row.allowedValues.trim() !== '') {
      errors.push({
        index,
        column: 'allowedValues',
        message: '許容値は data_type = enum のときだけ指定できます',
      });
    }
  });

  return errors;
}
