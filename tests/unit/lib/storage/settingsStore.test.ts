import { installChromeMock, type ChromeMock } from '../../../setup/chrome-mock';
import { getRateLimitTier } from '../../../../src/lib/llm/rateLimitPolicy';
import {
  loadDefaultModel,
  loadRateLimitCustomConcurrency,
  loadRateLimitCustomRpm,
  loadRateLimitTier,
  loadVerifyLayoutMode,
  resolveRateLimitPolicy,
  saveDefaultModel,
  saveRateLimitCustomConcurrency,
  saveRateLimitCustomRpm,
  saveRateLimitTier,
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
