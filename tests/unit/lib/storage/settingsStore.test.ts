import { installChromeMock, type ChromeMock } from '../../../setup/chrome-mock';
import { loadDefaultModel, saveDefaultModel } from '../../../../src/lib/storage/settingsStore';

describe('settingsStore', () => {
  let chromeMock: ChromeMock;

  beforeEach(() => {
    chromeMock = installChromeMock();
  });

  test('未設定なら null', async () => {
    await expect(loadDefaultModel()).resolves.toBeNull();
  });

  test('trim して保存し、読み出せる', async () => {
    await saveDefaultModel('  gemini-2.5-pro  ');
    await expect(loadDefaultModel()).resolves.toBe('gemini-2.5-pro');
    expect(chromeMock.storage.local.data['settings.defaultModel']).toBe('gemini-2.5-pro');
  });

  test('空文字（空白のみ含む）は「未設定に戻す」= キー削除', async () => {
    await saveDefaultModel('gemini-2.5-pro');
    await saveDefaultModel('   ');
    expect(chromeMock.storage.local.remove).toHaveBeenCalledWith('settings.defaultModel');
    await expect(loadDefaultModel()).resolves.toBeNull();
  });
});
