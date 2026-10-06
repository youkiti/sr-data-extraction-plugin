import { installChromeMock, type ChromeMock } from '../../../setup/chrome-mock';
import { createEmptyGuideProgress, suppressSuggestions } from '../../../../src/lib/guide/tourProgress';

type Store = typeof import('../../../../src/lib/storage/guideProgressStore');
type ChangeListener = Parameters<typeof chrome.storage.onChanged.addListener>[0];
let store: Store;
let mock: ChromeMock;
let listeners: Set<ChangeListener>;

beforeEach(async () => {
  jest.resetModules();
  mock = installChromeMock();
  listeners = new Set();
  Object.assign(mock.storage, {
    onChanged: {
      addListener: jest.fn((listener: ChangeListener) => { listeners.add(listener); }),
      removeListener: jest.fn((listener: ChangeListener) => { listeners.delete(listener); }),
    },
  });
  store = await import('../../../../src/lib/storage/guideProgressStore');
});

afterEach(() => { jest.restoreAllMocks(); });

function emit(changes: Record<string, chrome.storage.StorageChange>, area: chrome.storage.AreaName = 'local'): void {
  listeners.forEach(listener => listener(changes, area));
}

/** 保存処理の Promise が完了するまで次のタスクで待つ。 */
async function flush(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
}

test('初期値と初回読み込みの共有。以降の読み込みは最新の保持値を返す', async () => {
  expect(store.getGuideProgress()).toEqual(createEmptyGuideProgress());
  const saved = { ...createEmptyGuideProgress(), tours: { 'getting-started': { status: 'done', at: 'now' } } };
  mock.storage.local.data.guide_progress = saved;
  const results = await Promise.all([store.loadGuideProgress(), store.loadGuideProgress()]);
  expect(results).toEqual([saved, saved]);
  expect(mock.storage.local.get).toHaveBeenCalledTimes(1);
  store.updateGuideProgress(suppressSuggestions);
  expect(store.getGuideProgress().suppressSuggestions).toBe(true);
  await flush();
  expect(mock.storage.local.data.guide_progress).toEqual(store.getGuideProgress());
  expect(await store.loadGuideProgress()).toBe(store.getGuideProgress());
  expect(mock.storage.local.get).toHaveBeenCalledTimes(1);
});

test('未保存・壊れた保存値は既定値になる', async () => {
  expect(await store.loadGuideProgress()).toEqual(createEmptyGuideProgress());
  const unsubscribe = store.subscribeGuideProgressChange(jest.fn());
  emit({ guide_progress: { newValue: 'broken' } });
  expect(store.getGuideProgress()).toEqual(createEmptyGuideProgress());
  unsubscribe();
});

test('読み込み失敗は外へ投げず、既定値を保持する', async () => {
  const error = new Error('read failed');
  mock.storage.local.get.mockRejectedValueOnce(error);
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  await expect(store.loadGuideProgress()).resolves.toEqual(createEmptyGuideProgress());
  expect(warn).toHaveBeenCalledWith('[guide] 進行状態の読み込みに失敗:', error);
});

test('保存失敗は外へ投げず、更新済みの値を保持する', async () => {
  const error = new Error('write failed');
  mock.storage.local.set.mockRejectedValueOnce(error);
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  expect(() => store.updateGuideProgress(suppressSuggestions)).not.toThrow();
  await flush();
  expect(store.getGuideProgress().suppressSuggestions).toBe(true);
  expect(mock.storage.local.data.guide_progress).toBeUndefined();
  expect(warn).toHaveBeenCalledWith('[guide] 進行状態の保存に失敗:', error);
});

test('別タブの変更を購読者へ反映し、無関係の変更を無視し、解除後は通知しない', async () => {
  await store.loadGuideProgress();
  const observed: boolean[] = [];
  const first = jest.fn(() => { observed.push(store.getGuideProgress().suppressSuggestions); });
  const second = jest.fn();
  const unsubscribe = store.subscribeGuideProgressChange(first);
  const unsubscribeSecond = store.subscribeGuideProgressChange(second);
  const saved = suppressSuggestions(createEmptyGuideProgress());
  emit({ guide_progress: { newValue: saved } }, 'session');
  emit({ unrelated: { newValue: saved } });
  expect(first).not.toHaveBeenCalled();
  emit({ guide_progress: { newValue: saved } });
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenCalledTimes(1);
  expect(observed).toEqual([true]);
  expect(store.getGuideProgress()).toEqual(saved);
  expect(mock.storage.local.set).not.toHaveBeenCalled();
  unsubscribe();
  emit({ guide_progress: { oldValue: saved } });
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenCalledTimes(2);
  expect(store.getGuideProgress()).toEqual(createEmptyGuideProgress());
  unsubscribeSecond();
  expect(listeners.size).toBe(0);
});

test('あとでの抑止はセッション内だけで保存しない', () => {
  expect(store.isGuidePostponed()).toBe(false);
  store.postponeGuideSuggestions();
  expect(store.isGuidePostponed()).toBe(true);
  expect(mock.storage.local.set).not.toHaveBeenCalled();
  expect(store.getGuideProgress()).toEqual(createEmptyGuideProgress());
});

test.each([undefined, {}, { storage: {} }])('変更通知 API がない環境でも購読と解除は何もしない: %j', value => {
  const originalChrome = globalThis.chrome;
  try {
    Object.defineProperty(globalThis, 'chrome', { configurable: true, writable: true, value });
    const listener = jest.fn();
    const unsubscribe = store.subscribeGuideProgressChange(listener);
    expect(unsubscribe).not.toThrow();
    expect(listener).not.toHaveBeenCalled();
    expect(listeners.size).toBe(0);
  } finally {
    Object.defineProperty(globalThis, 'chrome', { configurable: true, writable: true, value: originalChrome });
  }
});
