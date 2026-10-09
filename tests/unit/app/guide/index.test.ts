import { initGuide } from '../../../../src/app/guide';
import { createStore, createInitialState, type Store } from '../../../../src/app/store';
import { createEmptyGuideProgress, isTourUnavailable, startTour, type GuideProgress } from '../../../../src/lib/guide/tourProgress';
import { GUIDE_TOURS } from '../../../../src/lib/guide/tours';
import * as storage from '../../../../src/lib/storage/guideProgressStore';
import { createTourRunner } from '../../../../src/app/guide/tourRunner';
import { setUiLanguage, t } from '../../../../src/lib/i18n';

import { useTestTours } from '../../lib/guide/__fixtures__/tours';

useTestTours([{
  id: 'getting-started', titleKey: 'guide.tourGettingStartedTitle', descriptionKey: 'guide.tourGettingStartedDesc',
  unavailableIf: 'not-owner',
  steps: [{ id: 'open-documents', target: 'nav-documents', textKey: 'guide.tourGettingStartedStepOpenDocuments', advance: { type: 'next' } }],
}]);

jest.mock('../../../../src/lib/storage/guideProgressStore');
jest.mock('../../../../src/app/guide/tourRunner');
let store: Store;
let progress: GuideProgress;
let postponed: boolean;
let listeners: Set<() => void>;
const runner = { start: jest.fn(), resume: jest.fn(), syncAvailability: jest.fn(), stop: jest.fn(), handleEvent: jest.fn(), rerender: jest.fn() };
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
  runner.syncAvailability.mockImplementation(() => {
    const host = jest.mocked(createTourRunner).mock.calls[0]![0];
    if (progress.active && isTourUnavailable(GUIDE_TOURS[progress.active.tourId], host.computeConditions())) runner.stop();
  });
  runner.start.mockImplementation(() => { progress.active = { tourId: 'getting-started', stepIndex: 0, stepId: 'open-documents' }; });
});
afterEach(() => { window.dispatchEvent(new Event('pagehide')); });

// 既存の操作テストは件数読込済みの画面を使う。読込待ちは下の専用テストで扱う。
beforeEach(() => { store.setState({ home: { ...store.getState().home, countsLoaded: true } }); });

function waitForCounts(): void {
  store.setState({ home: { ...store.getState().home, countsLoaded: false } });
}
function loadCounts(): void {
  store.setState({ home: { ...store.getState().home, countsLoaded: true } });
}
function startFromList(id = 'getting-started'): void {
  document.getElementById('app-open-tours')!.click();
  document.querySelector<HTMLButtonElement>(`#guide-tour-list [data-guide-tour="${id}"]`)!.click();
}

test('件数読込前は帯も再開もなく、読込後に残作業があれば帯を出す', async () => {
  waitForCounts();
  await initGuide({ store, win: window, doc: document });
  store.setState({});
  expect(band()).toBeNull();
  expect(runner.resume).not.toHaveBeenCalled();
  loadCounts();
  expect(band()).not.toBeNull();
  expect(runner.resume).toHaveBeenCalledTimes(1);
});

test.each(['#/home', '#/documents'])('保存済みツアーは %s でも読込後に再開する', async hash => {
  waitForCounts();
  window.history.replaceState(null, '', hash);
  progress = startTour(progress, 'getting-started');
  await initGuide({ store, win: window, doc: document });
  expect(runner.resume).not.toHaveBeenCalled();
  loadCounts();
  expect(runner.resume).toHaveBeenCalledTimes(1);
});

test('全手順が済んでいれば帯を出さず、待機中の開始は最初から最後の手順だけを表示する', async () => {
  const actual = jest.requireActual<typeof import('../../../../src/app/guide/tourRunner')>('../../../../src/app/guide/tourRunner');
  jest.mocked(createTourRunner).mockImplementationOnce(actual.createTourRunner);
  const { GETTING_STARTED_TOUR } = jest.requireActual<typeof import('../../../../src/lib/guide/tours/gettingStarted')>('../../../../src/lib/guide/tours/gettingStarted');
  GUIDE_TOURS['getting-started'] = GETTING_STARTED_TOUR;
  waitForCounts();
  await initGuide({ store, win: window, doc: document });
  startFromList();
  expect(document.querySelector('.guide-tour-card')).toBeNull();
  const seen: string[] = [];
  const append = document.body.append.bind(document.body);
  const spy = jest.spyOn(document.body, 'append').mockImplementation((...nodes) => {
    nodes.forEach(node => { if (node instanceof HTMLElement && node.dataset.guideStep) seen.push(node.dataset.guideStep); });
    append(...nodes);
  });
  try {
    store.setState({
      counts: { ...store.getState().counts, documents: 1, protocolVersions: 1, schemaVersions: 1 },
      home: { ...store.getState().home, countsLoaded: true },
    });
    expect(seen).toEqual(['finish']);
    expect(band()).toBeNull();
    document.querySelector<HTMLButtonElement>('.guide-tour-card [data-guide-action="next"]')!.click();
    progress = createEmptyGuideProgress();
    store.setState({});
    expect(band()).toBeNull();
    startFromList();
    expect(document.querySelector('.guide-tour-card')?.getAttribute('data-guide-step')).toBe('finish');
  } finally { spy.mockRestore(); }
});

test('待機中の開始は最後の選択を優先し、同じ読込通知で新しい手順を進めない', async () => {
  waitForCounts();
  GUIDE_TOURS['verify-basics'] = { ...GUIDE_TOURS['getting-started'], id: 'verify-basics' };
  await initGuide({ store, win: window, doc: document });
  startFromList();
  startFromList('verify-basics');
  expect(runner.start).not.toHaveBeenCalled();
  store.setState({ counts: { ...store.getState().counts, documents: 1 }, home: { ...store.getState().home, countsLoaded: true } });
  expect(runner.start).toHaveBeenCalledTimes(1);
  expect(runner.start).toHaveBeenCalledWith('verify-basics');
  expect(runner.handleEvent.mock.invocationCallOrder[0]).toBeLessThan(runner.start.mock.invocationCallOrder[0]!);
  store.setState({});
  expect(runner.start).toHaveBeenCalledTimes(1);
});

test.each([false, true])('件数読込失敗では帯・再開を止め、一覧の開始は許す（読込済み=%s）', async loaded => {
  store.setState({ home: { ...store.getState().home, countsLoaded: loaded, countsError: '読込失敗' } });
  await initGuide({ store, win: window, doc: document });
  expect(band()).toBeNull();
  expect(runner.resume).not.toHaveBeenCalled();
  startFromList();
  expect(runner.start).toHaveBeenCalledWith('getting-started');
});

test('開始待機中の読込失敗でも開始操作は失わない', async () => {
  waitForCounts();
  await initGuide({ store, win: window, doc: document });
  startFromList();
  store.setState({ home: { ...store.getState().home, countsError: '読込失敗' } });
  expect(runner.start).toHaveBeenCalledTimes(1);
  expect(band()).toBeNull();
  expect(runner.resume).not.toHaveBeenCalled();
});

test('帯からの開始も再読込待ちなら待機し、終了後は開始しない', async () => {
  await initGuide({ store, win: window, doc: document });
  const button = band()!.querySelector<HTMLButtonElement>('[data-guide-action="start"]')!;
  waitForCounts();
  button.click();
  expect(runner.start).not.toHaveBeenCalled();
  window.dispatchEvent(new Event('pagehide'));
  loadCounts();
  expect(runner.start).not.toHaveBeenCalled();
});

test('件数を読まない reviewer は役割確定後に再開・開始する', async () => {
  waitForCounts();
  GUIDE_TOURS['verify-basics'] = { ...GUIDE_TOURS['getting-started'], id: 'verify-basics', unavailableIf: undefined };
  store.setState({ role: { ...store.getState().role, role: null } });
  await initGuide({ store, win: window, doc: document });
  expect(runner.resume).not.toHaveBeenCalled();
  store.setState({ role: { ...store.getState().role, role: 'reviewer_with_ai', resolving: true } });
  expect(runner.resume).not.toHaveBeenCalled();
  store.setState({ role: { ...store.getState().role, resolving: false, error: '失敗' } });
  expect(runner.resume).not.toHaveBeenCalled();
  store.setState({ role: { ...store.getState().role, error: null } });
  expect(runner.resume).toHaveBeenCalledTimes(1);
  startFromList('verify-basics');
  expect(runner.start).toHaveBeenCalledWith('verify-basics');
  expect(band()).toBeNull();
});

test('実行部は非オーナーのストア更新でもカードを維持し、利用条件の変化で同じ手順を再開する', async () => {
  const actual = jest.requireActual<typeof import('../../../../src/app/guide/tourRunner')>('../../../../src/app/guide/tourRunner');
  jest.mocked(createTourRunner).mockImplementationOnce(actual.createTourRunner);
  GUIDE_TOURS['verify-basics'] = {
    ...GUIDE_TOURS['getting-started'], id: 'verify-basics', unavailableIf: 'has-protocol',
    steps: [
      { id: 'first', target: 'first', textKey: 'guide.tourGettingStartedStepOpenDocuments', advance: { type: 'next' } },
      { id: 'second', target: 'second', textKey: 'guide.tourGettingStartedStepOpenDocuments', advance: { type: 'next' } },
    ],
  };
  store.setState({ role: { ...store.getState().role, role: 'reviewer_with_ai' } });
  progress = startTour(progress, 'verify-basics', 1);
  await initGuide({ store, win: window, doc: document });
  const card = (): Element | null => document.querySelector('.guide-tour-card');
  const originalCard = card();
  expect(originalCard?.getAttribute('data-guide-step')).toBe('second');
  store.setState({ verify: { ...store.getState().verify, selectedStudyId: 'study-1' } });
  expect(card()).toBe(originalCard);
  const saved = progress;
  store.setState({ counts: { ...store.getState().counts, protocolVersions: 1 } });
  expect(card()).toBeNull();
  expect(progress).toBe(saved);
  store.setState({ counts: { ...store.getState().counts, protocolVersions: 0 } });
  expect(card()?.getAttribute('data-guide-step')).toBe('second');
  expect(progress).toBe(saved);
});

test('実行部はオーナー専用ツアーを権限喪失時に片づけ、役割解決後に再開する', async () => {
  const actual = jest.requireActual<typeof import('../../../../src/app/guide/tourRunner')>('../../../../src/app/guide/tourRunner');
  jest.mocked(createTourRunner).mockImplementationOnce(actual.createTourRunner);
  progress = startTour(progress, 'getting-started');
  await initGuide({ store, win: window, doc: document });
  expect(document.querySelector('.guide-tour-card')).not.toBeNull();
  store.setState({ role: { ...store.getState().role, role: 'reviewer_with_ai' } });
  expect(document.querySelector('.guide-tour-card')).toBeNull();
  store.setState({ role: { ...store.getState().role, role: 'owner', resolving: true } });
  expect(document.querySelector('.guide-tour-card')).toBeNull();
  store.setState({ role: { ...store.getState().role, resolving: false } });
  expect(document.querySelector('.guide-tour-card')?.getAttribute('data-guide-step')).toBe('open-documents');
});
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
  expect(runner.handleEvent.mock.calls.filter(([event]) =>
    ['route-opened-documents', 'documents-imported', 'protocol-saved', 'schema-confirmed'].includes(event),
  )).toEqual([['route-opened-documents'], ['documents-imported'], ['protocol-saved'], ['schema-confirmed']]);
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

test('ヘルプのツアー開始は既存の開始処理を使い、終了時に委譲を解除する', async () => {
  await initGuide({ store, win: window, doc: document });
  const help = document.createElement('a');
  help.dataset.help = 'home';
  document.body.append(help);
  help.click();
  document.querySelector<HTMLButtonElement>('[data-help-action="tour"]')!.click();
  expect(runner.start).toHaveBeenCalledWith('getting-started');
  expect(document.getElementById('help-popover')).toBeNull();
  help.click();
  window.dispatchEvent(new Event('pagehide'));
  expect(document.getElementById('help-popover')).toBeNull();
  help.click();
  expect(document.getElementById('help-popover')).toBeNull();
});

test.each(['store', 'observer'])('%s の通知で付け替え先のないヘルプの吹き出しを閉じる', async source => {
  await initGuide({ store, win: window, doc: document });
  const content = document.getElementById('app-content')!;
  const help = document.createElement('a');
  help.dataset.help = 'home';
  content.append(help);
  help.click();
  expect(document.getElementById('help-popover')).not.toBeNull();
  help.remove();
  if (source === 'store') store.setState({});
  else await new Promise(resolve => setTimeout(resolve, 0));
  expect(document.getElementById('help-popover')).toBeNull();
  expect(help.hasAttribute('aria-expanded')).toBe(false);
});


test.each(['hashchange', 'language'])('%s のハンドラから吹き出しを閉じる', async source => {
  await initGuide({ store, win: window, doc: document });
  const help = document.createElement('a');
  help.dataset.help = 'home';
  document.getElementById('app-content')!.append(help);
  try {
    help.click();
    expect(document.getElementById('help-popover')).not.toBeNull();
    if (source === 'hashchange') window.dispatchEvent(new Event('hashchange'));
    else setUiLanguage('en');
    expect(document.getElementById('help-popover')).toBeNull();
    expect(help.hasAttribute('aria-expanded')).toBe(false);
  } finally {
    window.dispatchEvent(new Event('pagehide'));
    setUiLanguage('ja');
  }
});

test.each(['store', 'observer'])('%s の通知で同じトピックのヘルプへ付け替える', async source => {
  // 直前のテストが予約した画面遷移の通知を先に完了させる。
  await new Promise(resolve => setTimeout(resolve, 0));
  await initGuide({ store, win: window, doc: document });
  const content = document.getElementById('app-content')!;
  const help = document.createElement('a');
  help.dataset.help = 'home';
  content.append(help);
  help.click();
  const panel = document.getElementById('help-popover');
  const replacement = help.cloneNode() as HTMLAnchorElement;
  replacement.removeAttribute('aria-expanded');
  content.replaceChildren(replacement);
  if (source === 'store') store.setState({});
  else await new Promise(resolve => setTimeout(resolve, 0));
  expect(document.getElementById('help-popover')).toBe(panel);
  expect(replacement.getAttribute('aria-expanded')).toBe('true');
});
