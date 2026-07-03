// currentProject / recentProjects の永続化（chrome.storage.local）。
// Popup とメインビューで共有する。プロジェクト選択（作成・既存 ID・履歴クリック）は
// setCurrentProject で currentProject と recentProjects の両方を更新する
import { getLocal, removeLocal, setLocal } from '../../lib/storage/chromeStorage';
import type { ProjectRef } from '../../domain/project';

export const CURRENT_PROJECT_STORAGE_KEY = 'currentProject';
export const RECENT_PROJECTS_STORAGE_KEY = 'recentProjects';

/** 最近のプロジェクトの保持上限（sr-query-builder と同じ） */
const RECENT_MAX = 10;

export async function loadCurrentProject(): Promise<ProjectRef | null> {
  return (await getLocal<ProjectRef>(CURRENT_PROJECT_STORAGE_KEY)) ?? null;
}

export async function loadRecentProjects(): Promise<ProjectRef[]> {
  return (await getLocal<ProjectRef[]>(RECENT_PROJECTS_STORAGE_KEY)) ?? [];
}

/**
 * 現在のプロジェクトを設定し、recentProjects の先頭にも追加する
 * （同一 projectId の既存エントリは除去し、上限 RECENT_MAX 件で切り詰め）。
 */
export async function setCurrentProject(project: ProjectRef): Promise<void> {
  const recent = await loadRecentProjects();
  const filtered = recent.filter((entry) => entry.projectId !== project.projectId);
  await setLocal(CURRENT_PROJECT_STORAGE_KEY, project);
  await setLocal(RECENT_PROJECTS_STORAGE_KEY, [project, ...filtered].slice(0, RECENT_MAX));
}

/**
 * プロジェクト選択状態をすべてクリアする（ログアウト時。
 * 別アカウントでログインし直しても他人の recent が残らないようにする）。
 */
export async function clearProjectSelection(): Promise<void> {
  await removeLocal(CURRENT_PROJECT_STORAGE_KEY);
  await removeLocal(RECENT_PROJECTS_STORAGE_KEY);
}
