// プロジェクト識別の型定義（requirements.md §3.1 / §3.2 Meta タブ）

/**
 * Popup で選択され chrome.storage.local に永続化し、メインビューが起動時に
 * 読み込むプロジェクト参照（1 プロジェクト = 1 スプレッドシート = 1 Drive フォルダ）。
 */
export interface ProjectRef {
  projectId: string;
  spreadsheetId: string;
  driveFolderId: string;
  name: string;
}

/**
 * Meta タブ 1 行に相当するプロジェクトのアイデンティティ。
 * sr-query-builder と同一構成（requirements.md §3.2）。
 */
export interface ProjectMeta {
  projectId: string;
  projectTitle: string;
  spreadsheetId: string;
  driveFolderId: string;
  schemaVersion: string;
  createdAt: string;
  createdBy: string;
}

/** 本拡張が書き込む現行スキーマバージョン */
export const CURRENT_SCHEMA_VERSION = '1.0';

/** ProjectMeta → ProjectRef（Popup / メインビューが持ち回る最小情報）への変換 */
export function toProjectRef(meta: ProjectMeta): ProjectRef {
  return {
    projectId: meta.projectId,
    spreadsheetId: meta.spreadsheetId,
    driveFolderId: meta.driveFolderId,
    name: meta.projectTitle,
  };
}
