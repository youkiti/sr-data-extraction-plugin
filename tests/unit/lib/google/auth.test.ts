// 認証クライアント（SW ブローカーへのメッセージラッパ）のテスト。
// ブローカー本体のテストは tests/unit/background/authBroker.test.ts
import { installChromeMock, type ChromeMock } from '../../../setup/chrome-mock';
import {
  createChromeAuthClientDeps,
  forceReauth,
  getAccessToken,
  getSignedInEmail,
  signOut,
  type AuthClientDeps,
} from '../../../../src/lib/google/auth';
import type { AuthResponse } from '../../../../src/lib/google/authMessages';

function makeDeps(response: AuthResponse | undefined): AuthClientDeps {
  return { sendMessage: jest.fn(async () => response) };
}

describe('getAccessToken', () => {
  test('既定は interactive=false で依頼しトークンを返す', async () => {
    const deps = makeDeps({ ok: true, token: 'T' });
    await expect(getAccessToken(deps)).resolves.toBe('T');
    expect(deps.sendMessage).toHaveBeenCalledWith({ type: 'auth:get-token', interactive: false });
  });

  test('interactive=true を伝搬する', async () => {
    const deps = makeDeps({ ok: true, token: 'T' });
    await getAccessToken(deps, true);
    expect(deps.sendMessage).toHaveBeenCalledWith({ type: 'auth:get-token', interactive: true });
  });

  test('応答なし（SW 未起動）は reject', async () => {
    await expect(getAccessToken(makeDeps(undefined))).rejects.toThrow(/応答がありません/);
  });

  test('ok:false はブローカーのエラーメッセージで reject', async () => {
    await expect(
      getAccessToken(makeDeps({ ok: false, error: 'interaction_required' })),
    ).rejects.toThrow('interaction_required');
  });

  test('ok:true でも token 欠落は reject', async () => {
    await expect(getAccessToken(makeDeps({ ok: true }))).rejects.toThrow(/トークンがありません/);
  });
});

describe('getSignedInEmail', () => {
  test('email を返す', async () => {
    await expect(getSignedInEmail(makeDeps({ ok: true, email: 'me@example.com' }))).resolves.toBe(
      'me@example.com',
    );
  });

  test('email: null（未ログイン）は null', async () => {
    await expect(getSignedInEmail(makeDeps({ ok: true, email: null }))).resolves.toBeNull();
  });

  test('email フィールド欠落は null', async () => {
    await expect(getSignedInEmail(makeDeps({ ok: true }))).resolves.toBeNull();
  });

  test('ok:false / 応答なし / 送信例外は null（throw しない）', async () => {
    await expect(getSignedInEmail(makeDeps({ ok: false, error: 'x' }))).resolves.toBeNull();
    await expect(getSignedInEmail(makeDeps(undefined))).resolves.toBeNull();
    const throwing: AuthClientDeps = {
      sendMessage: jest.fn(async () => {
        throw new Error('sw down');
      }),
    };
    await expect(getSignedInEmail(throwing)).resolves.toBeNull();
  });
});

describe('forceReauth', () => {
  test('auth:force-reauth を依頼してトークンを返す', async () => {
    const deps = makeDeps({ ok: true, token: 'NEW' });
    await expect(forceReauth(deps)).resolves.toBe('NEW');
    expect(deps.sendMessage).toHaveBeenCalledWith({ type: 'auth:force-reauth' });
  });
});

describe('signOut', () => {
  test('auth:clear を依頼する', async () => {
    const deps = makeDeps({ ok: true });
    await expect(signOut(deps)).resolves.toBeUndefined();
    expect(deps.sendMessage).toHaveBeenCalledWith({ type: 'auth:clear' });
  });

  test('送信例外でも resolve する（ベストエフォート）', async () => {
    const deps: AuthClientDeps = {
      sendMessage: jest.fn(async () => {
        throw new Error('sw down');
      }),
    };
    await expect(signOut(deps)).resolves.toBeUndefined();
  });
});

describe('createChromeAuthClientDeps', () => {
  let chromeMock: ChromeMock;

  beforeEach(() => {
    chromeMock = installChromeMock();
  });

  test('chrome.runtime.sendMessage へメッセージをそのまま渡す', async () => {
    const deps = createChromeAuthClientDeps();
    await expect(getAccessToken(deps, true)).resolves.toBe('mock-token');
    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'auth:get-token',
      interactive: true,
    });
  });
});
