import { installChromeMock, type ChromeMock } from '../../../setup/chrome-mock';
import {
  loadDefaultModel,
  loadLlmConnectionSettings,
  isLoopbackEndpoint,
  normalizeOpenAiCompatibleEndpoint,
  saveDefaultModel,
  saveLlmConnectionSettings,
} from '../../../../src/lib/storage/settingsStore';

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

  test('LLM 接続設定: 未設定と不正 provider は後方互換の null', async () => {
    await expect(loadLlmConnectionSettings()).resolves.toEqual({
      provider: null,
      openAiCompatibleEndpoint: null,
    });
    chromeMock.storage.local.data['settings.llmProvider'] = 'unknown';
    chromeMock.storage.local.data['settings.openAiCompatibleEndpoint'] = '   ';
    await expect(loadLlmConnectionSettings()).resolves.toEqual({
      provider: null,
      openAiCompatibleEndpoint: null,
    });
  });

  test('LLM 接続設定: provider と正規化した OpenAI 互換 URL を保存・復元する', async () => {
    await saveLlmConnectionSettings({
      provider: 'openai_compatible',
      openAiCompatibleEndpoint: ' https://llm.example/v1/chat/completions ',
    });
    await expect(loadLlmConnectionSettings()).resolves.toEqual({
      provider: 'openai_compatible',
      openAiCompatibleEndpoint: 'https://llm.example/v1/chat/completions',
    });
  });

  test('LLM 接続設定: Gemini / OpenRouter は endpoint を削除して保存できる', async () => {
    chromeMock.storage.local.data['settings.openAiCompatibleEndpoint'] =
      'https://old.example/v1/chat/completions';
    await saveLlmConnectionSettings({ provider: 'gemini' });
    await expect(loadLlmConnectionSettings()).resolves.toMatchObject({ provider: 'gemini' });
    expect(chromeMock.storage.local.remove).toHaveBeenCalledWith(
      'settings.openAiCompatibleEndpoint',
    );
    await saveLlmConnectionSettings({ provider: 'openrouter' });
    await expect(loadLlmConnectionSettings()).resolves.toMatchObject({ provider: 'openrouter' });
  });

  test('LLM 接続設定: 未対応 provider は拒否する', async () => {
    await expect(
      saveLlmConnectionSettings({ provider: 'invalid' as 'gemini' }),
    ).rejects.toThrow('未対応');
  });

  test('LLM 接続設定: OpenAI 互換 provider は endpoint 必須', async () => {
    await expect(
      saveLlmConnectionSettings({ provider: 'openai_compatible' }),
    ).rejects.toThrow('有効な API エンドポイント');
  });

  test.each([
    ['', '有効な API エンドポイント'],
    ['not-a-url', '有効な API エンドポイント'],
    ['http://llm.example/v1/chat/completions', 'HTTPS'],
    ['http://localhost.example.com/v1/chat/completions', 'HTTPS'],
    ['http://192.168.1.10:11434/v1/chat/completions', 'HTTPS'],
    ['http://127.0.0.2:11434/v1/chat/completions', 'HTTPS'],
    ['https://user:pass@llm.example/v1/chat/completions', '認証情報'],
    ['https://llm.example/v1/chat/completions?q=1', 'クエリ文字列'],
    ['https://llm.example/v1/chat/completions#x', 'クエリ文字列'],
  ])('OpenAI 互換 URL の不正値を拒否する: %s', (value, message) => {
    expect(() => normalizeOpenAiCompatibleEndpoint(value)).toThrow(message);
  });

  test('OpenAI 互換 URL は HTTPS の完全 URL を正規化する', () => {
    expect(normalizeOpenAiCompatibleEndpoint(' https://llm.example/v1/chat/completions ')).toBe(
      'https://llm.example/v1/chat/completions',
    );
  });

  test.each([
    'http://localhost:11434/v1/chat/completions',
    'http://127.0.0.1:1234/v1/chat/completions',
    'http://[::1]:8080/v1/chat/completions',
  ])('OpenAI 互換 URL は完全一致の loopback HTTP を許可する: %s', (value) => {
    expect(normalizeOpenAiCompatibleEndpoint(value)).toBe(value);
    expect(isLoopbackEndpoint(value)).toBe(true);
  });

  test('HTTPS は非標準ポートを許可し、loopback HTTP とは判定しない', () => {
    const value = 'https://llm.example:8443/v1/chat/completions';
    expect(normalizeOpenAiCompatibleEndpoint(value)).toBe(value);
    expect(isLoopbackEndpoint(value)).toBe(false);
  });
});
