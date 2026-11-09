// スキーマの CSV 書き出し・読み込み（issue #469）。確定済みの版を 1 行 1 項目の CSV にし、
// Excel などで編集・並び替えたものを読み戻す純関数群。DOM・store・ネットワークには依存しない。
// 列は SchemaFields の列のうち版をまたいで意味を持つもの（JSON 書き出し #316 と同じ範囲）。
// 読み込みは見出し名で列を照合するため、列の順は問わず、知らない列（シート側のメモ列など）は無視する。
// 行の順がそのまま項目の順になる
import { multiSelectConfigOf } from '../../domain/multiSelect';
import type { EntityLevel, FieldDataType, SchemaField } from '../../domain/schemaField';
import { buildCsv, CSV_BOM } from '../export/csvEncode';
import { parseCsv } from '../export/parseCsv';
import { SchemaImportError } from './schemaTransfer';
import type { SchemaEditorRow } from './types';
import { validateEditorRows } from './validateField';

/** CSV の列（書き出しの順）。読み込みは見出し名で照合する */
export const SCHEMA_CSV_COLUMNS = [
  'section',
  'field_name',
  'field_label',
  'entity_level',
  'data_type',
  'unit',
  'allowed_values',
  'required',
  'extraction_instruction',
  'example',
  'note',
  'max_quotes',
  'multi_select',
  'exclusive_values',
  'free_text_values',
] as const;

type SchemaCsvColumn = (typeof SCHEMA_CSV_COLUMNS)[number];

/** 読み込みに必須の列（無ければファイル全体を拒否する） */
export const SCHEMA_CSV_REQUIRED_COLUMNS: readonly SchemaCsvColumn[] = [
  'section',
  'field_name',
  'field_label',
  'entity_level',
  'data_type',
  'extraction_instruction',
];

const ENTITY_LEVELS: readonly EntityLevel[] = ['study', 'arm', 'outcome_result', 'rob_domain'];
const DATA_TYPES: readonly FieldDataType[] = ['text', 'integer', 'float', 'boolean', 'enum', 'date'];
const TRUE_VALUES = new Set(['true', '1', 'yes', 'y', 'はい']);
const FALSE_VALUES = new Set(['false', '0', 'no', 'n', 'いいえ', '']);

/** 確定済みの版の項目を CSV にする（field_index の順。Excel 向けに UTF-8 BOM 付き・CRLF） */
export function serializeSchemaCsv(fields: readonly SchemaField[]): string {
  const rows = [...fields]
    .sort((a, b) => a.fieldIndex - b.fieldIndex)
    .map((field) => {
      const config = multiSelectConfigOf(field);
      const record: Record<SchemaCsvColumn, string> = {
        section: field.section,
        field_name: field.fieldName,
        field_label: field.fieldLabel,
        entity_level: field.entityLevel,
        data_type: field.dataType,
        unit: field.unit ?? '',
        allowed_values: field.allowedValues ?? '',
        required: field.required ? 'TRUE' : 'FALSE',
        extraction_instruction: field.extractionInstruction,
        example: field.example ?? '',
        note: field.note ?? '',
        max_quotes: field.maxQuotes === null ? '' : String(field.maxQuotes),
        multi_select: config === null ? 'FALSE' : 'TRUE',
        exclusive_values: config === null ? '' : config.exclusiveValues.join('|'),
        free_text_values: config === null ? '' : config.freeTextValues.join('|'),
      };
      return SCHEMA_CSV_COLUMNS.map((column) => record[column]);
    });
  return `${CSV_BOM}${buildCsv(SCHEMA_CSV_COLUMNS, rows)}`;
}

/** 文字コードの読み分けに使う TextDecoder の作り方（jsdom に無いためテストで差し替える） */
export type MakeTextDecoder = (label: string, options?: { fatal?: boolean }) => { decode(input: Uint8Array): string };

const defaultMakeDecoder: MakeTextDecoder = (label, options) => new TextDecoder(label, options);

/**
 * CSV のバイト列を文字列にする。UTF-8（BOM の有無は問わない）として読めなければ Shift_JIS で読む
 * （Excel の「CSV（コンマ区切り）」は日本語環境で Shift_JIS になるため）
 */
export function decodeSchemaCsv(bytes: Uint8Array, makeDecoder: MakeTextDecoder = defaultMakeDecoder): string {
  // TextDecoder は既定で先頭の BOM を取り除く
  try {
    return makeDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return makeDecoder('shift_jis').decode(bytes);
  }
}

/** 真偽値のセルを読む（空は FALSE）。読めなければ null */
function parseBool(value: string): boolean | null {
  const normalized = value.trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) {
    return true;
  }
  return FALSE_VALUES.has(normalized) ? false : null;
}

function optional(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function invalidValue(row: number, column: SchemaCsvColumn, value: string, allowed: string): SchemaImportError {
  return new SchemaImportError('schema.importCsvInvalidValue', { row, column, value, allowed });
}

/** 見出し行から、既知の列の位置を求める（大文字小文字・前後の空白は無視） */
function resolveColumns(header: readonly string[]): Map<SchemaCsvColumn, number> {
  const known = new Set<string>(SCHEMA_CSV_COLUMNS);
  const positions = new Map<SchemaCsvColumn, number>();
  header.forEach((raw, index) => {
    const name = raw.trim().toLowerCase();
    if (!known.has(name)) {
      return;
    }
    const column = name as SchemaCsvColumn;
    if (positions.has(column)) {
      throw new SchemaImportError('schema.importCsvDuplicateColumn', { column });
    }
    positions.set(column, index);
  });
  const missing = SCHEMA_CSV_REQUIRED_COLUMNS.filter((column) => !positions.has(column));
  if (missing.length > 0) {
    throw new SchemaImportError('schema.importCsvMissingColumns', { columns: missing.join(', ') });
  }
  return positions;
}

/** 1 行をエディタ行にする。row は見出し行を 1 とした行番号（Excel の行番号と同じ） */
function toEditorRow(cells: readonly string[], positions: Map<SchemaCsvColumn, number>, row: number): SchemaEditorRow {
  const cell = (column: SchemaCsvColumn): string => {
    const index = positions.get(column);
    return index === undefined ? '' : (cells[index] ?? '');
  };
  const entityLevel = cell('entity_level').trim();
  if (!ENTITY_LEVELS.includes(entityLevel as EntityLevel)) {
    throw invalidValue(row, 'entity_level', entityLevel, ENTITY_LEVELS.join(' / '));
  }
  const dataType = cell('data_type').trim();
  if (!DATA_TYPES.includes(dataType as FieldDataType)) {
    throw invalidValue(row, 'data_type', dataType, DATA_TYPES.join(' / '));
  }
  const required = parseBool(cell('required'));
  if (required === null) {
    throw invalidValue(row, 'required', cell('required').trim(), 'TRUE / FALSE');
  }
  const multiSelect = parseBool(cell('multi_select'));
  if (multiSelect === null) {
    throw invalidValue(row, 'multi_select', cell('multi_select').trim(), 'TRUE / FALSE');
  }
  const maxQuotesText = cell('max_quotes').trim();
  if (maxQuotesText !== '' && !/^\d+$/.test(maxQuotesText)) {
    throw invalidValue(row, 'max_quotes', maxQuotesText, '1, 2, 3 …');
  }
  return {
    fieldId: null,
    section: cell('section').trim(),
    fieldName: cell('field_name').trim(),
    fieldLabel: cell('field_label').trim(),
    entityLevel: entityLevel as EntityLevel,
    dataType: dataType as FieldDataType,
    unit: optional(cell('unit')),
    allowedValues: optional(cell('allowed_values')),
    required,
    extractionInstruction: cell('extraction_instruction').trim(),
    example: optional(cell('example')),
    aiGenerated: false,
    note: optional(cell('note')),
    maxQuotes: maxQuotesText === '' ? null : Number(maxQuotesText),
    multiSelect,
    exclusiveValues: multiSelect ? optional(cell('exclusive_values')) : null,
    freeTextValues: multiSelect ? optional(cell('free_text_values')) : null,
  };
}

/**
 * CSV（文字列にしたもの）を読み、エディタ行へ変換する。行の順がそのまま項目の順になる。
 * 全セルが空の行は読み飛ばす。1 行でも読めない・検証エラーがあればファイル全体を拒否する
 */
export function parseSchemaCsv(text: string): SchemaEditorRow[] {
  const records = parseCsv(text);
  const header = records[0];
  if (header === undefined) {
    throw new SchemaImportError('schema.importNoFields');
  }
  const positions = resolveColumns(header);
  const rows: SchemaEditorRow[] = [];
  const rowNumbers: number[] = [];
  records.slice(1).forEach((cells, index) => {
    if (cells.every((value) => value.trim() === '')) {
      return;
    }
    const rowNumber = index + 2;
    rows.push(toEditorRow(cells, positions, rowNumber));
    rowNumbers.push(rowNumber);
  });
  if (rows.length === 0) {
    throw new SchemaImportError('schema.importNoFields');
  }
  const errors = validateEditorRows(rows);
  const first = errors[0];
  if (first !== undefined) {
    throw new SchemaImportError('schema.importCsvValidation', {
      count: errors.length,
      row: rowNumbers[first.index] as number,
      message: first.message,
    });
  }
  return rows;
}
