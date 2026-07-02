import { installChromeMock } from '../../../setup/chrome-mock';
import {
  clearGeminiApiKey,
  loadGeminiApiKey,
  saveGeminiApiKey,
} from '../../../../src/lib/storage/secretsStore';

describe('secretsStore', () => {
  beforeEach(() => {
    installChromeMock();
  });

  test('未設定なら null', async () => {
    await expect(loadGeminiApiKey()).resolves.toBeNull();
  });

  test('trim して保存し、読み出せる', async () => {
    await saveGeminiApiKey('  AIzaSyTESTKEY  ');
    await expect(loadGeminiApiKey()).resolves.toBe('AIzaSyTESTKEY');
  });

  test('空文字（空白のみ含む）は保存を拒否する', async () => {
    await expect(saveGeminiApiKey('   ')).rejects.toThrow('空の API キー');
    await expect(loadGeminiApiKey()).resolves.toBeNull();
  });

  test('clear で削除される', async () => {
    await saveGeminiApiKey('AIzaSyTESTKEY');
    await clearGeminiApiKey();
    await expect(loadGeminiApiKey()).resolves.toBeNull();
  });
});
