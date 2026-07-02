// SchemaVersions / SchemaFields タブの読み書き（requirements.md §3.2）。
// 追記型・上書き禁止: 版の確定は常に新しい schema_version の行群を追記する
import type { SchemaField, EntityLevel, FieldDataType } from '../../domain/schemaField';
import type { SchemaCreatedByType, SchemaVersion } from '../../domain/schemaVersion';
import { SHEET_HEADERS } from '../../domain/sheetsSchema';
import { appendRow, appendRows, getSheetValues } from '../../lib/google/sheets';
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
    };
    return FIELDS_HEADER.map((key) => map[key] ?? null);
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
  const versionIdx = FIELDS_HEADER.indexOf('schema_version');
  const result: SchemaField[] = [];
  for (const row of rows.slice(1)) {
    const cell = row[versionIdx] ?? '';
    if (Number.parseInt(cell, 10) === schemaVersion) {
      result.push(fromFieldRow(row));
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
  const fieldIndex = Number.parseInt(cell('field_index'), 10);
  return {
    // 呼び出し元（getSchemaFieldsByVersion）が version 一致行だけを渡すため必ず数値
    schemaVersion: Number.parseInt(cell('schema_version'), 10),
    fieldId: cell('field_id'),
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
