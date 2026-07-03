import { installChromeMock, type ChromeMock } from '../../../setup/chrome-mock';
import {
  createChromeAuthDeps,
  getAccessToken,
  refreshAccessToken,
} from '../../../../src/lib/google/auth';

describe('getAccessToken / refreshAccessToken', () => {
  test('getAccessToken は deps.getAuthToken({interactive}) を呼ぶ', async () => {
    const deps = {
      getAuthToken: jest.fn().mockResolvedValue('T'),
      removeCachedAuthToken: jest.fn().mockResolvedValue(undefined),
    };
    await expect(getAccessToken(deps)).resolves.toBe('T');
    expect(deps.getAuthToken).toHaveBeenCalledWith({ interactive: false });
  });

  test('interactive=true で対話フローを要求できる', async () => {
    const deps = {
      getAuthToken: jest.fn().mockResolvedValue('T'),
      removeCachedAuthToken: jest.fn(),
    };
    await getAccessToken(deps, true);
    expect(deps.getAuthToken).toHaveBeenCalledWith({ interactive: true });
  });

  test('refreshAccessToken は失効トークンを無効化して再取得する', async () => {
    const deps = {
      getAuthToken: jest.fn().mockResolvedValue('NEW'),
      removeCachedAuthToken: jest.fn().mockResolvedValue(undefined),
    };
    await expect(refreshAccessToken(deps, 'STALE')).resolves.toBe('NEW');
    expect(deps.removeCachedAuthToken).toHaveBeenCalledWith('STALE');
    expect(deps.getAuthToken).toHaveBeenCalledWith({ interactive: true });
  });
});

describe('createChromeAuthDeps', () => {
  let chromeMock: ChromeMock;

  beforeEach(() => {
    chromeMock = installChromeMock();
  });

  test('getAuthToken が token を返す（lastError なし）', async () => {
    const deps = createChromeAuthDeps();
    await expect(deps.getAuthToken()).resolves.toBe('mock-token');
  });

  test('getAuthToken が GetAuthTokenResult 形式（{token}）でも解決する', async () => {
    chromeMock.identity.getAuthToken.mockImplementation(
      (_opts: unknown, cb: (result: { token?: string }) => void) => {
        cb({ token: 'object-token' });
      },
    );
    const deps = createChromeAuthDeps();
    await expect(deps.getAuthToken()).resolves.toBe('object-token');
  });

  test('getAuthToken が lastError を返すと reject', async () => {
    chromeMock.identity.getAuthToken.mockImplementation(
      (_opts: unknown, cb: (token?: string) => void) => {
        chromeMock.runtime.lastError = { message: 'denied' };
        cb(undefined);
        chromeMock.runtime.lastError = undefined;
      },
    );
    const deps = createChromeAuthDeps();
    await expect(deps.getAuthToken()).rejects.toThrow(/denied/);
  });

  test('token が空でも reject', async () => {
    chromeMock.identity.getAuthToken.mockImplementation(
      (_opts: unknown, cb: (token?: string) => void) => {
        cb(undefined);
      },
    );
    const deps = createChromeAuthDeps();
    await expect(deps.getAuthToken()).rejects.toThrow(/empty/);
  });

  test('removeCachedAuthToken は resolve する', async () => {
    const deps = createChromeAuthDeps();
    await expect(deps.removeCachedAuthToken('TOK')).resolves.toBeUndefined();
    expect(chromeMock.identity.removeCachedAuthToken).toHaveBeenCalledWith(
      { token: 'TOK' },
      expect.any(Function),
    );
  });
});
