import { installChromeMock, type ChromeMock } from '../../../setup/chrome-mock';
import {
  createChromeProfileDeps,
  getCurrentUserEmail,
} from '../../../../src/lib/google/identity';

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

describe('createChromeProfileDeps', () => {
  let chromeMock: ChromeMock;

  beforeEach(() => {
    chromeMock = installChromeMock();
  });

  test('chrome.identity.getProfileUserInfo を accountStatus: ANY で呼んで {email, id} を resolve', async () => {
    const deps = createChromeProfileDeps();
    await expect(deps.getProfileUserInfo()).resolves.toEqual({
      email: 'tester@example.com',
      id: 'uid-1',
    });
    expect(chromeMock.identity.getProfileUserInfo).toHaveBeenCalledWith(
      { accountStatus: 'ANY' },
      expect.any(Function),
    );
  });
});
