// currentProject の永続化（chrome.storage.local）。Popup とメインビューで共有する。
// プロジェクト生成（スプレッドシート 12 タブ + Drive フォルダ）は createProject.ts として今後実装
import { getLocal, setLocal } from '../../lib/storage/chromeStorage';
import type { ProjectRef } from '../../domain/project';

export const CURRENT_PROJECT_STORAGE_KEY = 'currentProject';

export async function loadCurrentProject(): Promise<ProjectRef | null> {
  return (await getLocal<ProjectRef>(CURRENT_PROJECT_STORAGE_KEY)) ?? null;
}

export async function saveCurrentProject(project: ProjectRef): Promise<void> {
  await setLocal(CURRENT_PROJECT_STORAGE_KEY, project);
}
