import { installChromeMock, type ChromeMock } from '../../../setup/chrome-mock';
import {
  CONSULT_HINT_STORAGE_KEY,
  isConsultHintSeen,
  markConsultHintSeen,
} from '../../../../src/lib/storage/consultHintStore';

let mock: ChromeMock;

beforeEach(() => {
  mock = installChromeMock();
});

test('閉じたユーザーを chrome.storage.local の 1 キーに積み、ユーザーごとに判定する', async () => {
  expect(await isConsultHintSeen('a@example.com')).toBe(false);
  await markConsultHintSeen('a@example.com');
  await markConsultHintSeen('b@example.com');
  // 記録済みのユーザーは積み直さない
  await markConsultHintSeen('a@example.com');
  expect(mock.storage.local.data[CONSULT_HINT_STORAGE_KEY]).toEqual(['a@example.com', 'b@example.com']);
  expect(await isConsultHintSeen('a@example.com')).toBe(true);
  expect(await isConsultHintSeen('c@example.com')).toBe(false);
});

test.each([null, 'a@example.com', { 0: 'a@example.com' }])('壊れた値 %p は未記録として扱う', async (value) => {
  mock.storage.local.data[CONSULT_HINT_STORAGE_KEY] = value;
  expect(await isConsultHintSeen('a@example.com')).toBe(false);
});

test('配列の中の文字列以外は捨てる', async () => {
  mock.storage.local.data[CONSULT_HINT_STORAGE_KEY] = [1, 'a@example.com', null];
  expect(await isConsultHintSeen('a@example.com')).toBe(true);
  await markConsultHintSeen('b@example.com');
  expect(mock.storage.local.data[CONSULT_HINT_STORAGE_KEY]).toEqual(['a@example.com', 'b@example.com']);
});
