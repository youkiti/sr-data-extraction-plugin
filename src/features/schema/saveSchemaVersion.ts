// 「版として確定」パイプライン（S5）: エディタ行を検証し、
// SchemaVersions（1 行）+ SchemaFields（N 行）を新しい schema_version で追記する。
// 追記型のため過去版は常に保持される（requirements.md §3.1）
import type { SchemaField } from '../../domain/schemaField';
import type { SchemaCreatedByType, SchemaVersion } from '../../domain/schemaVersion';
import type { GoogleApiDeps } from '../../lib/google/types';
import { nowIso8601 } from '../../utils/iso8601';
import { generateUuid } from '../../utils/uuid';
import {
  appendSchemaFields,
  appendSchemaVersion,
  getNextSchemaVersion,
} from './schemaRepository';
import type { SchemaEditorRow } from './types';
import { validateEditorRows } from './validateField';

export interface SaveSchemaVersionParams {
  spreadsheetId: string;
  rows: readonly SchemaEditorRow[];
  /** 派生元の版。初版は null */
  parentVersion: number | null;
  /** 依拠した Protocol.version */
  protocolVersion: number;
  createdByType: SchemaCreatedByType;
  createdBy: string;
  /** 改訂理由（任意） */
  note: string | null;
}

export interface SaveSchemaVersionDeps {
  google: GoogleApiDeps;
  newUuid?: () => string;
  now?: () => string;
}

export interface SaveSchemaVersionResult {
  version: SchemaVersion;
  fields: SchemaField[];
}

/** バリデーション未通過のまま確定しようとしたときの失敗（UI 側は事前検証する前提の防衛線） */
export class SchemaValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaValidationError';
  }
}

/**
 * エディタ行を新しい版として確定する。fieldId が null の行（新規）は UUID を採番し、
 * 既存 ID の行はそのまま維持する（版をまたいだ改名追跡。requirements.md §3.2）
 */
export async function saveSchemaVersion(
  params: SaveSchemaVersionParams,
  deps: SaveSchemaVersionDeps,
): Promise<SaveSchemaVersionResult> {
  if (params.rows.length === 0) {
    throw new SchemaValidationError('スキーマ項目が 1 件もありません');
  }
  const validationErrors = validateEditorRows(params.rows);
  if (validationErrors.length > 0) {
    const first = validationErrors
      .slice(0, 1)
      .map((error) => error.message)
      .join('');
    throw new SchemaValidationError(
      `スキーマにエラーが ${validationErrors.length} 件あります（先頭: ${first}）`,
    );
  }

  const uuid = deps.newUuid ?? generateUuid;
  const now = deps.now ?? nowIso8601;
  const schemaVersion = await getNextSchemaVersion(params.spreadsheetId, deps.google);

  const version: SchemaVersion = {
    schemaVersion,
    parentVersion: params.parentVersion,
    protocolVersion: params.protocolVersion,
    createdByType: params.createdByType,
    createdAt: now(),
    createdBy: params.createdBy,
    note: params.note,
  };
  const fields: SchemaField[] = params.rows.map((row, index) => ({
    schemaVersion,
    fieldId: row.fieldId ?? uuid(),
    fieldIndex: index + 1,
    section: row.section.trim(),
    fieldName: row.fieldName.trim(),
    fieldLabel: row.fieldLabel.trim(),
    entityLevel: row.entityLevel,
    dataType: row.dataType,
    unit: row.unit,
    allowedValues: row.dataType === 'enum' ? row.allowedValues : null,
    required: row.required,
    extractionInstruction: row.extractionInstruction.trim(),
    example: row.example,
    aiGenerated: row.aiGenerated,
    note: row.note,
  }));

  await appendSchemaVersion(params.spreadsheetId, version, deps.google);
  await appendSchemaFields(params.spreadsheetId, fields, deps.google);
  return { version, fields };
}
