// 拡張アイコンクリック時のタブ起動（background/bootstrap.ts）のテスト。
// ポップアップを出さず、プロジェクト選択状態に応じて開くページを切り替える
import { installChromeMock, type ChromeMock } from '../../setup/chrome-mock';
import {
  createChromeBackgroundDeps,
  handleActionClick,
  type BackgroundDeps,
} from '../../../src/background/bootstrap';
import { CURRENT_PROJECT_STORAGE_KEY } from '../../../src/features/project/projectStore';
import type { ProjectRef } from '../../../src/domain/project';

const PROJECT: ProjectRef = {
  projectId: 'pid-1',
  name: 'テスト SR',
  spreadsheetId: 'SID-1',
  driveFolderId: 'FOLDER-1',
};

function makeDeps(over: Partial<BackgroundDeps> = {}): BackgroundDeps {
  return {
    loadCurrentProject: jest.fn(async () => null),
    openTab: jest.fn(),
    ...over,
  };
}

describe('handleActionClick', () => {
  test('プロジェクト選択済みならメインビューを新規タブで開く', async () => {
    const deps = makeDeps({ loadCurrentProject: jest.fn(async () => PROJECT) });
    await handleActionClick(deps);
    expect(deps.openTab).toHaveBeenCalledWith('app/app.html');
  });

  test('プロジェクト未選択なら S1 プロジェクト選択ページを新規タブで開く', async () => {
    const deps = makeDeps();
    await handleActionClick(deps);
    expect(deps.openTab).toHaveBeenCalledWith('popup/popup.html');
  });
});

describe('createChromeBackgroundDeps', () => {
  let mock: ChromeMock;

  beforeEach(() => {
    mock = installChromeMock();
  });

  test('openTab は拡張内 URL を解決して chrome.tabs.create を呼ぶ', () => {
    const deps = createChromeBackgroundDeps();
    deps.openTab('app/app.html');
    expect(mock.tabs.create).toHaveBeenCalledWith({
      url: 'chrome-extension://test-extension-id/app/app.html',
    });
  });

  test('loadCurrentProject は chrome.storage.local の保存値を返す', async () => {
    mock.storage.local.data[CURRENT_PROJECT_STORAGE_KEY] = PROJECT;
    const deps = createChromeBackgroundDeps();
    await expect(deps.loadCurrentProject()).resolves.toEqual(PROJECT);
  });
});
