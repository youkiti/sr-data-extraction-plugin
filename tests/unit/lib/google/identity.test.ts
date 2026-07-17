import { installChromeMock, type ChromeMock } from '../../../setup/chrome-mock';
import {
  createChromeProfileDeps,
  getChromeProfileEmail,
  getCurrentUserEmail,
} from '../../../../src/lib/google/identity';
import type { AuthClientDeps } from '../../../../src/lib/google/auth';

describe('getCurrentUserEmail', () => {
  test('メールがあれば返す', async () => {
    const deps = {
      getProfileUserInfo: jest.fn().mockResolvedValue({ email: 'me@example.com', id: 'abc' }),
    };
    await expect(getCurrentUserEmail(deps)).resolves.toBe('me@example.com');
  });

  test('空文字は null', async () => {
    const deps = {
      getProfileUserInfo: jest.fn().mockResolvedValue({ email: '', id: '' }),
    };
    await expect(getCurrentUserEmail(deps)).resolves.toBeNull();
  });
});

describe('createChromeProfileDeps（userinfo ベース。issue #129）', () => {
  beforeEach(() => {
    installChromeMock();
  });

  test('注入した認証クライアント経由でメールを {email, id} 形式にして返す', async () => {
    const auth: AuthClientDeps = {
      sendMessage: jest.fn(async () => ({ ok: true as const, email: 'oauth@example.com' })),
    };
    const deps = createChromeProfileDeps(auth);
    await expect(deps.getProfileUserInfo()).resolves.toEqual({
      email: 'oauth@example.com',
      id: '',
    });
    expect(auth.sendMessage).toHaveBeenCalledWith({ type: 'auth:get-email' });
  });

  test('未ログイン（null）は email 空文字にする（インターフェース互換）', async () => {
    const auth: AuthClientDeps = {
      sendMessage: jest.fn(async () => ({ ok: true as const, email: null })),
    };
    const deps = createChromeProfileDeps(auth);
    await expect(deps.getProfileUserInfo()).resolves.toEqual({ email: '', id: '' });
  });

  test('auth 未指定なら chrome.runtime.sendMessage から組み立てる', async () => {
    const deps = createChromeProfileDeps();
    await expect(deps.getProfileUserInfo()).resolves.toEqual({
      email: 'tester@example.com',
      id: '',
    });
  });
});

describe('getChromeProfileEmail（login_hint シード / 不一致表示用）', () => {
  let chromeMock: ChromeMock;

  beforeEach(() => {
    chromeMock = installChromeMock();
  });

  test('chrome.identity.getProfileUserInfo のメールを返す', async () => {
    await expect(getChromeProfileEmail()).resolves.toBe('tester@example.com');
    expect(chromeMock.identity.getProfileUserInfo).toHaveBeenCalledWith(
      { accountStatus: 'ANY' },
      expect.any(Function),
    );
  });

  test('プロファイルにメールが無ければ null', async () => {
    chromeMock.identity.getProfileUserInfo.mockImplementation(
      (_opts: unknown, cb: (info: { email: string; id: string }) => void) => {
        cb({ email: '', id: '' });
      },
    );
    await expect(getChromeProfileEmail()).resolves.toBeNull();
  });
});
