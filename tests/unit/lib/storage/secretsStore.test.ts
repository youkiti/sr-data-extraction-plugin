import { installChromeMock } from '../../../setup/chrome-mock';
import {
  clearGeminiApiKey,
  clearOpenAiCompatibleApiKey,
  clearOpenRouterApiKey,
  loadGeminiApiKey,
  loadOpenAiCompatibleApiKey,
  loadOpenRouterApiKey,
  looksLikeGeminiApiKey,
  looksLikeOpenRouterApiKey,
  saveGeminiApiKey,
  saveOpenAiCompatibleApiKey,
  saveOpenRouterApiKey,
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

  test('OpenRouter キー: 未設定なら null、trim して保存し、読み出せる', async () => {
    await expect(loadOpenRouterApiKey()).resolves.toBeNull();
    await saveOpenRouterApiKey('  sk-or-TESTKEY  ');
    await expect(loadOpenRouterApiKey()).resolves.toBe('sk-or-TESTKEY');
  });

  test('OpenRouter キー: 空文字（空白のみ含む）は保存を拒否する', async () => {
    await expect(saveOpenRouterApiKey('   ')).rejects.toThrow('空の API キー');
    await expect(loadOpenRouterApiKey()).resolves.toBeNull();
  });

  test('OpenRouter キー: Gemini キーとは独立に保存・削除される', async () => {
    await saveGeminiApiKey('AIzaSyTESTKEY');
    await saveOpenRouterApiKey('sk-or-TESTKEY');
    await clearOpenRouterApiKey();
    await expect(loadOpenRouterApiKey()).resolves.toBeNull();
    await expect(loadGeminiApiKey()).resolves.toBe('AIzaSyTESTKEY');
  });

  test('looksLikeGeminiApiKey: AIza 始まりのみ true', () => {
    expect(looksLikeGeminiApiKey('AIzaSyTESTKEY')).toBe(true);
    expect(looksLikeGeminiApiKey('sk-or-TESTKEY')).toBe(false);
    expect(looksLikeGeminiApiKey('other')).toBe(false);
  });

  test('looksLikeOpenRouterApiKey: sk-or- 始まりのみ true', () => {
    expect(looksLikeOpenRouterApiKey('sk-or-TESTKEY')).toBe(true);
    expect(looksLikeOpenRouterApiKey('AIzaSyTESTKEY')).toBe(false);
    expect(looksLikeOpenRouterApiKey('sk-TESTKEY')).toBe(false);
  });

  test('OpenAI 互換 API キー: 独立して trim 保存・削除できる', async () => {
    await expect(loadOpenAiCompatibleApiKey()).resolves.toBeNull();
    await saveOpenAiCompatibleApiKey('  custom-secret  ');
    await expect(loadOpenAiCompatibleApiKey()).resolves.toBe('custom-secret');
    await clearOpenAiCompatibleApiKey();
    await expect(loadOpenAiCompatibleApiKey()).resolves.toBeNull();
  });

  test('OpenAI 互換 API キー: 空文字を拒否する', async () => {
    await expect(saveOpenAiCompatibleApiKey('   ')).rejects.toThrow('空の API キー');
  });
});
