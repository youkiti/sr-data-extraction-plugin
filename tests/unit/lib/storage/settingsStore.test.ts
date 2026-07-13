import { installChromeMock, type ChromeMock } from '../../../setup/chrome-mock';
import { getRateLimitTier } from '../../../../src/lib/llm/rateLimitPolicy';
import {
  isLoopbackEndpoint,
  loadDefaultModel,
  loadLlmConnectionSettings,
  loadRateLimitCustomConcurrency,
  loadRateLimitCustomRpm,
  loadRateLimitTier,
  loadUiLanguage,
  normalizeOpenAiCompatibleEndpoint,
  loadVerifyLayoutMode,
  resolveRateLimitPolicy,
  saveDefaultModel,
  saveLlmConnectionSettings,
  saveRateLimitCustomConcurrency,
  saveRateLimitCustomRpm,
  saveRateLimitTier,
  saveUiLanguage,
  saveVerifyLayoutMode,
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

describe('settingsStore レート制限 tier', () => {
  beforeEach(() => {
    installChromeMock();
  });

  test('未設定なら既定 tier（gemini_free）', async () => {
    await expect(loadRateLimitTier()).resolves.toBe('gemini_free');
  });

  test('不正な保存値は既定 tier へフォールバック', async () => {
    await saveRateLimitTier('gemini_tier2');
    // storage を直接汚す
    const mock = installChromeMock();
    mock.storage.local.data['settings.rateLimitTier'] = 'bogus';
    await expect(loadRateLimitTier()).resolves.toBe('gemini_free');
  });

  test('tier を保存して読み出せる', async () => {
    await saveRateLimitTier('gemini_tier1');
    await expect(loadRateLimitTier()).resolves.toBe('gemini_tier1');
  });

  test('カスタム RPM: 正の整数のみ保存、それ以外はキー削除', async () => {
    await saveRateLimitCustomRpm(45);
    await expect(loadRateLimitCustomRpm()).resolves.toBe(45);
    // 小数は切り捨てて保存
    await saveRateLimitCustomRpm(45.9);
    await expect(loadRateLimitCustomRpm()).resolves.toBe(45);
    // 非正 / NaN は削除
    const mock = installChromeMock();
    mock.storage.local.data['settings.rateLimitCustomRpm'] = 10;
    await saveRateLimitCustomRpm(0);
    expect(mock.storage.local.remove).toHaveBeenCalledWith('settings.rateLimitCustomRpm');
    await expect(loadRateLimitCustomRpm()).resolves.toBeNull();
  });

  test('カスタム RPM: 保存済みが非正・非数値なら null', async () => {
    const mock = installChromeMock();
    mock.storage.local.data['settings.rateLimitCustomRpm'] = -5;
    await expect(loadRateLimitCustomRpm()).resolves.toBeNull();
  });

  test('resolveRateLimitPolicy: 保存 tier のプリセットを返す', async () => {
    await saveRateLimitTier('gemini_tier1');
    await expect(resolveRateLimitPolicy()).resolves.toEqual(getRateLimitTier('gemini_tier1').policy);
  });

  test('resolveRateLimitPolicy: カスタム tier は保存 RPM で上書きする', async () => {
    await saveRateLimitTier('custom');
    await saveRateLimitCustomRpm(77);
    const policy = await resolveRateLimitPolicy();
    expect(policy.requestsPerMinute).toBe(77);
  });

  test('カスタム同時実行数: 正の整数のみ保存、それ以外はキー削除', async () => {
    await saveRateLimitCustomConcurrency(4);
    await expect(loadRateLimitCustomConcurrency()).resolves.toBe(4);
    // 小数は切り捨て
    await saveRateLimitCustomConcurrency(4.9);
    await expect(loadRateLimitCustomConcurrency()).resolves.toBe(4);
    // 非正 / NaN は削除
    const mock = installChromeMock();
    mock.storage.local.data['settings.rateLimitCustomConcurrency'] = 3;
    await saveRateLimitCustomConcurrency(0);
    expect(mock.storage.local.remove).toHaveBeenCalledWith('settings.rateLimitCustomConcurrency');
    await expect(loadRateLimitCustomConcurrency()).resolves.toBeNull();
  });

  test('カスタム同時実行数: 保存済みが非正・非数値なら null', async () => {
    const mock = installChromeMock();
    mock.storage.local.data['settings.rateLimitCustomConcurrency'] = -1;
    await expect(loadRateLimitCustomConcurrency()).resolves.toBeNull();
  });

  test('resolveRateLimitPolicy: カスタム tier は保存 concurrency で上書きする', async () => {
    await saveRateLimitTier('custom');
    await saveRateLimitCustomConcurrency(3);
    const policy = await resolveRateLimitPolicy();
    expect(policy.maxConcurrency).toBe(3);
  });

  test('resolveRateLimitPolicy: 未設定は既定（gemini_free）', async () => {
    await expect(resolveRateLimitPolicy()).resolves.toEqual(getRateLimitTier('gemini_free').policy);
  });
});

describe('settingsStore 検証パネルのレイアウトモード（issue #38）', () => {
  beforeEach(() => {
    installChromeMock();
  });

  test('未設定なら既定 focus', async () => {
    await expect(loadVerifyLayoutMode()).resolves.toBe('focus');
  });

  test('不正な保存値は既定 focus へフォールバック', async () => {
    const mock = installChromeMock();
    mock.storage.local.data['settings.verifyLayoutMode'] = 'grid';
    await expect(loadVerifyLayoutMode()).resolves.toBe('focus');
  });

  test('保存して読み出せる', async () => {
    await saveVerifyLayoutMode('list');
    await expect(loadVerifyLayoutMode()).resolves.toBe('list');
    await saveVerifyLayoutMode('focus');
    await expect(loadVerifyLayoutMode()).resolves.toBe('focus');
  });
});

describe('settingsStore UI 表示言語（issue #93）', () => {
  beforeEach(() => {
    installChromeMock();
  });

  test('未設定なら既定 ja', async () => {
    await expect(loadUiLanguage()).resolves.toBe('ja');
  });

  test('不正な保存値は既定 ja へフォールバック', async () => {
    const mock = installChromeMock();
    mock.storage.local.data['settings.uiLanguage'] = 'fr';
    await expect(loadUiLanguage()).resolves.toBe('ja');
  });

  test('保存して読み出せる', async () => {
    const mock = installChromeMock();
    await saveUiLanguage('en');
    expect(mock.storage.local.data['settings.uiLanguage']).toBe('en');
    await expect(loadUiLanguage()).resolves.toBe('en');
    await saveUiLanguage('ja');
    await expect(loadUiLanguage()).resolves.toBe('ja');
  });
});
