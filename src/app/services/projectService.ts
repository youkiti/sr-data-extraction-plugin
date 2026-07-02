// プロジェクト作成 / 既存読み込みを司るサービス層。
// lib/google + features/project + chrome.storage を 1 段抽象化し、
// UI レイヤ（Popup / app）から 1 関数呼び出しで完結させる
import { toProjectRef, type ProjectRef } from '../../domain/project';
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
    throw new Error('プロジェクトタイトルは必須です');
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
export async function loadExistingProject(
  spreadsheetId: string,
  deps: ProjectServiceDeps
): Promise<ProjectRef> {
  const trimmed = spreadsheetId.trim();
  if (trimmed === '') {
    throw new Error('スプレッドシート ID は必須です');
  }
  const meta = await loadProjectMeta(trimmed, deps.google);
  const ref = toProjectRef(meta);
  await setCurrentProject(ref);
  return ref;
}
