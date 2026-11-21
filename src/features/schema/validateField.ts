// スキーマエディタ行のバリデーション（ui-states.md §3「編集中」:
// field_name の snake_case・重複エラーほか）。「版として確定」前に全行を検査する
import { splitPipeList } from '../../domain/multiSelect';
import { NOT_REPORTED_TOKEN } from '../../domain/annotation';
import { t } from '../../lib/i18n';
import { STUDY_DATA_FIXED_HEADERS } from '../../domain/sheetsSchema';
import { MA_KEY_HEADER, TAB1_KEY_HEADER } from '../../domain/rsetColumns';
import type { SchemaEditorRow } from './types';

/** 1 件のバリデーションエラー。column はエディタの該当セル強調に使う */
export interface FieldValidationError {
  /** エディタ行の 0 始まり index */
  index: number;
  column: 'fieldName' | 'fieldLabel' | 'section' | 'allowedValues' | 'extractionInstruction' | 'max_quotes' | 'multiSelect' | 'exclusiveValues' | 'freeTextValues';
  message: string;
}

/** CSV 列名になれる snake_case（先頭は英小文字） */
const FIELD_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

/** StudyData の固定列（衝突すると buildStudyDataHeader が落ちる。domain/sheetsSchema.ts） */
const RESERVED_FIELD_NAMES = new Set<string>(STUDY_DATA_FIXED_HEADERS);
const MA_KEY_NAMES = new Set<string>(MA_KEY_HEADER);
const TAB1_KEY_NAMES = new Set<string>(TAB1_KEY_HEADER);

/** 追加の予約名は ma.csv の outcome_result と tab1.csv の study の項目に限る。 */
export function reservedFieldNameReason(
  name: string,
  entityLevel: SchemaEditorRow['entityLevel'],
): 'study_data' | 'ma_key' | 'tab1_key' | null {
  if (RESERVED_FIELD_NAMES.has(name)) {
    return 'study_data';
  }
  if (entityLevel === 'outcome_result' && MA_KEY_NAMES.has(name)) {
    return 'ma_key';
  }
  return entityLevel === 'study' && TAB1_KEY_NAMES.has(name) ? 'tab1_key' : null;
}

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
    const reservedReason = reservedFieldNameReason(name, row.entityLevel);
    if (name === '') {
      errors.push({ index, column: 'fieldName', message: 'field_name は必須です' });
    } else if (!FIELD_NAME_PATTERN.test(name)) {
      errors.push({
        index,
        column: 'fieldName',
        message: 'field_name は snake_case（英小文字始まり・英数と _ のみ）にしてください',
      });
    } else if (reservedReason !== null) {
      errors.push({
        index,
        column: 'fieldName',
        message:
          {
            study_data: `"${name}" はシステムが使う StudyData の固定列名のため項目名に使えません。`,
            ma_key: `"${name}" は R セットの ma.csv のキー列名のため、アウトカムの結果の項目名に使えません。`,
            tab1_key: `"${name}" は R セットの tab1.csv のキー列名のため、研究単位（study）の項目名に使えません。`,
          }[reservedReason] +
          `別名（例: "${name}_reported"）へ変更してください`,
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

    if (row.maxQuotes !== null) {
      if (row.dataType !== 'text') {
        errors.push({ index, column: 'max_quotes', message: t('schema.maxQuotesTextOnly') });
      }
      if (!Number.isInteger(row.maxQuotes) || row.maxQuotes < 2 || row.maxQuotes > 20) {
        errors.push({ index, column: 'max_quotes', message: t('schema.maxQuotesRange') });
      }
    }

    const allowed = splitPipeList(row.allowedValues);
    const exclusive = splitPipeList(row.exclusiveValues);
    const freeText = splitPipeList(row.freeTextValues);
    if (row.multiSelect && row.dataType !== 'enum') {
      errors.push({ index, column: 'multiSelect', message: t('schema.multiSelectEnumOnly') });
    } else if (!row.multiSelect) {
      for (const column of ['exclusiveValues', 'freeTextValues'] as const) {
        if ((row[column] ?? '').trim() !== '') {
          errors.push({ index, column, message: t('schema.multiSelectRequired') });
        }
      }
    } else {
      for (const column of ['exclusiveValues', 'freeTextValues'] as const) {
        if (splitPipeList(row[column]).some((value) => !allowed.includes(value))) {
          errors.push({ index, column, message: t('schema.multiSelectUnknown') });
        }
      }
      if (freeText.some((value) => exclusive.includes(value))) {
        errors.push({ index, column: 'freeTextValues', message: t('schema.multiSelectOverlap') });
      }
      if (allowed.includes(NOT_REPORTED_TOKEN)) {
        errors.push({ index, column: 'allowedValues', message: t('schema.multiSelectNr') });
      }
      if (allowed.some((value) => freeText.some((ft) => value.startsWith(`${ft}: `)))) {
        errors.push({ index, column: 'allowedValues', message: t('schema.multiSelectAmbiguous') });
      }
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
