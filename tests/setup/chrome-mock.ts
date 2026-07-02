// jest 用の chrome.* API モック（jest.config.ts の setupFiles で全テストファイルへ注入）。
// 必要になった API から順に追加する最小実装。テスト内で状態をリセットしたい場合は
// installChromeMock() を beforeEach で呼び直す
export interface ChromeMock {
  storage: {
    local: {
      /** モックが内部に持つ保存済みデータ（テストからの直接検査用） */
      data: Record<string, unknown>;
      get: jest.Mock;
      set: jest.Mock;
      remove: jest.Mock;
    };
  };
  runtime: {
    getURL: jest.Mock;
    onInstalled: { addListener: jest.Mock };
    /** chrome.identity 系コールバック API のエラー通知。テストから直接設定する */
    lastError: { message: string } | undefined;
  };
  tabs: {
    create: jest.Mock;
  };
  identity: {
    getAuthToken: jest.Mock;
    removeCachedAuthToken: jest.Mock;
    getProfileUserInfo: jest.Mock;
  };
}

export function installChromeMock(): ChromeMock {
  const data: Record<string, unknown> = {};
  const mock: ChromeMock = {
    storage: {
      local: {
        data,
        get: jest.fn(async (key: string) => (key in data ? { [key]: data[key] } : {})),
        set: jest.fn(async (items: Record<string, unknown>) => {
          Object.assign(data, items);
        }),
        remove: jest.fn(async (key: string) => {
          delete data[key];
        }),
      },
    },
    runtime: {
      getURL: jest.fn((path: string) => `chrome-extension://test-extension-id/${path}`),
      onInstalled: { addListener: jest.fn() },
      lastError: undefined,
    },
    tabs: {
      create: jest.fn(async () => ({})),
    },
    identity: {
      // 既定はログイン済み（トークン取得成功）。失敗させたいテストは
      // mockImplementation で cb(undefined) + runtime.lastError を設定する
      getAuthToken: jest.fn(
        (_options: { interactive?: boolean }, cb: (token?: string) => void) => {
          cb('mock-token');
        },
      ),
      removeCachedAuthToken: jest.fn((_details: { token: string }, cb: () => void) => {
        cb();
      }),
      getProfileUserInfo: jest.fn(
        (
          _options: { accountStatus?: string },
          cb: (info: { email: string; id: string }) => void,
        ) => {
          cb({ email: 'tester@example.com', id: 'uid-1' });
        },
      ),
    },
  };
  (globalThis as Record<string, unknown>).chrome = mock;
  return mock;
}

installChromeMock();

// jsdom が crypto.randomUUID を持たない場合に備えたポリフィル（utils/uuid のテスト用）
if (typeof globalThis.crypto === 'undefined') {
  (globalThis as Record<string, unknown>).crypto = {};
}
if (typeof globalThis.crypto.randomUUID !== 'function') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeCrypto = require('node:crypto') as typeof import('node:crypto');
  (globalThis.crypto as { randomUUID: () => string }).randomUUID = () =>
    nodeCrypto.randomUUID();
}
