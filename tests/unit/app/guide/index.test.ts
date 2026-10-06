import { initGuide } from '../../../../src/app/guide';
import { createStore, createInitialState, type Store } from '../../../../src/app/store';
import { createEmptyGuideProgress, type GuideProgress } from '../../../../src/lib/guide/tourProgress';
import * as storage from '../../../../src/lib/storage/guideProgressStore';
import { createTourRunner } from '../../../../src/app/guide/tourRunner';
import { setUiLanguage, t } from '../../../../src/lib/i18n';

jest.mock('../../../../src/lib/storage/guideProgressStore');
jest.mock('../../../../src/app/guide/tourRunner');
let store: Store;
let progress: GuideProgress;
let postponed: boolean;
let listeners: Set<() => void>;
const runner = { start: jest.fn(), resume: jest.fn(), stop: jest.fn(), handleEvent: jest.fn(), rerender: jest.fn() };
const band = (): HTMLElement | null => document.getElementById('guide-suggest-band');
const click = (name: string): void => document.querySelector<HTMLButtonElement>(`#guide-suggest-band [data-guide-action="${name}"]`)!.click();
beforeEach(() => {
  document.body.innerHTML = '<button id="app-open-tours">ツアー</button><main id="app-content"></main>';
  window.history.replaceState(null, '', '#/home');
  const state = createInitialState(); state.role.role = 'owner'; store = createStore(state);
  progress = createEmptyGuideProgress(); postponed = false; listeners = new Set();
  jest.mocked(storage.loadGuideProgress).mockResolvedValue(progress);
  jest.mocked(storage.getGuideProgress).mockImplementation(() => progress);
  jest.mocked(storage.updateGuideProgress).mockImplementation(update => { progress = update(progress); });
  jest.mocked(storage.isGuidePostponed).mockImplementation(() => postponed);
  jest.mocked(storage.postponeGuideSuggestions).mockImplementation(() => { postponed = true; });
  jest.mocked(storage.subscribeGuideProgressChange).mockImplementation(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; });
  jest.mocked(createTourRunner).mockReturnValue(runner);
  runner.start.mockImplementation(() => { progress.active = { tourId: 'getting-started', stepIndex: 0, stepId: 'open-documents' }; });
});
afterEach(() => { window.dispatchEvent(new Event('pagehide')); });
test('入口が無い環境は何もしない', async () => {
  document.getElementById('app-open-tours')!.remove();
  await initGuide({ store, win: window, doc: document });
  expect(createTourRunner).not.toHaveBeenCalled();
  document.body.innerHTML = '<button id="app-open-tours"></button>';
  await initGuide({ store, win: window, doc: document });
  expect(createTourRunner).not.toHaveBeenCalled();
});
test('初回提案の再挿入、あとで、今後表示しない、他タブ変更', async () => {
  await initGuide({ store, win: window, doc: document });
  expect(band()).not.toBeNull(); expect(runner.resume).toHaveBeenCalled();
  document.getElementById('app-content')!.replaceChildren(); await Promise.resolve();
  expect(band()).not.toBeNull(); await Promise.resolve();
  expect(document.querySelectorAll('#guide-suggest-band')).toHaveLength(1);
  click('postpone'); expect(band()).toBeNull();
  postponed = false; store.setState({}); click('suppress');
  expect(progress.suppressSuggestions).toBe(true); expect(band()).toBeNull();
  progress.suppressSuggestions = false; listeners.forEach(listener => listener()); expect(band()).not.toBeNull();
  click('start'); expect(runner.start).toHaveBeenCalledWith('getting-started'); expect(band()).toBeNull();
  store.setState({}); expect(band()).toBeNull();
});
test('一覧から開始し、ルートと条件の変化だけをイベントにする', async () => {
  await initGuide({ store, win: window, doc: document });
  document.getElementById('app-open-tours')!.click();
  document.querySelector<HTMLButtonElement>('#guide-tour-list [data-guide-action="start"]')!.click();
  expect(runner.start).toHaveBeenCalledWith('getting-started');
  const host = jest.mocked(createTourRunner).mock.calls[0]![0];
  expect(host.computeConditions()).toMatchObject({ 'is-owner': true });
  expect(host.currentRoute()).toBe('#/home');
  host.navigate('#/documents'); window.dispatchEvent(new Event('hashchange'));
  window.dispatchEvent(new Event('hashchange'));
  expect(runner.handleEvent).toHaveBeenCalledTimes(1);
  expect(runner.handleEvent).toHaveBeenCalledWith('route-opened-documents');
  store.setState({ counts: { ...store.getState().counts, documents: 1, protocolVersions: 1, schemaVersions: 1 } });
  store.setState({});
  expect(runner.handleEvent).toHaveBeenCalledTimes(4);
  expect(runner.handleEvent).toHaveBeenCalledWith('schema-confirmed');
  store.setState({ role: { ...store.getState().role, role: 'reviewer_independent' } });
  expect(runner.stop).toHaveBeenCalled(); expect(band()).toBeNull();
});
test('Home 以外や owner 以外では提案しない', async () => {
  window.history.replaceState(null, '', '#/documents');
  await initGuide({ store, win: window, doc: document }); expect(band()).toBeNull();
  store.setState({ role: { ...store.getState().role, role: null } });
  window.history.replaceState(null, '', '#/home'); window.dispatchEvent(new Event('hashchange'));
  expect(band()).toBeNull();
  store.setState({ role: { ...store.getState().role, role: 'owner' } });
  expect(band()).not.toBeNull();
});

test('言語変更でカードの再描画と帯・開いている一覧の翻訳を行い、終了時に購読解除する', async () => {
  await initGuide({ store, win: window, doc: document });
  document.getElementById('app-open-tours')!.click();
  const saved = JSON.parse(JSON.stringify(progress)) as GuideProgress;
  const writes = jest.mocked(storage.updateGuideProgress); writes.mockClear();
  try {
    setUiLanguage('en');
    expect(runner.rerender).toHaveBeenCalledTimes(1);
    expect(band()?.querySelector('p')?.textContent).toBe(t('guide.suggest'));
    expect(band()?.querySelector('[data-guide-action="start"]')?.textContent).toBe('Take the tour');
    expect(document.querySelector('#guide-tour-list h2')?.textContent).toBe('Getting started');
    expect(document.querySelector('#guide-tour-list [data-guide-action="close-list"]')?.textContent).toBe('Close list');
    expect(progress).toEqual(saved); expect(writes).not.toHaveBeenCalled();
    click('postpone'); setUiLanguage('ja');
    expect(band()).toBeNull();
    window.dispatchEvent(new Event('pagehide'));
    runner.rerender.mockClear(); setUiLanguage('en');
    expect(runner.rerender).not.toHaveBeenCalled();
  } finally { setUiLanguage('ja'); }
});

test.each(['store', 'hashchange', 'progress', 'observer', 'pagehide'] as const)('初期化の %s で失敗したら、それまでの購読をすべて解除する', async stage => {
  const error = new Error('初期化失敗');
  const subscribe = store.subscribe.bind(store);
  const unsubscribe = jest.fn();
  const storeSpy = jest.spyOn(store, 'subscribe').mockImplementation(listener => {
    if (stage === 'store') throw error;
    const remove = subscribe(listener);
    return () => { unsubscribe(); remove(); };
  });
  const add = window.addEventListener.bind(window);
  const addSpy = jest.spyOn(window, 'addEventListener').mockImplementation((name, listener, options) => {
    if (name === stage) throw error;
    add(name, listener, options);
  });
  const observeSpy = jest.spyOn(MutationObserver.prototype, 'observe');
  const disconnectSpy = jest.spyOn(MutationObserver.prototype, 'disconnect');
  if (stage === 'progress') jest.mocked(storage.subscribeGuideProgressChange).mockImplementationOnce(() => { throw error; });
  if (stage === 'observer') observeSpy.mockImplementationOnce(() => { throw error; });
  try {
    await expect(initGuide({ store, win: window, doc: document })).rejects.toBe(error);
    expect(unsubscribe).toHaveBeenCalledTimes(stage === 'store' ? 0 : 1);
    expect(listeners.size).toBe(0);
    if (stage === 'observer' || stage === 'pagehide') expect(disconnectSpy).toHaveBeenCalledTimes(1);
    expect(runner.stop).toHaveBeenCalledTimes(1);
    expect(runner.resume).not.toHaveBeenCalled();
    store.setState({ counts: { ...store.getState().counts, documents: 1 } });
    window.history.replaceState(null, '', '#/documents'); window.dispatchEvent(new Event('hashchange'));
    window.dispatchEvent(new Event('pagehide'));
    document.getElementById('app-open-tours')!.click();
    await Promise.resolve();
    expect(runner.handleEvent).not.toHaveBeenCalled();
    expect(runner.resume).not.toHaveBeenCalled();
    expect(runner.stop).toHaveBeenCalledTimes(1);
    expect(document.getElementById('guide-tour-list')).toBeNull();
    expect(band()).toBeNull();
  } finally {
    storeSpy.mockRestore(); addSpy.mockRestore(); observeSpy.mockRestore(); disconnectSpy.mockRestore();
  }
});
