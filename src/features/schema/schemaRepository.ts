// SchemaVersions / SchemaFields タブの読み書き（requirements.md §3.2）。
// 追記型・上書き禁止: 版の確定は常に新しい schema_version の行群を追記する
import type { SchemaField, EntityLevel, FieldDataType } from '../../domain/schemaField';
import type { SchemaCreatedByType, SchemaVersion } from '../../domain/schemaVersion';
import { SHEET_HEADERS } from '../../domain/sheetsSchema';
import { appendRow, appendRows, getBatchValues, getSheetValues, updateRow } from '../../lib/google/sheets';
import type { GoogleApiDeps } from '../../lib/google/types';

const VERSIONS_HEADER = SHEET_HEADERS.SchemaVersions;
const FIELDS_HEADER = SHEET_HEADERS.SchemaFields;

/**
 * 既存 SchemaVersions タブから次に書き込むべき版番号（既存最大 + 1、無ければ 1）を返す。
 */
export async function getNextSchemaVersion(
  spreadsheetId: string,
  deps: GoogleApiDeps,
): Promise<number> {
  const rows = await getSheetValues(spreadsheetId, 'SchemaVersions', deps);
  if (rows.length <= 1) {
    return 1;
  }
  const versionIdx = VERSIONS_HEADER.indexOf('schema_version');
  let max = 0;
  for (let i = 1; i < rows.length; i += 1) {
    const cell = rows[i]?.[versionIdx];
    const n = Number.parseInt(cell ?? '', 10);
    if (Number.isFinite(n) && n > max) {
      max = n;
    }
  }
  return max + 1;
}

/** SchemaVersions タブに 1 行追記する。列順は SHEET_HEADERS.SchemaVersions に固定 */
export async function appendSchemaVersion(
  spreadsheetId: string,
  version: SchemaVersion,
  deps: GoogleApiDeps,
): Promise<void> {
  const map: Record<string, string | number | boolean | null> = {
    schema_version: version.schemaVersion,
    parent_version: version.parentVersion,
    protocol_version: version.protocolVersion,
    created_by_type: version.createdByType,
    created_at: version.createdAt,
    created_by: version.createdBy,
    note: version.note,
  };
  await appendRow(spreadsheetId, 'SchemaVersions', VERSIONS_HEADER.map((key) => map[key] ?? null), deps);
}

/** SchemaFields タブへ項目行をまとめて追記する。列順は SHEET_HEADERS.SchemaFields に固定 */
export async function appendSchemaFields(
  spreadsheetId: string,
  fields: readonly SchemaField[],
  deps: GoogleApiDeps,
): Promise<void> {
  const [headerRows] = await getBatchValues(spreadsheetId, ['SchemaFields!1:1'], deps);
  let header = headerRows?.[0] ?? [];
  validateFieldsHeader(header);
  const needsHints = fields.some((field) =>
    field.locationHint !== null || field.rules !== null || field.hintSource !== null);
  if ((needsHints && header.length < 19) ||
      (fields.some((field) => field.maxQuotes !== null) && header.length === 15)) {
    header = [...FIELDS_HEADER];
    await updateRow(spreadsheetId, 'SchemaFields', 1, header, deps);
  }
  const rows = fields.map((field) => {
    const map: Record<string, string | number | boolean | null> = {
      schema_version: field.schemaVersion,
      field_id: field.fieldId,
      field_index: field.fieldIndex,
      section: field.section,
      field_name: field.fieldName,
      field_label: field.fieldLabel,
      entity_level: field.entityLevel,
      data_type: field.dataType,
      unit: field.unit,
      allowed_values: field.allowedValues,
      required: field.required,
      extraction_instruction: field.extractionInstruction,
      example: field.example,
      ai_generated: field.aiGenerated,
      note: field.note,
      max_quotes: field.maxQuotes,
      location_hint: field.locationHint,
      rules: field.rules,
      hint_source: field.hintSource,
    };
    return header.map((key) => map[key] ?? null);
  });
  await appendRows(spreadsheetId, 'SchemaFields', rows, deps);
}

/** SchemaVersions タブの全行を schema_version 降順で返す。1 件も無ければ [] */
export async function listSchemaVersions(
  spreadsheetId: string,
  deps: GoogleApiDeps,
): Promise<SchemaVersion[]> {
  const rows = await getSheetValues(spreadsheetId, 'SchemaVersions', deps);
  if (rows.length <= 1) {
    return [];
  }
  return rows
    .slice(1)
    .map(fromVersionRow)
    .sort((a, b) => b.schemaVersion - a.schemaVersion);
}

/** 指定版の SchemaFields 行一覧を field_index 昇順で返す。1 件も無ければ [] */
export async function getSchemaFieldsByVersion(
  spreadsheetId: string,
  schemaVersion: number,
  deps: GoogleApiDeps,
): Promise<SchemaField[]> {
  const rows = await getSheetValues(spreadsheetId, 'SchemaFields', deps);
  if (rows.length <= 1) {
    return [];
  }
  // 読み取りはヘッダを検証せず、名前が一致する列までを読む（想定外の列があっても
  // 既存プロジェクトを開けなくしない。ヘッダの検証は書き込み側だけで行う）
  const columns = readableFieldColumns(rows[0] as string[]);
  const versionIdx = FIELDS_HEADER.indexOf('schema_version');
  const result: SchemaField[] = [];
  for (const row of rows.slice(1)) {
    const cell = row[versionIdx] ?? '';
    if (Number.parseInt(cell, 10) === schemaVersion) {
      result.push(fromFieldRow(row.slice(0, columns)));
    }
  }
  return result.sort((a, b) => a.fieldIndex - b.fieldIndex);
}

function fromVersionRow(row: readonly string[]): SchemaVersion {
  const cell = (key: string): string => {
    const idx = VERSIONS_HEADER.indexOf(key);
    /* istanbul ignore if -- 呼び出しは固定キーのみ */
    if (idx < 0) return '';
    return row[idx] ?? '';
  };
  const schemaVersion = Number.parseInt(cell('schema_version'), 10);
  const parentVersion = Number.parseInt(cell('parent_version'), 10);
  const protocolVersion = Number.parseInt(cell('protocol_version'), 10);
  return {
    schemaVersion: Number.isFinite(schemaVersion) ? schemaVersion : 0,
    parentVersion: Number.isFinite(parentVersion) ? parentVersion : null,
    protocolVersion: Number.isFinite(protocolVersion) ? protocolVersion : 0,
    createdByType: parseCreatedByType(cell('created_by_type')),
    createdAt: cell('created_at'),
    createdBy: cell('created_by'),
    note: emptyToNull(cell('note')),
  };
}

function fromFieldRow(row: readonly string[]): SchemaField {
  const cell = (key: string): string => {
    const idx = FIELDS_HEADER.indexOf(key);
    /* istanbul ignore if -- 呼び出しは固定キーのみ */
    if (idx < 0) return '';
    return row[idx] ?? '';
  };
  const locationHint = emptyToNull(cell('location_hint'));
  const rules = emptyToNull(cell('rules'));
  const source = cell('hint_source');
  const hintSource = locationHint === null && rules === null ? null
    : source === 'ai' || source === 'ai_edited' ? source : 'human';
  const fieldIndex = Number.parseInt(cell('field_index'), 10);
  return {
    // 呼び出し元（getSchemaFieldsByVersion）が version 一致行だけを渡すため必ず数値
    schemaVersion: Number.parseInt(cell('schema_version'), 10),
    fieldId: cell('field_id'),
    locationHint,
    rules,
    hintSource,
    fieldIndex: Number.isFinite(fieldIndex) ? fieldIndex : 0,
    section: cell('section'),
    fieldName: cell('field_name'),
    fieldLabel: cell('field_label'),
    entityLevel: parseEntityLevel(cell('entity_level')),
    dataType: parseDataType(cell('data_type')),
    unit: emptyToNull(cell('unit')),
    allowedValues: emptyToNull(cell('allowed_values')),
    required: toBool(cell('required')),
    extractionInstruction: cell('extraction_instruction'),
    example: emptyToNull(cell('example')),
    aiGenerated: toBool(cell('ai_generated')),
    note: emptyToNull(cell('note')),
    maxQuotes: cell('max_quotes').trim() !== '' && Number.isInteger(Number(cell('max_quotes')))
      ? Number(cell('max_quotes')) : null,
  };
}

function emptyToNull(value: string): string | null {
  return value === '' ? null : value;
}

/** Sheets は boolean を 'TRUE'/'FALSE' 文字列として返す（RAW 書き込み時の素通りも考慮） */
function toBool(value: string): boolean {
  return String(value).toUpperCase() === 'TRUE';
}

function parseCreatedByType(value: string): SchemaCreatedByType {
  return value === 'user_edit' || value === 'pilot_revision' ? value : 'ai_draft';
}

function parseEntityLevel(value: string): EntityLevel {
  return value === 'arm' || value === 'outcome_result' || value === 'rob_domain'
    ? value
    : 'study';
}

function parseDataType(value: string): FieldDataType {
  return ['integer', 'float', 'boolean', 'enum', 'date'].includes(value)
    ? (value as FieldDataType)
    : 'text';
}

/** 読み取りに使う列数。ヒント 3 列がそろっていれば 19、max_quotes までなら 16、それ以外は 15 */
function readableFieldColumns(header: readonly string[]): number {
  if (FIELDS_HEADER.slice(15).every((name, offset) => header[15 + offset] === name)) {
    return FIELDS_HEADER.length;
  }
  return header[15] === 'max_quotes' ? 16 : 15;
}

/** 新しいヒント列は一括追加のため、部分的なヘッダは受け入れない。 */
function validateFieldsHeader(header: readonly string[]): void {
  FIELDS_HEADER.slice(0, Math.max(15, header.length)).forEach((name, index) => {
    if (header[index] !== name) {
      throw new Error(`SchemaFields のヘッダ ${index + 1} 列目が "${name}" ではありません`);
    }
  });
  if (![15, 16, 19].includes(header.length)) {
    throw new Error('SchemaFields のヘッダは 15・16・19 列のいずれかである必要があります');
  }
}
