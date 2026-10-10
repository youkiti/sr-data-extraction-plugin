// 拡張アイコンクリック時のタブ起動（background/bootstrap.ts）のテスト。
// ポップアップを出さず、プロジェクト選択状態に応じて開くページを切り替える
import { installChromeMock, type ChromeMock } from '../../setup/chrome-mock';
import {
  createChromeBackgroundDeps,
  createChromeInstalledDeps,
  handleInstalled,
  type InstalledDeps,
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

describe('handleInstalled', () => {
  test.each([
    ['ja', 'ja'],
    ['JA-jp', 'ja'],
    ['en-US', 'en'],
    ['fr', 'en'],
  ])('初回インストールは UI 言語 %s でガイドを一度開く', (uiLanguage, lang) => {
    const deps: InstalledDeps = {
      getUiLanguage: jest.fn(() => uiLanguage),
      openExternalTab: jest.fn(),
    };
    handleInstalled(deps, { reason: 'install' as chrome.runtime.OnInstalledReason });
    expect(deps.openExternalTab).toHaveBeenCalledTimes(1);
    expect(deps.openExternalTab).toHaveBeenCalledWith(
      `https://youkiti.github.io/sr-data-extraction-plugin/help.html?lang=${lang}#setup`,
    );
  });

  test.each(['update', 'chrome_update', 'shared_module_update'] as const)(
    '%s ではガイドを開かず言語も読まない',
    (reason) => {
      const deps: InstalledDeps = {
        getUiLanguage: jest.fn(),
        openExternalTab: jest.fn(),
      };
      handleInstalled(deps, { reason: reason as chrome.runtime.OnInstalledReason });
      expect(deps.openExternalTab).not.toHaveBeenCalled();
      expect(deps.getUiLanguage).not.toHaveBeenCalled();
    },
  );
});

describe('createChromeInstalledDeps', () => {
  test('Chrome の UI 言語を読み、絶対 URL をそのまま新規タブで開く', () => {
    const mock = installChromeMock();
    mock.i18n.getUILanguage.mockReturnValue('en-US');
    const deps = createChromeInstalledDeps();
    expect(deps.getUiLanguage()).toBe('en-US');
    expect(mock.i18n.getUILanguage).toHaveBeenCalledTimes(1);
    const url = 'https://youkiti.github.io/sr-data-extraction-plugin/help.html?lang=en#setup';
    deps.openExternalTab(url);
    expect(mock.tabs.create).toHaveBeenCalledWith({ url });
    expect(mock.runtime.getURL).not.toHaveBeenCalled();
  });
});
