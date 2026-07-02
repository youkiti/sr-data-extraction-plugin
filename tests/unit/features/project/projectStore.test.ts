import { installChromeMock } from '../../../setup/chrome-mock';
import {
  CURRENT_PROJECT_STORAGE_KEY,
  loadCurrentProject,
  saveCurrentProject,
} from '../../../../src/features/project/projectStore';

describe('projectStore', () => {
  beforeEach(() => {
    installChromeMock();
  });

  test('未選択なら null', async () => {
    await expect(loadCurrentProject()).resolves.toBeNull();
  });

  test('保存 → 読み出しで往復する', async () => {
    const project = { spreadsheetId: 'sheet-1', name: 'テストプロジェクト' };
    await saveCurrentProject(project);
    await expect(loadCurrentProject()).resolves.toEqual(project);
  });

  test('ストレージキーは popup / app 間で共有する固定値', () => {
    expect(CURRENT_PROJECT_STORAGE_KEY).toBe('currentProject');
  });
});
