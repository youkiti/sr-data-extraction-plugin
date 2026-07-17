import { installChromeMock, type ChromeMock } from '../../../setup/chrome-mock';
import { createChromeGoogleApiDeps } from '../../../../src/app/services/factories';
import type { AuthClientDeps } from '../../../../src/lib/google/auth';

describe('createChromeGoogleApiDeps', () => {
  let chromeMock: ChromeMock;

  beforeEach(() => {
    chromeMock = installChromeMock();
  });

  test('auth 注入時: getAccessToken は interactive=true でブローカーへ依頼する', async () => {
    const auth: AuthClientDeps = {
      sendMessage: jest.fn(async () => ({ ok: true as const, token: 'TOKEN' })),
    };
    const deps = createChromeGoogleApiDeps(auth);
    await expect(deps.getAccessToken()).resolves.toBe('TOKEN');
    expect(auth.sendMessage).toHaveBeenCalledWith({ type: 'auth:get-token', interactive: true });
  });

  test('auth 未指定なら chrome.runtime.sendMessage から組み立てる', async () => {
    const deps = createChromeGoogleApiDeps();
    await expect(deps.getAccessToken()).resolves.toBe('mock-token');
    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'auth:get-token',
      interactive: true,
    });
  });

  test('fetch は globalThis.fetch へ委譲する', async () => {
    const fetchSpy = jest.fn().mockResolvedValue({ ok: true } as Response);
    (globalThis as { fetch: unknown }).fetch = fetchSpy;
    const deps = createChromeGoogleApiDeps();
    await deps.fetch('https://api/', { method: 'GET' });
    expect(fetchSpy).toHaveBeenCalledWith('https://api/', { method: 'GET' });
  });
});
