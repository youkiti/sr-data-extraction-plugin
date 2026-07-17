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
    /** 認証ブローカーのトークンキャッシュ用（issue #129。local と同じ最小実装） */
    session: {
      data: Record<string, unknown>;
      get: jest.Mock;
      set: jest.Mock;
      remove: jest.Mock;
    };
  };
  runtime: {
    id: string;
    getURL: jest.Mock;
    /** exportService の tool_version 既定実装（chrome.runtime.getManifest().version）用 */
    getManifest: jest.Mock;
    /** 認証クライアント（lib/google/auth.ts）→ SW ブローカーへの依頼用 */
    sendMessage: jest.Mock;
    onInstalled: { addListener: jest.Mock };
    onMessageExternal: { addListener: jest.Mock; removeListener: jest.Mock };
    /** chrome.identity 系コールバック API のエラー通知。テストから直接設定する */
    lastError: { message: string } | undefined;
  };
  tabs: {
    create: jest.Mock;
    update: jest.Mock;
    remove: jest.Mock;
    onRemoved: { addListener: jest.Mock; removeListener: jest.Mock };
  };
  identity: {
    /** launchWebAuthFlow（既定は 2 スコープ付きの成功リダイレクトを返す） */
    launchWebAuthFlow: jest.Mock;
    getRedirectURL: jest.Mock;
    getProfileUserInfo: jest.Mock;
  };
  permissions: {
    request: jest.Mock;
  };
}

/** 既定の launchWebAuthFlow 成功リダイレクト（要求 2 スコープが揃った応答） */
export const MOCK_REDIRECT_URL =
  'https://test-extension-id.chromiumapp.org/#access_token=mock-token&expires_in=3600' +
  '&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fuserinfo.email%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fdrive.file';

function makeStorageArea(): {
  data: Record<string, unknown>;
  get: jest.Mock;
  set: jest.Mock;
  remove: jest.Mock;
} {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: jest.fn(async (key: string) => (key in data ? { [key]: data[key] } : {})),
    set: jest.fn(async (items: Record<string, unknown>) => {
      Object.assign(data, items);
    }),
    remove: jest.fn(async (key: string) => {
      delete data[key];
    }),
  };
}

export function installChromeMock(): ChromeMock {
  const mock: ChromeMock = {
    storage: {
      local: makeStorageArea(),
      session: makeStorageArea(),
    },
    runtime: {
      id: 'test-extension-id',
      getURL: jest.fn((path: string) => `chrome-extension://test-extension-id/${path}`),
      getManifest: jest.fn(() => ({ version: '0.0.0-test' })),
      // 既定はログイン済み相当の応答（認証ブローカーの正常応答を模す）。
      // 失敗させたいテストは mockImplementation / mockResolvedValue で上書きする
      sendMessage: jest.fn(async (message: { type?: string }) => {
        if (message?.type === 'auth:get-token' || message?.type === 'auth:force-reauth') {
          return { ok: true, token: 'mock-token' };
        }
        if (message?.type === 'auth:get-email') {
          return { ok: true, email: 'tester@example.com' };
        }
        if (message?.type === 'auth:clear') {
          return { ok: true };
        }
        return undefined;
      }),
      onInstalled: { addListener: jest.fn() },
      onMessageExternal: { addListener: jest.fn(), removeListener: jest.fn() },
      lastError: undefined,
    },
    tabs: {
      create: jest.fn(async () => ({})),
      update: jest.fn(async () => ({})),
      remove: jest.fn(async () => undefined),
      onRemoved: { addListener: jest.fn(), removeListener: jest.fn() },
    },
    identity: {
      launchWebAuthFlow: jest.fn(async () => MOCK_REDIRECT_URL),
      getRedirectURL: jest.fn(() => 'https://test-extension-id.chromiumapp.org/'),
      getProfileUserInfo: jest.fn(
        (
          _options: { accountStatus?: string },
          cb: (info: { email: string; id: string }) => void,
        ) => {
          cb({ email: 'tester@example.com', id: 'uid-1' });
        },
      ),
    },
    permissions: {
      request: jest.fn(async () => true),
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
