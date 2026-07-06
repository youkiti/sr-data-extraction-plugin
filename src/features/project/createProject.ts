// 新規プロジェクトの生成（S2 相当のコアロジック。sr-query-builder の createProject を移植）
import { CURRENT_SCHEMA_VERSION, type ProjectMeta } from '../../domain/project';
import { SHEET_HEADERS, SHEET_TABS } from '../../domain/sheetsSchema';
import {
  createFolder,
  ensureRootFolder,
  moveFileToFolder,
  type DriveFileRef,
} from '../../lib/google/drive';
import {
  appendRow,
  createSpreadsheet,
  writeHeaderRow,
  type CreatedSpreadsheet,
} from '../../lib/google/sheets';
import type { GoogleApiDeps } from '../../lib/google/types';
import { nowIso8601 } from '../../utils/iso8601';
import { generateUuid, shortUuid } from '../../utils/uuid';

/**
 * 手順（requirements.md §3.1 / ui-flow.md §1）:
 *
 * 1. project_id（UUID v4）発行
 * 2. Drive トップフォルダ作成（`マイドライブ/SR Data Extraction/{title}_{id_short}/`）
 * 3. サブフォルダ（documents / extracted_texts / raw_protocols / logs/llm）作成
 * 4. スプレッドシート作成（13 タブを一括初期化）
 * 5. 各タブのヘッダ行書き込み
 * 6. スプレッドシートをプロジェクトフォルダ配下へ移動（Drive files.update の parents 操作）
 * 7. Meta タブに 1 行追記
 *
 * スプレッドシートは Sheets API の spreadsheets.create が必ずマイドライブ直下に作るため、
 * 作成後に moveFileToFolder でプロジェクトフォルダ（driveFolder）へ移す。
 */

/** ルートフォルダはアプリの正式名称で作る */
const ROOT_FOLDER_NAME = 'SR Data Extraction';
/** アイコン背景色（src/icons/）。Drive パレット外の色は最も近い色に丸められる */
const ROOT_FOLDER_COLOR = '#e9318f';

export interface CreateProjectInput {
  projectTitle: string;
  createdBy: string;
}

export interface CreateProjectResult {
  meta: ProjectMeta;
  spreadsheet: CreatedSpreadsheet;
  driveFolder: DriveFileRef;
  subfolders: {
    documents: DriveFileRef;
    extractedTexts: DriveFileRef;
    rawProtocols: DriveFileRef;
    logsLlm: DriveFileRef;
  };
}

/**
 * テスト時に注入するヘルパの集合。UUID・時刻・ルートフォルダ ID 取得など、
 * 純粋でない関数はここから注入する。
 */
export interface CreateProjectHelpers {
  /** ルート `SR Data Extraction/` フォルダの ID を取得（無ければ作る）。null でマイドライブ直下にする */
  ensureRootFolder?: (deps: GoogleApiDeps) => Promise<string | null>;
  newUuid?: () => string;
  now?: () => string;
}

export async function createProject(
  input: CreateProjectInput,
  deps: GoogleApiDeps,
  helpers: CreateProjectHelpers = {}
): Promise<CreateProjectResult> {
  const uuid = helpers.newUuid ?? generateUuid;
  const now = helpers.now ?? nowIso8601;
  const ensureRoot = helpers.ensureRootFolder ?? defaultEnsureRootFolder;

  const projectId = uuid();
  const rootFolderId = await ensureRoot(deps);
  const topFolderName = `${input.projectTitle}_${shortUuid(projectId)}`;
  const driveFolder = await createFolder(topFolderName, rootFolderId, deps);

  const documents = await createFolder('documents', driveFolder.id, deps);
  const extractedTexts = await createFolder('extracted_texts', driveFolder.id, deps);
  const rawProtocols = await createFolder('raw_protocols', driveFolder.id, deps);
  const logsParent = await createFolder('logs', driveFolder.id, deps);
  const logsLlm = await createFolder('llm', logsParent.id, deps);

  const spreadsheet = await createSpreadsheet(input.projectTitle, SHEET_TABS, deps);

  for (const tab of SHEET_TABS) {
    await writeHeaderRow(spreadsheet.spreadsheetId, tab, SHEET_HEADERS[tab], deps);
  }

  // spreadsheets.create はマイドライブ直下に作るため、プロジェクトフォルダ配下へ移す
  await moveFileToFolder(spreadsheet.spreadsheetId, driveFolder.id, deps);

  const meta: ProjectMeta = {
    projectId,
    projectTitle: input.projectTitle,
    spreadsheetId: spreadsheet.spreadsheetId,
    driveFolderId: driveFolder.id,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    createdAt: now(),
    createdBy: input.createdBy,
  };

  await appendRow(
    spreadsheet.spreadsheetId,
    'Meta',
    [
      meta.projectId,
      meta.projectTitle,
      meta.spreadsheetId,
      meta.driveFolderId,
      meta.schemaVersion,
      meta.createdAt,
      meta.createdBy,
    ],
    deps
  );

  return {
    meta,
    spreadsheet,
    driveFolder,
    subfolders: { documents, extractedTexts, rawProtocols, logsLlm },
  };
}

/**
 * `SR Data Extraction` ルートフォルダを確保する既定実装。
 * My Drive ルート直下を検索して既存フォルダを再利用し、無ければ
 * アイコン色付きで新規作成する。
 */
async function defaultEnsureRootFolder(deps: GoogleApiDeps): Promise<string> {
  const folder = await ensureRootFolder(ROOT_FOLDER_NAME, deps, {
    folderColorRgb: ROOT_FOLDER_COLOR,
  });
  return folder.id;
}
