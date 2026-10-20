import { installChromeMock, type ChromeMock } from '../../../setup/chrome-mock';
import {
  AI_DATA_CONSENT_STORAGE_KEY,
  AI_DATA_CONSENT_VERSION,
  clearAiDataConsent,
  isCurrentAiDataConsent,
  loadAiDataConsent,
  saveAiDataConsent,
} from '../../../../src/lib/storage/aiDataConsentStore';

let mock: ChromeMock;

beforeEach(() => {
  mock = installChromeMock();
});

test('保存・読み込み・削除を chrome.storage.local の 1 キーで行う', async () => {
  expect(await loadAiDataConsent()).toBeNull();
  await saveAiDataConsent({ version: 1, acceptedAt: '2026-10-20T00:00:00.000Z' });
  expect(mock.storage.local.data[AI_DATA_CONSENT_STORAGE_KEY]).toEqual({
    version: 1,
    acceptedAt: '2026-10-20T00:00:00.000Z',
  });
  expect(await loadAiDataConsent()).toEqual({ version: 1, acceptedAt: '2026-10-20T00:00:00.000Z' });
  await clearAiDataConsent();
  expect(await loadAiDataConsent()).toBeNull();
});

test.each([null, 'yes', 1, { version: '1', acceptedAt: 'x' }, { version: 1 }])(
  '壊れた値 %p は未同意として扱う',
  async (value) => {
    mock.storage.local.data[AI_DATA_CONSENT_STORAGE_KEY] = value;
    expect(await loadAiDataConsent()).toBeNull();
  },
);

test('余計な項目は読み込み時に落とす', async () => {
  mock.storage.local.data[AI_DATA_CONSENT_STORAGE_KEY] = { version: 1, acceptedAt: 'a', extra: true };
  expect(await loadAiDataConsent()).toEqual({ version: 1, acceptedAt: 'a' });
});

test('現在の同意文の版の記録だけを有効とする', () => {
  expect(isCurrentAiDataConsent(null)).toBe(false);
  expect(isCurrentAiDataConsent({ version: AI_DATA_CONSENT_VERSION, acceptedAt: 'a' })).toBe(true);
  expect(isCurrentAiDataConsent({ version: AI_DATA_CONSENT_VERSION + 1, acceptedAt: 'a' })).toBe(false);
});
