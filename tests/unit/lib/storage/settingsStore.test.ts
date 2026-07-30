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
  usesOpenAiCompatibleEndpoint,
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

  test('LLM 接続設定: "anthropic" は保存済み接続方式として受理され、そのまま往復する（issue #127 PR2）', async () => {
    chromeMock.storage.local.data['settings.llmProvider'] = 'anthropic';
    await expect(loadLlmConnectionSettings()).resolves.toEqual({
      provider: 'anthropic',
      openAiCompatibleEndpoint: null,
    });
    await saveLlmConnectionSettings({ provider: 'anthropic' });
    await expect(loadLlmConnectionSettings()).resolves.toMatchObject({ provider: 'anthropic' });
  });

  test('LLM 接続設定: "azure_openai" は保存済み接続方式として受理され、そのまま往復する（issue #127 PR3）', async () => {
    chromeMock.storage.local.data['settings.llmProvider'] = 'azure_openai';
    await expect(loadLlmConnectionSettings()).resolves.toEqual({
      provider: 'azure_openai',
      openAiCompatibleEndpoint: null,
    });
    await saveLlmConnectionSettings({
      provider: 'azure_openai',
      openAiCompatibleEndpoint: 'https://res.openai.azure.com/openai/deployments/gpt/chat/completions?api-version=2026-01-01',
    });
    await expect(loadLlmConnectionSettings()).resolves.toEqual({
      provider: 'azure_openai',
      openAiCompatibleEndpoint:
        'https://res.openai.azure.com/openai/deployments/gpt/chat/completions?api-version=2026-01-01',
    });
  });

  test('LLM 接続設定: 未知の provider は後方互換の null', async () => {
    chromeMock.storage.local.data['settings.llmProvider'] = 'not-a-real-provider';
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
    await saveLlmConnectionSettings({ provider: 'anthropic' });
    await expect(loadLlmConnectionSettings()).resolves.toMatchObject({ provider: 'anthropic' });
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

  test('LLM 接続設定: Azure OpenAI provider も endpoint 必須（issue #127 PR3）', async () => {
    await expect(
      saveLlmConnectionSettings({ provider: 'azure_openai' }),
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
    ['https://llm.example/v1/chat/completions#x', 'フラグメント'],
  ])('OpenAI 互換 URL の不正値を拒否する: %s', (value, message) => {
    expect(() => normalizeOpenAiCompatibleEndpoint(value)).toThrow(message);
  });

  test('OpenAI 互換 URL は HTTPS の完全 URL を正規化する', () => {
    expect(normalizeOpenAiCompatibleEndpoint(' https://llm.example/v1/chat/completions ')).toBe(
      'https://llm.example/v1/chat/completions',
    );
  });

  // issue #127 PR3: Azure OpenAI はデプロイメント URL に必須の `?api-version=...` を
  // クエリ文字列として含む完全 URL を入力させるため、クエリ文字列は許可へ倒す
  // （フラグメントは引き続き拒否。埋め込み認証情報・HTTPS/loopback の各ガードは維持）
  test('OpenAI 互換 URL はクエリ文字列を許可する（Azure OpenAI の api-version 等）', () => {
    const value =
      'https://res.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2026-01-01';
    expect(normalizeOpenAiCompatibleEndpoint(value)).toBe(value);
  });

  test('クエリ文字列を許可しても、フラグメントは引き続き拒否する', () => {
    expect(() =>
      normalizeOpenAiCompatibleEndpoint('https://llm.example/v1/chat/completions?q=1#frag'),
    ).toThrow('フラグメント');
  });

  test('クエリ文字列を許可しても、埋め込み認証情報は引き続き拒否する', () => {
    expect(() =>
      normalizeOpenAiCompatibleEndpoint('https://user:pass@llm.example/v1/chat/completions?q=1'),
    ).toThrow('認証情報');
  });

  test('クエリ文字列を許可しても、非 HTTPS・非 loopback は引き続き拒否する', () => {
    expect(() =>
      normalizeOpenAiCompatibleEndpoint('http://llm.example/v1/chat/completions?q=1'),
    ).toThrow('HTTPS');
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

  test('usesOpenAiCompatibleEndpoint: openai_compatible / azure_openai だけ true（issue #127 PR3）', () => {
    expect(usesOpenAiCompatibleEndpoint('openai_compatible')).toBe(true);
    expect(usesOpenAiCompatibleEndpoint('azure_openai')).toBe(true);
    expect(usesOpenAiCompatibleEndpoint('gemini')).toBe(false);
    expect(usesOpenAiCompatibleEndpoint('openrouter')).toBe(false);
    expect(usesOpenAiCompatibleEndpoint('anthropic')).toBe(false);
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
