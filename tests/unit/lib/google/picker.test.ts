// Drive Picker ラッパのテスト。ホスト済みページとのメッセージプロトコル
// （ready → token 応答 / picked / cancelled / タブ閉鎖）と、トークン受け渡し境界の
// 防御（sender.url / nonce 照合。issue #130）を fake deps で網羅する
import { installChromeMock, type ChromeMock } from '../../../setup/chrome-mock';
import {
  createChromePickerDeps,
  openPdfPicker,
  openSpreadsheetPicker,
  PICKER_MESSAGE_SOURCE,
  PICKER_PAGE_URL,
  type PickerDeps,
  type PickerMessageSender,
} from '../../../../src/lib/google/picker';

type ExternalListener = (
  message: unknown,
  sender: PickerMessageSender,
  sendResponse: (response: unknown) => void,
) => void;

const PAGE_URL = 'https://example.com/picker.html';
const NONCE = 'nonce-1';

interface FakePicker {
  deps: PickerDeps;
  /** sender 省略時は「正しいタブ + 正しい URL」で送る */
  emitMessage: (
    message: unknown,
    sender?: Partial<PickerMessageSender>,
    sendResponse?: (response: unknown) => void,
  ) => void;
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
    pickerPageUrl: PAGE_URL,
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
    createNonce: () => NONCE,
    ...overrides,
  };
  return {
    deps,
    emitMessage: (message, sender = {}, sendResponse = jest.fn()) =>
      messageListener(
        message,
        { tabId: sender.tabId ?? 77, url: sender.url === undefined ? `${PAGE_URL}#x` : sender.url },
        sendResponse,
      ),
    emitTabRemoved: (tabId) => tabRemovedListener(tabId),
    removeTab,
    createTab,
    unsubscribeMessage,
    unsubscribeTab,
  };
}

/** メッセージへ正しい nonce を付ける（既定 fake の createNonce 固定値） */
function withNonce(message: Record<string, unknown>): Record<string, unknown> {
  return { ...message, nonce: NONCE };
}

/** openPdfPicker がリスナー登録を終えるまで待つ（createTab の await を跨ぐ） */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('openPdfPicker', () => {
  test('extension_id + nonce 付きでタブを開き、ready へ token を応答し、picked で選択を返す', async () => {
    const fake = createFakeDeps();
    const promise = openPdfPicker(fake.deps);
    await flushMicrotasks();
    expect(fake.createTab).toHaveBeenCalledWith(
      `${PAGE_URL}#extension_id=ext-id&nonce=${NONCE}`,
    );

    const sendResponse = jest.fn();
    fake.emitMessage(withNonce({ source: PICKER_MESSAGE_SOURCE, kind: 'ready' }), {}, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({ token: 'token-1234' });

    fake.emitMessage(
      withNonce({
        source: PICKER_MESSAGE_SOURCE,
        kind: 'picked',
        files: [
          { id: 'file-1', name: 'a.pdf' },
          { id: 'file-2', name: 'b.pdf' },
        ],
      }),
    );
    await expect(promise).resolves.toEqual([
      { sourceFileId: 'file-1', filename: 'a.pdf' },
      { sourceFileId: 'file-2', filename: 'b.pdf' },
    ]);
    expect(fake.removeTab).toHaveBeenCalledWith(77);
    expect(fake.unsubscribeMessage).toHaveBeenCalled();
    expect(fake.unsubscribeTab).toHaveBeenCalled();
  });

  test('createNonce 省略時は crypto.randomUUID で nonce を作る', async () => {
    const fake = createFakeDeps({ createNonce: undefined });
    const promise = openPdfPicker(fake.deps);
    await flushMicrotasks();
    const url = fake.createTab.mock.calls[0]?.[0] as string;
    const nonce = new URLSearchParams(url.split('#')[1]).get('nonce');
    expect(nonce).toMatch(/[0-9a-f-]{36}/);
    // 生成された nonce で通常どおり完了できる
    fake.emitMessage({ source: PICKER_MESSAGE_SOURCE, kind: 'cancelled', nonce });
    await expect(promise).resolves.toBeNull();
  });

  test('picked の mimeType を素通しする（フォルダ + ファイル混在）', async () => {
    const fake = createFakeDeps();
    const promise = openPdfPicker(fake.deps);
    await flushMicrotasks();
    fake.emitMessage(
      withNonce({
        source: PICKER_MESSAGE_SOURCE,
        kind: 'picked',
        files: [
          { id: 'folder-1', name: 'fulltext', mimeType: 'application/vnd.google-apps.folder' },
          { id: 'file-1', name: 'a.pdf', mimeType: 'application/pdf' },
        ],
      }),
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
      withNonce({
        source: PICKER_MESSAGE_SOURCE,
        kind: 'picked',
        files: [{ id: 'file-1', name: 'a.pdf', mimeType: 42 }],
      }),
    );
    const result = await promise;
    expect(result).toEqual([{ sourceFileId: 'file-1', filename: 'a.pdf' }]);
    expect(result?.[0]?.mimeType).toBeUndefined();
  });

  test('cancelled で null を返しタブを閉じる', async () => {
    const fake = createFakeDeps();
    const promise = openPdfPicker(fake.deps);
    await flushMicrotasks();
    fake.emitMessage(withNonce({ source: PICKER_MESSAGE_SOURCE, kind: 'cancelled' }));
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
    fake.emitMessage(withNonce({ source: PICKER_MESSAGE_SOURCE, kind: 'cancelled' }));
    fake.emitTabRemoved(77); // 購読解除が no-op な fake なので settle 済みガードを通る
    await expect(promise).resolves.toBeNull();
    expect(fake.removeTab).toHaveBeenCalledTimes(1);
  });

  describe('トークン受け渡し境界の防御（issue #130）', () => {
    test('sender.url がホストページ URL と一致しないメッセージは無視する', async () => {
      const fake = createFakeDeps();
      const promise = openPdfPicker(fake.deps);
      await flushMicrotasks();
      const sendResponse = jest.fn();
      fake.emitMessage(
        withNonce({ source: PICKER_MESSAGE_SOURCE, kind: 'ready' }),
        { url: 'https://evil.example.com/picker.html' },
        sendResponse,
      );
      fake.emitMessage(
        withNonce({ source: PICKER_MESSAGE_SOURCE, kind: 'ready' }),
        { url: null },
        sendResponse,
      );
      expect(sendResponse).not.toHaveBeenCalled();
      // 正規のページからは応答できる
      fake.emitMessage(withNonce({ source: PICKER_MESSAGE_SOURCE, kind: 'cancelled' }));
      await expect(promise).resolves.toBeNull();
    });

    test('nonce が欠落・不一致のメッセージは無視する（旧デプロイページ対策）', async () => {
      const fake = createFakeDeps();
      const promise = openPdfPicker(fake.deps);
      await flushMicrotasks();
      const sendResponse = jest.fn();
      fake.emitMessage({ source: PICKER_MESSAGE_SOURCE, kind: 'ready' }, {}, sendResponse);
      fake.emitMessage(
        { source: PICKER_MESSAGE_SOURCE, kind: 'ready', nonce: 'wrong' },
        {},
        sendResponse,
      );
      expect(sendResponse).not.toHaveBeenCalled();
      fake.emitMessage(
        { source: PICKER_MESSAGE_SOURCE, kind: 'cancelled', nonce: 'wrong' },
      );
      fake.emitMessage(withNonce({ source: PICKER_MESSAGE_SOURCE, kind: 'cancelled' }));
      await expect(promise).resolves.toBeNull();
    });
  });

  test.each([
    ['別タブからのメッセージ', withNonce({ source: PICKER_MESSAGE_SOURCE, kind: 'cancelled' }), { tabId: 99 }],
    ['オブジェクトでない', 'not-an-object', {}],
    ['null', null, {}],
    ['source 不一致', withNonce({ source: 'other', kind: 'cancelled' }), {}],
    ['未知の kind', withNonce({ source: PICKER_MESSAGE_SOURCE, kind: 'unknown' }), {}],
    ['files が配列でない', withNonce({ source: PICKER_MESSAGE_SOURCE, kind: 'picked', files: 'x' }), {}],
    [
      'files 要素がオブジェクトでない',
      withNonce({ source: PICKER_MESSAGE_SOURCE, kind: 'picked', files: ['x'] }),
      {},
    ],
    [
      'files 要素が null',
      withNonce({ source: PICKER_MESSAGE_SOURCE, kind: 'picked', files: [null] }),
      {},
    ],
    [
      'files 要素の id が文字列でない',
      withNonce({ source: PICKER_MESSAGE_SOURCE, kind: 'picked', files: [{ id: 1, name: 'a.pdf' }] }),
      {},
    ],
    [
      'files 要素の id が空',
      withNonce({ source: PICKER_MESSAGE_SOURCE, kind: 'picked', files: [{ id: '', name: 'a.pdf' }] }),
      {},
    ],
    [
      'files 要素の name が文字列でない',
      withNonce({ source: PICKER_MESSAGE_SOURCE, kind: 'picked', files: [{ id: 'f1', name: 1 }] }),
      {},
    ],
  ])('不正メッセージは無視する: %s', async (_label, message, sender) => {
    const fake = createFakeDeps();
    const promise = openPdfPicker(fake.deps);
    await flushMicrotasks();
    fake.emitMessage(message, sender as Partial<PickerMessageSender>);
    // まだ未確定 → 正常キャンセルで終了できる
    fake.emitMessage(withNonce({ source: PICKER_MESSAGE_SOURCE, kind: 'cancelled' }));
    await expect(promise).resolves.toBeNull();
  });

  test('removeTab の失敗は握りつぶす（結果は確定済み）', async () => {
    const fake = createFakeDeps();
    fake.removeTab.mockRejectedValue(new Error('tab already closed'));
    const promise = openPdfPicker(fake.deps);
    await flushMicrotasks();
    fake.emitMessage(withNonce({ source: PICKER_MESSAGE_SOURCE, kind: 'cancelled' }));
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

describe('openSpreadsheetPicker（issue #130）', () => {
  test('view=spreadsheet + file_id + nonce のフラグメントでタブを開く', async () => {
    const fake = createFakeDeps();
    const promise = openSpreadsheetPicker(fake.deps, 'SID-9');
    await flushMicrotasks();
    expect(fake.createTab).toHaveBeenCalledWith(
      `${PAGE_URL}#extension_id=ext-id&view=spreadsheet&file_id=SID-9&nonce=${NONCE}`,
    );
    fake.emitMessage(withNonce({ source: PICKER_MESSAGE_SOURCE, kind: 'cancelled' }));
    await promise;
  });

  test('要求 ID と同じシートが選ばれたら granted', async () => {
    const fake = createFakeDeps();
    const promise = openSpreadsheetPicker(fake.deps, 'SID-9');
    await flushMicrotasks();
    fake.emitMessage(
      withNonce({
        source: PICKER_MESSAGE_SOURCE,
        kind: 'picked',
        files: [{ id: 'SID-9', name: 'プロジェクト', mimeType: 'application/vnd.google-apps.spreadsheet' }],
      }),
    );
    await expect(promise).resolves.toBe('granted');
  });

  test('別のシートが選ばれたら mismatch（全シートビューからの誤選択）', async () => {
    const fake = createFakeDeps();
    const promise = openSpreadsheetPicker(fake.deps, 'SID-9');
    await flushMicrotasks();
    fake.emitMessage(
      withNonce({
        source: PICKER_MESSAGE_SOURCE,
        kind: 'picked',
        files: [{ id: 'OTHER-1', name: '別のシート' }],
      }),
    );
    await expect(promise).resolves.toBe('mismatch');
  });

  test('キャンセル・選択 0 件は cancelled', async () => {
    const fake = createFakeDeps();
    const promise = openSpreadsheetPicker(fake.deps, 'SID-9');
    await flushMicrotasks();
    fake.emitMessage(withNonce({ source: PICKER_MESSAGE_SOURCE, kind: 'cancelled' }));
    await expect(promise).resolves.toBe('cancelled');

    const fake2 = createFakeDeps();
    const promise2 = openSpreadsheetPicker(fake2.deps, 'SID-9');
    await flushMicrotasks();
    fake2.emitMessage(
      withNonce({ source: PICKER_MESSAGE_SOURCE, kind: 'picked', files: [] }),
    );
    await expect(promise2).resolves.toBe('cancelled');
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

  test('extensionId / pickerPageUrl / getAccessToken / createNonce を配線する', async () => {
    const deps = createChromePickerDeps(google);
    expect(deps.extensionId).toBe('test-extension-id');
    expect(deps.pickerPageUrl).toBe(PICKER_PAGE_URL);
    await expect(deps.getAccessToken()).resolves.toBe('g-token');
    // createNonce は crypto.randomUUID（UUID 形式の乱数）
    expect(deps.createNonce?.()).toMatch(/[0-9a-f-]{36}/);
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

  test('外部メッセージリスナーは sender の tabId / url を渡し、解除関数が removeListener を呼ぶ', () => {
    const deps = createChromePickerDeps(google);
    const listener = jest.fn();
    const unsubscribe = deps.addExternalMessageListener(listener);

    const wrapped = chromeMock.runtime.onMessageExternal.addListener.mock.calls[0]?.[0] as (
      message: unknown,
      sender: { tab?: { id?: number }; url?: string },
      sendResponse: (response: unknown) => void,
    ) => void;
    const sendResponse = jest.fn();
    wrapped({ kind: 'x' }, { tab: { id: 3 }, url: 'https://host/picker.html#f' }, sendResponse);
    expect(listener).toHaveBeenCalledWith(
      { kind: 'x' },
      { tabId: 3, url: 'https://host/picker.html#f' },
      sendResponse,
    );

    // タブ外（別拡張ページ等）や url 欠落は null に落とす
    wrapped({ kind: 'x' }, {}, sendResponse);
    expect(listener).toHaveBeenLastCalledWith({ kind: 'x' }, { tabId: null, url: null }, sendResponse);

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
