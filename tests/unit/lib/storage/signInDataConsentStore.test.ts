import { installChromeMock, type ChromeMock } from '../../../setup/chrome-mock';
import {
  SIGN_IN_DATA_CONSENT_STORAGE_KEY,
  SIGN_IN_DATA_CONSENT_VERSION,
  clearSignInDataConsent,
  isCurrentSignInDataConsent,
  loadSignInDataConsent,
  saveSignInDataConsent,
} from '../../../../src/lib/storage/signInDataConsentStore';

let mock: ChromeMock;

beforeEach(() => {
  mock = installChromeMock();
});

test('保存・読み込み・削除を chrome.storage.local の 1 キーで行う', async () => {
  expect(await loadSignInDataConsent()).toBeNull();
  await saveSignInDataConsent({ version: 1, acceptedAt: '2026-10-20T00:00:00.000Z' });
  expect(mock.storage.local.data[SIGN_IN_DATA_CONSENT_STORAGE_KEY]).toEqual({
    version: 1,
    acceptedAt: '2026-10-20T00:00:00.000Z',
  });
  expect(await loadSignInDataConsent()).toEqual({ version: 1, acceptedAt: '2026-10-20T00:00:00.000Z' });
  await clearSignInDataConsent();
  expect(await loadSignInDataConsent()).toBeNull();
});

test.each([null, 'yes', 1, { version: '1', acceptedAt: 'x' }, { version: 1 }])(
  '壊れた値 %p は未同意として扱う',
  async (value) => {
    mock.storage.local.data[SIGN_IN_DATA_CONSENT_STORAGE_KEY] = value;
    expect(await loadSignInDataConsent()).toBeNull();
  },
);

test('余計な項目は読み込み時に落とす', async () => {
  mock.storage.local.data[SIGN_IN_DATA_CONSENT_STORAGE_KEY] = { version: 1, acceptedAt: 'a', extra: true };
  expect(await loadSignInDataConsent()).toEqual({ version: 1, acceptedAt: 'a' });
});

test('現在の同意文の版の記録だけを有効とする', () => {
  expect(isCurrentSignInDataConsent(null)).toBe(false);
  expect(isCurrentSignInDataConsent({ version: SIGN_IN_DATA_CONSENT_VERSION, acceptedAt: 'a' })).toBe(true);
  expect(isCurrentSignInDataConsent({ version: SIGN_IN_DATA_CONSENT_VERSION + 1, acceptedAt: 'a' })).toBe(false);
});
