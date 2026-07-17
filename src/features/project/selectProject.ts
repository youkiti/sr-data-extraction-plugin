// 既存スプレッドシートを開くときのメタ情報読み取り + スキーマ検証
// （sr-query-builder の selectProject を移植し、本拡張固有のタブ存在確認を追加）
import { CURRENT_SCHEMA_VERSION, type ProjectMeta } from '../../domain/project';
import { SHEET_HEADERS } from '../../domain/sheetsSchema';
import {
  getSheetTitles,
  getSheetValues,
  isSheetsAccessDenied,
  SheetsAccessDeniedError,
} from '../../lib/google/sheets';
import { type GoogleApiDeps } from '../../lib/google/types';

export class ProjectSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectSchemaError';
  }
}

/** 本拡張のプロジェクトであることの判定に使うタブ（docs/ui-states.md §1） */
const REQUIRED_TABS = ['Documents', 'SchemaFields'] as const;

/**
 * スプレッドシートの Meta タブを読み、ProjectMeta に変換する。
 *
 * - アクセス拒否（404 / 権限系 403）→ SheetsAccessDeniedError（issue #130。
 *   drive.file では未許可と不存在を区別できないため、Picker 許可導線へ誘導する）
 * - Meta タブ欠落 / 列構成不一致 / スキーマバージョン不一致 → ProjectSchemaError
 * - Documents / SchemaFields タブ欠落（= sr-query-builder 等の別ツールのシート）
 *   → 「sr-data-extraction のプロジェクトではありません」（docs/ui-states.md §1）
 */
export async function loadProjectMeta(
  spreadsheetId: string,
  deps: GoogleApiDeps
): Promise<ProjectMeta> {
  let tabTitles: string[];
  let rows: string[][];
  try {
    tabTitles = await getSheetTitles(spreadsheetId, deps);
  } catch (err) {
    if (isSheetsAccessDenied(err)) {
      throw new SheetsAccessDeniedError(spreadsheetId, err.status);
    }
    throw err;
  }
  if (!tabTitles.includes('Meta')) {
    throw new ProjectSchemaError(
      'Meta タブがありません。プロジェクトとして初期化されていません'
    );
  }
  const missing = REQUIRED_TABS.filter((tab) => !tabTitles.includes(tab));
  if (missing.length > 0) {
    throw new ProjectSchemaError(
      `sr-data-extraction のプロジェクトではありません（${missing.join(' / ')} タブが見つかりません）`
    );
  }

  try {
    rows = await getSheetValues(spreadsheetId, 'Meta', deps);
  } catch (err) {
    // タブ一覧が読めた直後に許可が失効するケース（レア）も同じ導線へ倒す
    if (isSheetsAccessDenied(err)) {
      throw new SheetsAccessDeniedError(spreadsheetId, err.status);
    }
    throw err;
  }
  if (rows.length === 0) {
    throw new ProjectSchemaError('Meta タブが空です。プロジェクトとして初期化されていません');
  }
  // length > 0 が確定しているので [0] は必ず定義されている
  const header = rows[0] as string[];
  const dataRows = rows.slice(1);
  const expected = SHEET_HEADERS.Meta;
  if (!sameArray(header, expected)) {
    throw new ProjectSchemaError(
      `Meta タブの列構成が想定と異なります。期待: [${expected.join(', ')}]`
    );
  }
  if (dataRows.length === 0) {
    throw new ProjectSchemaError('Meta タブにデータ行がありません');
  }
  // dataRows.length > 0 が確定しているので [0] は必ず定義されている
  const row = dataRows[0] as string[];
  const map = toRecord(expected, row);
  // toRecord が expected の全キーを埋めるので非 undefined と扱える
  const schemaVersion = map['schema_version'] as string;
  if (!isSupportedSchemaVersion(schemaVersion)) {
    throw new ProjectSchemaError(
      `サポート外のスキーマバージョンです: ${schemaVersion}（本拡張は ${CURRENT_SCHEMA_VERSION} まで対応）`
    );
  }
  return {
    projectId: map['project_id'] as string,
    projectTitle: map['project_title'] as string,
    spreadsheetId: map['spreadsheet_id'] as string,
    driveFolderId: map['drive_folder_id'] as string,
    schemaVersion,
    createdAt: map['created_at'] as string,
    createdBy: map['created_by'] as string,
  };
}

function sameArray(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function toRecord(header: readonly string[], row: readonly string[]): Record<string, string> {
  const result: Record<string, string> = {};
  header.forEach((key, i) => {
    result[key] = row[i] ?? '';
  });
  return result;
}

function isSupportedSchemaVersion(version: string): boolean {
  // MVP では完全一致のみサポート。将来の後方互換はメジャーバージョン比較に置き換える
  return version === CURRENT_SCHEMA_VERSION;
}
