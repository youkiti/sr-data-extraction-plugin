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
  };
  tabs: {
    create: jest.Mock;
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
    },
    tabs: {
      create: jest.fn(async () => ({})),
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
