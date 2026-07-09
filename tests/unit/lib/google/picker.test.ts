// Drive Picker ラッパのテスト。ホスト済みページとのメッセージプロトコル
// （ready → token 応答 / picked / cancelled / タブ閉鎖）を fake deps で網羅する
import { installChromeMock, type ChromeMock } from '../../../setup/chrome-mock';
import {
  createChromePickerDeps,
  openPdfPicker,
  PICKER_MESSAGE_SOURCE,
  PICKER_PAGE_URL,
  type PickerDeps,
} from '../../../../src/lib/google/picker';

type ExternalListener = (
  message: unknown,
  senderTabId: number | null,
  sendResponse: (response: unknown) => void,
) => void;

interface FakePicker {
  deps: PickerDeps;
  emitMessage: ExternalListener;
  emitTabRemoved: (tabId: number) => void;
  removeTab: jest.Mock;
  createTab: jest.Mock;
  unsubscribeMessage: jest.Mock;
  unsubscribeTab: jest.Mock;
}

function createFakeDeps(overrides: Partial<PickerDeps> = {}): FakePicker {
  let messageListener: ExternalListener = () => undefined;
  let tabRemovedListener: (tabId: number) => void = () => undefined;
  const unsubscribeMessage = jest.fn();
  const unsubscribeTab = jest.fn();
  const createTab = jest.fn(async () => 77);
  const removeTab = jest.fn(async () => undefined);
  const deps: PickerDeps = {
    getAccessToken: async () => 'token-1234',
    extensionId: 'ext-id',
    pickerPageUrl: 'https://example.com/picker.html',
    createTab,
    removeTab,
    addExternalMessageListener: (listener) => {
      messageListener = listener;
      return unsubscribeMessage;
    },
    addTabRemovedListener: (listener) => {
      tabRemovedListener = listener;
      return unsubscribeTab;
    },
    ...overrides,
  };
  return {
    deps,
    emitMessage: (message, senderTabId, sendResponse) =>
      messageListener(message, senderTabId, sendResponse),
    emitTabRemoved: (tabId) => tabRemovedListener(tabId),
    removeTab,
    createTab,
    unsubscribeMessage,
    unsubscribeTab,
  };
}

/** openPdfPicker がリスナー登録を終えるまで待つ（createTab の await を跨ぐ） */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('openPdfPicker', () => {
  test('extension_id 付きでタブを開き、ready へ token を応答し、picked で選択を返す', async () => {
    const fake = createFakeDeps();
    const promise = openPdfPicker(fake.deps);
    await flushMicrotasks();
    expect(fake.createTab).toHaveBeenCalledWith(
      'https://example.com/picker.html#extension_id=ext-id',
    );

    const sendResponse = jest.fn();
    fake.emitMessage({ source: PICKER_MESSAGE_SOURCE, kind: 'ready' }, 77, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({ token: 'token-1234' });

    fake.emitMessage(
      {
        source: PICKER_MESSAGE_SOURCE,
        kind: 'picked',
        files: [
          { id: 'file-1', name: 'a.pdf' },
          { id: 'file-2', name: 'b.pdf' },
        ],
      },
      77,
      jest.fn(),
    );
    await expect(promise).resolves.toEqual([
      { sourceFileId: 'file-1', filename: 'a.pdf' },
      { sourceFileId: 'file-2', filename: 'b.pdf' },
    ]);
    expect(fake.removeTab).toHaveBeenCalledWith(77);
    expect(fake.unsubscribeMessage).toHaveBeenCalled();
    expect(fake.unsubscribeTab).toHaveBeenCalled();
  });

  test('picked の mimeType を素通しする（フォルダ + ファイル混在）', async () => {
    const fake = createFakeDeps();
    const promise = openPdfPicker(fake.deps);
    await flushMicrotasks();
    fake.emitMessage(
      {
        source: PICKER_MESSAGE_SOURCE,
        kind: 'picked',
        files: [
          { id: 'folder-1', name: 'fulltext', mimeType: 'application/vnd.google-apps.folder' },
          { id: 'file-1', name: 'a.pdf', mimeType: 'application/pdf' },
        ],
      },
      77,
      jest.fn(),
    );
    await expect(promise).resolves.toEqual([
      {
        sourceFileId: 'folder-1',
        filename: 'fulltext',
        mimeType: 'application/vnd.google-apps.folder',
      },
      { sourceFileId: 'file-1', filename: 'a.pdf', mimeType: 'application/pdf' },
    ]);
  });

  test('mimeType が文字列でない要素はファイル扱いにする（mimeType 欠落＝undefined）', async () => {
    const fake = createFakeDeps();
    const promise = openPdfPicker(fake.deps);
    await flushMicrotasks();
    fake.emitMessage(
      {
        source: PICKER_MESSAGE_SOURCE,
        kind: 'picked',
        files: [{ id: 'file-1', name: 'a.pdf', mimeType: 42 }],
      },
      77,
      jest.fn(),
    );
    const result = await promise;
    expect(result).toEqual([{ sourceFileId: 'file-1', filename: 'a.pdf' }]);
    expect(result?.[0].mimeType).toBeUndefined();
  });

  test('cancelled で null を返しタブを閉じる', async () => {
    const fake = createFakeDeps();
    const promise = openPdfPicker(fake.deps);
    await flushMicrotasks();
    fake.emitMessage({ source: PICKER_MESSAGE_SOURCE, kind: 'cancelled' }, 77, jest.fn());
    await expect(promise).resolves.toBeNull();
    expect(fake.removeTab).toHaveBeenCalledWith(77);
  });

  test('ユーザーがタブを閉じたら null（タブは閉じ直さない）', async () => {
    const fake = createFakeDeps();
    const promise = openPdfPicker(fake.deps);
    await flushMicrotasks();
    fake.emitTabRemoved(76); // 別タブは無視
    fake.emitTabRemoved(77);
    await expect(promise).resolves.toBeNull();
    expect(fake.removeTab).not.toHaveBeenCalled();
  });

  test('確定後の遅延イベントは無視される（二重 resolve しない）', async () => {
    const fake = createFakeDeps();
    const promise = openPdfPicker(fake.deps);
    await flushMicrotasks();
    fake.emitMessage({ source: PICKER_MESSAGE_SOURCE, kind: 'cancelled' }, 77, jest.fn());
    fake.emitTabRemoved(77); // 購読解除が no-op な fake なので settle 済みガードを通る
    await expect(promise).resolves.toBeNull();
    expect(fake.removeTab).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['別タブからのメッセージ', { source: PICKER_MESSAGE_SOURCE, kind: 'cancelled' }, 99],
    ['オブジェクトでない', 'not-an-object', 77],
    ['null', null, 77],
    ['source 不一致', { source: 'other', kind: 'cancelled' }, 77],
    ['未知の kind', { source: PICKER_MESSAGE_SOURCE, kind: 'unknown' }, 77],
    ['files が配列でない', { source: PICKER_MESSAGE_SOURCE, kind: 'picked', files: 'x' }, 77],
    [
      'files 要素がオブジェクトでない',
      { source: PICKER_MESSAGE_SOURCE, kind: 'picked', files: ['x'] },
      77,
    ],
    [
      'files 要素が null',
      { source: PICKER_MESSAGE_SOURCE, kind: 'picked', files: [null] },
      77,
    ],
    [
      'files 要素の id が文字列でない',
      { source: PICKER_MESSAGE_SOURCE, kind: 'picked', files: [{ id: 1, name: 'a.pdf' }] },
      77,
    ],
    [
      'files 要素の id が空',
      { source: PICKER_MESSAGE_SOURCE, kind: 'picked', files: [{ id: '', name: 'a.pdf' }] },
      77,
    ],
    [
      'files 要素の name が文字列でない',
      { source: PICKER_MESSAGE_SOURCE, kind: 'picked', files: [{ id: 'f1', name: 1 }] },
      77,
    ],
  ])('不正メッセージは無視する: %s', async (_label, message, senderTabId) => {
    const fake = createFakeDeps();
    const promise = openPdfPicker(fake.deps);
    await flushMicrotasks();
    fake.emitMessage(message, senderTabId, jest.fn());
    // まだ未確定 → 正常キャンセルで終了できる
    fake.emitMessage({ source: PICKER_MESSAGE_SOURCE, kind: 'cancelled' }, 77, jest.fn());
    await expect(promise).resolves.toBeNull();
  });

  test('removeTab の失敗は握りつぶす（結果は確定済み）', async () => {
    const fake = createFakeDeps();
    fake.removeTab.mockRejectedValue(new Error('tab already closed'));
    const promise = openPdfPicker(fake.deps);
    await flushMicrotasks();
    fake.emitMessage({ source: PICKER_MESSAGE_SOURCE, kind: 'cancelled' }, 77, jest.fn());
    await expect(promise).resolves.toBeNull();
  });

  test('トークン取得に失敗したらタブを開かず reject する', async () => {
    const fake = createFakeDeps({
      getAccessToken: async () => {
        throw new Error('not signed in');
      },
    });
    await expect(openPdfPicker(fake.deps)).rejects.toThrow('not signed in');
    expect(fake.createTab).not.toHaveBeenCalled();
  });
});

describe('createChromePickerDeps', () => {
  let chromeMock: ChromeMock;
  const google = {
    fetch: jest.fn(),
    getAccessToken: async () => 'g-token',
  };

  beforeEach(() => {
    chromeMock = installChromeMock();
  });

  test('extensionId / pickerPageUrl / getAccessToken を配線する', async () => {
    const deps = createChromePickerDeps(google);
    expect(deps.extensionId).toBe('test-extension-id');
    expect(deps.pickerPageUrl).toBe(PICKER_PAGE_URL);
    await expect(deps.getAccessToken()).resolves.toBe('g-token');
  });

  test('createTab はタブ ID を返し、id 欠落なら throw する', async () => {
    chromeMock.tabs.create.mockResolvedValueOnce({ id: 5 });
    const deps = createChromePickerDeps(google);
    await expect(deps.createTab('https://example.com')).resolves.toBe(5);
    expect(chromeMock.tabs.create).toHaveBeenCalledWith({ url: 'https://example.com' });

    chromeMock.tabs.create.mockResolvedValueOnce({});
    await expect(deps.createTab('https://example.com')).rejects.toThrow(
      'Picker タブの作成に失敗しました',
    );
  });

  test('removeTab は chrome.tabs.remove を呼ぶ', async () => {
    const deps = createChromePickerDeps(google);
    await deps.removeTab(9);
    expect(chromeMock.tabs.remove).toHaveBeenCalledWith(9);
  });

  test('外部メッセージリスナーは sender.tab.id を渡し、解除関数が removeListener を呼ぶ', () => {
    const deps = createChromePickerDeps(google);
    const listener = jest.fn();
    const unsubscribe = deps.addExternalMessageListener(listener);

    const wrapped = chromeMock.runtime.onMessageExternal.addListener.mock.calls[0]?.[0] as (
      message: unknown,
      sender: { tab?: { id?: number } },
      sendResponse: (response: unknown) => void,
    ) => void;
    const sendResponse = jest.fn();
    wrapped({ kind: 'x' }, { tab: { id: 3 } }, sendResponse);
    expect(listener).toHaveBeenCalledWith({ kind: 'x' }, 3, sendResponse);

    // タブ外（別拡張ページ等）からの送信は senderTabId = null
    wrapped({ kind: 'x' }, {}, sendResponse);
    expect(listener).toHaveBeenLastCalledWith({ kind: 'x' }, null, sendResponse);

    unsubscribe();
    expect(chromeMock.runtime.onMessageExternal.removeListener).toHaveBeenCalledWith(wrapped);
  });

  test('タブ削除リスナーの購読・解除を chrome.tabs.onRemoved へ配線する', () => {
    const deps = createChromePickerDeps(google);
    const listener = jest.fn();
    const unsubscribe = deps.addTabRemovedListener(listener);
    expect(chromeMock.tabs.onRemoved.addListener).toHaveBeenCalledWith(listener);
    unsubscribe();
    expect(chromeMock.tabs.onRemoved.removeListener).toHaveBeenCalledWith(listener);
  });
});
