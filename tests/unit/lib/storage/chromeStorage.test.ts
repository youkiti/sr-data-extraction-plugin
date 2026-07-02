import { installChromeMock } from '../../../setup/chrome-mock';
import { getLocal, removeLocal, setLocal } from '../../../../src/lib/storage/chromeStorage';

describe('chromeStorage', () => {
  beforeEach(() => {
    installChromeMock();
  });

  test('setLocal → getLocal で値が往復する', async () => {
    await setLocal('key1', { a: 1 });
    await expect(getLocal('key1')).resolves.toEqual({ a: 1 });
  });

  test('未保存のキーは undefined', async () => {
    await expect(getLocal('missing')).resolves.toBeUndefined();
  });

  test('removeLocal で削除される', async () => {
    await setLocal('key1', 'value');
    await removeLocal('key1');
    await expect(getLocal('key1')).resolves.toBeUndefined();
  });
});
