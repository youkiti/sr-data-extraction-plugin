// スキーマの書き出し・読み込み（issue #316）。確定済みの版を JSON 1 ファイルにし、
// 別のプロジェクトで読み戻せるようにする純関数群。DOM・store・ネットワークには依存しない。
// field_id・schema_version・ai_generated は書き出さない（読み込み先で振り直す。
// 既存項目との突き合わせは field_name で行う — redraftDiff.ts の buildImportDiff）
import { multiSelectConfigOf } from '../../domain/multiSelect';
import type { EntityLevel, FieldDataType, SchemaField } from '../../domain/schemaField';
import { t, type MessageKey } from '../../lib/i18n';
import type { SchemaEditorRow } from './types';
import { validateEditorRows } from './validateField';

export const SCHEMA_EXPORT_FORMAT = 'sr-data-extraction-schema';
export const SCHEMA_EXPORT_FORMAT_VERSION = 1;
/** 読み込むファイルの大きさの上限（バイト） */
export const SCHEMA_IMPORT_MAX_BYTES = 1024 * 1024;

/** 書き出し元の記録（読み込み先では改訂理由の初期値に使う） */
export interface SchemaExportSource {
  projectName: string;
  schemaVersion: number;
  exportedAt: string;
  exportedBy: string;
  extractPromptVersion: number | null;
  appVersion: string | null;
}

/** ファイル内の 1 項目（SchemaFields の列のうち、版をまたいで意味を持つもの） */
export interface SchemaExportField {
  section: string;
  fieldName: string;
  fieldLabel: string;
  entityLevel: EntityLevel;
  dataType: FieldDataType;
  unit: string | null;
  allowedValues: string | null;
  required: boolean;
  extractionInstruction: string;
  example: string | null;
  note: string | null;
  maxQuotes: number | null;
  multiSelect: { exclusiveValues: string[]; freeTextValues: string[] } | null;
}

export interface SchemaExportFile {
  format: typeof SCHEMA_EXPORT_FORMAT;
  formatVersion: number;
  source: SchemaExportSource;
  fields: SchemaExportField[];
}

export interface ParsedSchemaImport {
  source: SchemaExportSource;
  rows: SchemaEditorRow[];
}

/** 読み込めないファイルの理由（message は表示用に解決済み） */
export class SchemaImportError extends Error {
  constructor(key: MessageKey, params: Record<string, string | number> = {}) {
    super(t(key, params));
    this.name = 'SchemaImportError';
  }
}

const ENTITY_LEVELS: readonly EntityLevel[] = ['study', 'arm', 'outcome_result', 'rob_domain'];
const DATA_TYPES: readonly FieldDataType[] = ['text', 'integer', 'float', 'boolean', 'enum', 'date'];

/** 確定済みの版の項目を、書き出し用の JSON 文字列にする（field_index の順に並べる） */
export function serializeSchemaExport(fields: readonly SchemaField[], source: SchemaExportSource): string {
  const file: SchemaExportFile = {
    format: SCHEMA_EXPORT_FORMAT,
    formatVersion: SCHEMA_EXPORT_FORMAT_VERSION,
    source,
    fields: [...fields]
      .sort((a, b) => a.fieldIndex - b.fieldIndex)
      .map((field) => {
        const config = multiSelectConfigOf(field);
        return {
          section: field.section,
          fieldName: field.fieldName,
          fieldLabel: field.fieldLabel,
          entityLevel: field.entityLevel,
          dataType: field.dataType,
          unit: field.unit,
          allowedValues: field.allowedValues,
          required: field.required,
          extractionInstruction: field.extractionInstruction,
          example: field.example,
          note: field.note,
          maxQuotes: field.maxQuotes,
          multiSelect: config === null
            ? null
            : { exclusiveValues: [...config.exclusiveValues], freeTextValues: [...config.freeTextValues] },
        };
      }),
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** 1 項目を検証してエディタ行へ変換する。読めない理由を返す（null = 読めた） */
function toEditorRow(raw: unknown): SchemaEditorRow | string {
  if (!isRecord(raw)) {
    return 'not an object';
  }
  for (const key of ['section', 'fieldName', 'fieldLabel', 'extractionInstruction'] as const) {
    if (typeof raw[key] !== 'string') {
      return key;
    }
  }
  for (const key of ['unit', 'allowedValues', 'example', 'note'] as const) {
    if (raw[key] !== null && typeof raw[key] !== 'string') {
      return key;
    }
  }
  if (!ENTITY_LEVELS.includes(raw.entityLevel as EntityLevel)) {
    return 'entityLevel';
  }
  if (!DATA_TYPES.includes(raw.dataType as FieldDataType)) {
    return 'dataType';
  }
  if (typeof raw.required !== 'boolean') {
    return 'required';
  }
  if (raw.maxQuotes !== null && !Number.isInteger(raw.maxQuotes)) {
    return 'maxQuotes';
  }
  const multiSelect = raw.multiSelect;
  if (
    multiSelect !== null &&
    !(isRecord(multiSelect) && isStringArray(multiSelect.exclusiveValues) && isStringArray(multiSelect.freeTextValues))
  ) {
    return 'multiSelect';
  }
  return {
    fieldId: null,
    section: raw.section as string,
    fieldName: raw.fieldName as string,
    fieldLabel: raw.fieldLabel as string,
    entityLevel: raw.entityLevel as EntityLevel,
    dataType: raw.dataType as FieldDataType,
    unit: raw.unit as string | null,
    allowedValues: raw.allowedValues as string | null,
    required: raw.required,
    extractionInstruction: raw.extractionInstruction as string,
    example: raw.example as string | null,
    aiGenerated: false,
    note: raw.note as string | null,
    maxQuotes: raw.maxQuotes as number | null,
    multiSelect: multiSelect !== null,
    exclusiveValues: multiSelect === null ? null : (multiSelect.exclusiveValues as string[]).join('|') || null,
    freeTextValues: multiSelect === null ? null : (multiSelect.freeTextValues as string[]).join('|') || null,
  };
}

function toSource(raw: unknown): SchemaExportSource | null {
  if (
    !isRecord(raw) ||
    typeof raw.projectName !== 'string' ||
    !Number.isInteger(raw.schemaVersion) ||
    typeof raw.exportedAt !== 'string' ||
    typeof raw.exportedBy !== 'string'
  ) {
    return null;
  }
  return {
    projectName: raw.projectName,
    schemaVersion: raw.schemaVersion as number,
    exportedAt: raw.exportedAt,
    exportedBy: raw.exportedBy,
    extractPromptVersion: Number.isInteger(raw.extractPromptVersion) ? (raw.extractPromptVersion as number) : null,
    appVersion: typeof raw.appVersion === 'string' ? raw.appVersion : null,
  };
}

/**
 * 書き出したファイルを読み、エディタ行へ変換する。1 項目でも読めない・検証エラーがあれば
 * ファイル全体を拒否する（一部だけ読み込むことはしない）
 */
export function parseSchemaExport(text: string): ParsedSchemaImport {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new SchemaImportError('schema.importNotJson');
  }
  if (!isRecord(data) || data.format !== SCHEMA_EXPORT_FORMAT || !Number.isInteger(data.formatVersion)) {
    throw new SchemaImportError('schema.importWrongFormat');
  }
  if ((data.formatVersion as number) > SCHEMA_EXPORT_FORMAT_VERSION) {
    throw new SchemaImportError('schema.importNewerFormat', { version: data.formatVersion as number });
  }
  const source = toSource(data.source);
  if (source === null || !Array.isArray(data.fields)) {
    throw new SchemaImportError('schema.importWrongFormat');
  }
  if (data.fields.length === 0) {
    throw new SchemaImportError('schema.importNoFields');
  }
  const rows: SchemaEditorRow[] = [];
  for (const [index, raw] of data.fields.entries()) {
    const row = toEditorRow(raw);
    if (typeof row === 'string') {
      throw new SchemaImportError('schema.importInvalidField', { index: index + 1, reason: row });
    }
    rows.push(row);
  }
  const errors = validateEditorRows(rows);
  const first = errors[0];
  if (first !== undefined) {
    throw new SchemaImportError('schema.importValidation', {
      count: errors.length,
      first: `${first.index + 1}: ${first.message}`,
    });
  }
  return { source, rows };
}

/**
 * 書き出すファイル名。プロジェクト名は英数字・ハイフン・ドット以外を _ に置き換える
 * （日本語などを含む名前は、ブラウザによってはダウンロード名が「download」に置き換わるため。
 * プロジェクト名そのものはファイル内の source.projectName に残る）。何も残らなければ project
 */
export function schemaExportFilename(projectName: string, schemaVersion: number, exportedAt: string): string {
  const safe = projectName.replace(/[^A-Za-z0-9.-]+/g, '_').replace(/^[_.]+|[_.]+$/g, '') || 'project';
  return `schema-v${schemaVersion}-${safe}-${exportedAt.slice(0, 10)}.json`;
}

/** 読み込んだ版の改訂理由（SchemaVersions.note）の初期値。出所の記録を残す */
export function importNoteDefault(source: SchemaExportSource): string {
  return t('schema.importNoteDefault', {
    projectName: source.projectName,
    version: source.schemaVersion,
    exportedAt: source.exportedAt.slice(0, 10),
  });
}
