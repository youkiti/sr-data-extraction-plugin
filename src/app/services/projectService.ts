// プロジェクト作成 / 既存読み込みを司るサービス層。
// lib/google + features/project + chrome.storage を 1 段抽象化し、
// UI レイヤ（Popup / app）から 1 関数呼び出しで完結させる
import { toProjectRef, type ProjectRef } from '../../domain/project';
import { t } from '../../lib/i18n';
import { createProject } from '../../features/project/createProject';
import { loadProjectMeta } from '../../features/project/selectProject';
import { setCurrentProject } from '../../features/project/projectStore';
import { getCurrentUserEmail, type ProfileDeps } from '../../lib/google/identity';
import type { GoogleApiDeps } from '../../lib/google/types';

export interface ProjectServiceDeps {
  google: GoogleApiDeps;
  profile: ProfileDeps;
}

/**
 * 新規プロジェクトを作成し、Sheets（13 タブ）/ Drive（フォルダ 4 種）を初期化して
 * chrome.storage の currentProject / recentProjects に登録する。
 */
export async function createNewProject(
  projectTitle: string,
  deps: ProjectServiceDeps
): Promise<ProjectRef> {
  const trimmed = projectTitle.trim();
  if (trimmed === '') {
    throw new Error(t('popup.errTitleRequired'));
  }
  const createdBy = (await getCurrentUserEmail(deps.profile)) ?? '';
  const result = await createProject({ projectTitle: trimmed, createdBy }, deps.google);
  const ref = toProjectRef(result.meta);
  await setCurrentProject(ref);
  return ref;
}

/**
 * 既存スプレッドシートを開いてプロジェクトとして登録する。
 *
 * - Meta タブ + Documents / SchemaFields タブの存在と schemaVersion / 列構成を検証
 *   （loadProjectMeta が ProjectSchemaError を throw）
 * - 通れば currentProject / recentProjects を更新
 */
/**
 * 入力からスプレッドシート ID を取り出す。Google Sheets の共有 URL
 * （`https://docs.google.com/spreadsheets/d/{ID}/edit#gid=0` など）を貼っても
 * `/spreadsheets/d/{ID}` 部分から ID を抽出する。ID 直打ちは前後空白を除いてそのまま返す。
 */
export function extractSpreadsheetId(input: string): string {
  const trimmed = input.trim();
  const id = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)?.[1];
  return id ?? trimmed;
}

export async function loadExistingProject(
  spreadsheetId: string,
  deps: ProjectServiceDeps
): Promise<ProjectRef> {
  const trimmed = extractSpreadsheetId(spreadsheetId);
  if (trimmed === '') {
    throw new Error(t('popup.errIdRequired'));
  }
  const meta = await loadProjectMeta(trimmed, deps.google);
  const ref = toProjectRef(meta);
  await setCurrentProject(ref);
  return ref;
}
