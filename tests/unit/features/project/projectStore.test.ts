import { installChromeMock } from '../../../setup/chrome-mock';
import type { ProjectRef } from '../../../../src/domain/project';
import {
  CURRENT_PROJECT_STORAGE_KEY,
  RECENT_PROJECTS_STORAGE_KEY,
  clearProjectSelection,
  loadCurrentProject,
  loadRecentProjects,
  setCurrentProject,
} from '../../../../src/features/project/projectStore';

function ref(n: number): ProjectRef {
  return {
    projectId: `project-${n}`,
    spreadsheetId: `sheet-${n}`,
    driveFolderId: `folder-${n}`,
    name: `プロジェクト ${n}`,
  };
}

describe('projectStore', () => {
  beforeEach(() => {
    installChromeMock();
  });

  test('未選択なら currentProject は null / recentProjects は []', async () => {
    await expect(loadCurrentProject()).resolves.toBeNull();
    await expect(loadRecentProjects()).resolves.toEqual([]);
  });

  test('setCurrentProject で currentProject と recentProjects の両方が更新される', async () => {
    await setCurrentProject(ref(1));
    await expect(loadCurrentProject()).resolves.toEqual(ref(1));
    await expect(loadRecentProjects()).resolves.toEqual([ref(1)]);
  });

  test('recentProjects は新しい順・同一 projectId は重複しない', async () => {
    await setCurrentProject(ref(1));
    await setCurrentProject(ref(2));
    await setCurrentProject(ref(1));
    await expect(loadRecentProjects()).resolves.toEqual([ref(1), ref(2)]);
  });

  test('recentProjects は上限 10 件で切り詰める', async () => {
    for (let i = 1; i <= 12; i += 1) {
      await setCurrentProject(ref(i));
    }
    const recent = await loadRecentProjects();
    expect(recent).toHaveLength(10);
    expect(recent[0]).toEqual(ref(12));
    expect(recent[9]).toEqual(ref(3));
  });

  test('clearProjectSelection で両キーが消える', async () => {
    await setCurrentProject(ref(1));
    await clearProjectSelection();
    await expect(loadCurrentProject()).resolves.toBeNull();
    await expect(loadRecentProjects()).resolves.toEqual([]);
  });

  test('ストレージキーは popup / app 間で共有する固定値', () => {
    expect(CURRENT_PROJECT_STORAGE_KEY).toBe('currentProject');
    expect(RECENT_PROJECTS_STORAGE_KEY).toBe('recentProjects');
  });
});
