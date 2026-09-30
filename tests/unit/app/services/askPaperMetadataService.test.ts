import {
  loadAskPaperUsedStudyIds,
  rememberAskPaperStudy,
} from '../../../../src/app/services/askPaperMetadataService';
import {
  askPaperUsedStudiesStorageKey,
  saveAskPaperUsedStudies,
} from '../../../../src/lib/storage/askPaperStore';
import * as identity from '../../../../src/lib/google/identity';
import { createInitialState, createStore } from '../../../../src/app/store';
import { installChromeMock } from '../../../setup/chrome-mock';

function setup() {
  const chromeMock = installChromeMock();
  const initial = createInitialState();
  initial.currentProject = {
    projectId: 'p',
    spreadsheetId: 'sheet',
    driveFolderId: 'folder',
    name: 'SR',
  };
  const store = createStore(initial);
  const profile = {
    getProfileUserInfo: jest.fn(async () => ({ email: 'owner@example.com', id: 'owner' })),
  };
  return { store, profile, chromeMock };
}

test('再読み込みした新しいstoreでも保存済みIDを復元し、会話は保存しない', async () => {
  const { store, profile, chromeMock } = setup();
  store.setState({ askPaper: { ...store.getState().askPaper, usedStudyIds: ['session'] } });
  await saveAskPaperUsedStudies('sheet', 'owner@example.com', ['saved', 'session']);
  await loadAskPaperUsedStudyIds(store, { profile });
  expect(store.getState().askPaper.usedStudyIds).toEqual(['saved', 'session']);
  await rememberAskPaperStudy(store, { profile }, 'new-study');
  const reloaded = createStore({
    ...createInitialState(),
    currentProject: store.getState().currentProject,
  });
  await loadAskPaperUsedStudyIds(reloaded, { profile });
  expect(reloaded.getState().askPaper.usedStudyIds).toEqual(['saved', 'session', 'new-study']);
  expect(reloaded.getState().askPaper.conversations).toEqual({});
  expect(chromeMock.storage.local.data).toEqual({
    [askPaperUsedStudiesStorageKey('sheet', 'owner@example.com')]: [
      'saved',
      'session',
      'new-study',
    ],
  });
});

test('プロジェクトやアカウントの切替では別スコープのIDを混ぜない', async () => {
  const { store, profile, chromeMock } = setup();
  await rememberAskPaperStudy(store, { profile }, 'owner-study');
  profile.getProfileUserInfo.mockResolvedValue({ email: 'reviewer@example.com', id: 'reviewer' });
  await loadAskPaperUsedStudyIds(store, { profile });
  expect(store.getState().askPaper.usedStudyIds).toEqual([]);
  await rememberAskPaperStudy(store, { profile }, 'reviewer-study');
  store.setState({
    currentProject: { ...store.getState().currentProject!, spreadsheetId: 'other-sheet' },
  });
  await loadAskPaperUsedStudyIds(store, { profile });
  expect(store.getState().askPaper.usedStudyIds).toEqual([]);
  expect(
    chromeMock.storage.local.data[askPaperUsedStudiesStorageKey('sheet', 'owner@example.com')],
  ).toEqual(['owner-study']);
  expect(
    chromeMock.storage.local.data[askPaperUsedStudiesStorageKey('sheet', 'reviewer@example.com')],
  ).toEqual(['reviewer-study']);
});

test('プロファイル依存を省略した場合も認可アカウントの取得方式を使う', async () => {
  const { store, profile } = setup();
  const createProfile = jest.spyOn(identity, 'createChromeProfileDeps').mockReturnValue(profile);
  await loadAskPaperUsedStudyIds(store, {});
  expect(createProfile).toHaveBeenCalledTimes(1);
  createProfile.mockRestore();
});

test.each(['project', 'email', 'changed', 'removed'] as const)(
  '無効な参照や読込中の移動は状態を変更しない: %s',
  async (kind) => {
    const { store, profile, chromeMock } = setup();
    if (kind === 'project') store.setState({ currentProject: null });
    if (kind === 'email') profile.getProfileUserInfo.mockResolvedValue({ email: '', id: '' });
    if (kind === 'changed' || kind === 'removed') {
      chromeMock.storage.local.get.mockImplementationOnce(async () => {
        store.setState({
          currentProject:
            kind === 'removed'
              ? null
              : { ...store.getState().currentProject!, spreadsheetId: 'other' },
        });
        return {};
      });
    }
    await rememberAskPaperStudy(store, { profile }, 'study');
    expect(store.getState().askPaper.usedStudyIds).toEqual([]);
    expect(chromeMock.storage.local.set).not.toHaveBeenCalled();
  },
);

test.each(['profile', 'get', 'set'] as const)(
  '保存関連の失敗は警告だけで利用や判定を妨げない: %s',
  async (kind) => {
    const { store, profile, chromeMock } = setup();
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    if (kind === 'profile') profile.getProfileUserInfo.mockRejectedValueOnce(new Error('offline'));
    if (kind === 'get') chromeMock.storage.local.get.mockRejectedValueOnce(new Error('offline'));
    if (kind === 'set') chromeMock.storage.local.set.mockRejectedValueOnce(new Error('offline'));
    await expect(rememberAskPaperStudy(store, { profile }, 'study')).resolves.toBeUndefined();
    expect(warning).toHaveBeenCalledWith('質問済み study のローカル保存・復元に失敗しました');
    if (kind === 'set') expect(store.getState().askPaper.usedStudyIds).toEqual(['study']);
    warning.mockRestore();
  },
);
