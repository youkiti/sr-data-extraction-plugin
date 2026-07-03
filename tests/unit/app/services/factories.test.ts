import { installChromeMock, type ChromeMock } from '../../../setup/chrome-mock';
import { createChromeGoogleApiDeps } from '../../../../src/app/services/factories';

describe('createChromeGoogleApiDeps', () => {
  let chromeMock: ChromeMock;

  beforeEach(() => {
    chromeMock = installChromeMock();
  });

  test('auth 注入時: getAccessToken は interactive=true で委譲する', async () => {
    const auth = {
      getAuthToken: jest.fn().mockResolvedValue('TOKEN'),
      removeCachedAuthToken: jest.fn(),
    };
    const deps = createChromeGoogleApiDeps(auth);
    await expect(deps.getAccessToken()).resolves.toBe('TOKEN');
    expect(auth.getAuthToken).toHaveBeenCalledWith({ interactive: true });
  });

  test('auth 未指定なら chrome.identity から組み立てる', async () => {
    const deps = createChromeGoogleApiDeps();
    await expect(deps.getAccessToken()).resolves.toBe('mock-token');
    expect(chromeMock.identity.getAuthToken).toHaveBeenCalledWith(
      { interactive: true },
      expect.any(Function),
    );
  });

  test('fetch は globalThis.fetch へ委譲する', async () => {
    const fetchSpy = jest.fn().mockResolvedValue({ ok: true } as Response);
    (globalThis as { fetch: unknown }).fetch = fetchSpy;
    const deps = createChromeGoogleApiDeps();
    await deps.fetch('https://api/', { method: 'GET' });
    expect(fetchSpy).toHaveBeenCalledWith('https://api/', { method: 'GET' });
  });
});
