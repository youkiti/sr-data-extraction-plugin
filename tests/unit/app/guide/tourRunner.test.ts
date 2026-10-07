import { createTourRunner } from '../../../../src/app/guide/tourRunner';
import { GUIDE_TOURS, type TourDefinition } from '../../../../src/lib/guide/tours';
import { createEmptyGuideProgress, startTour, setActiveStep, type GuideProgress, type GuideConditionValues } from '../../../../src/lib/guide/tourProgress';
import * as storage from '../../../../src/lib/storage/guideProgressStore';
import { setUiLanguage, t } from '../../../../src/lib/i18n';

import { useTestTours } from '../../lib/guide/__fixtures__/tours';

jest.mock('../../../../src/lib/storage/guideProgressStore');
const original = GUIDE_TOURS['getting-started'];
useTestTours([original]);
let progress: GuideProgress;
let listeners: Set<() => void>;
let conditions: GuideConditionValues;
let runner: ReturnType<typeof createTourRunner>;
let route: string;
const navigate = jest.fn();
const box = (top = 100, height = 30): DOMRect => ({ x: 100, y: top, top, bottom: top + height, left: 100, right: 200, width: 100, height, toJSON: () => ({}) });
const action = (name: string): HTMLButtonElement => document.querySelector(`[data-guide-action="${name}"]`)!;
const card = (): HTMLElement | null => document.querySelector('.guide-tour-card');
function target(name: string): HTMLElement {
  const node = document.createElement('button');
  node.dataset.tour = name;
  node.getClientRects = () => [box()] as unknown as DOMRectList;
  node.getBoundingClientRect = () => box();
  node.scrollIntoView = jest.fn();
  document.body.append(node);
  return node;
}
function custom(patch: Partial<TourDefinition> = {}): void {
  GUIDE_TOURS['getting-started'] = { ...original, steps: [
    { id: 'a', target: 'a', textKey: original.steps[0]!.textKey, route: '#/documents', advance: { type: 'next' } },
    { id: 'b', target: 'b', textKey: original.steps[1]!.textKey, advance: { type: 'events', events: ['documents-imported'], optional: true } },
  ], ...patch };
}
beforeEach(() => {
  jest.useFakeTimers();
  document.body.replaceChildren();
  progress = createEmptyGuideProgress(); listeners = new Set(); conditions = {}; route = '#/home';
  jest.mocked(storage.getGuideProgress).mockImplementation(() => progress);
  jest.mocked(storage.updateGuideProgress).mockImplementation(update => { progress = update(progress); });
  jest.mocked(storage.subscribeGuideProgressChange).mockImplementation(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; });
  runner = createTourRunner({ computeConditions: () => conditions, currentRoute: () => route, navigate });
});
afterEach(() => { runner.stop(); jest.useRealTimers(); });

test('操作イベント、任意スキップ、完了と終了、Esc は終了させない', () => {
  runner.handleEvent('documents-imported'); runner.resume();
  target('nav-documents');
  runner.start('getting-started');
  expect(card()?.dataset.guideStep).toBe('open-documents');
  expect(card()?.getAttribute('aria-label')).toBe('はじめての流れ');
  expect(action('end')).toBe(document.activeElement);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  expect(card()).not.toBeNull();
  runner.resume();
  runner.handleEvent('route-opened-home');
  runner.handleEvent('route-opened-documents');
  expect(card()?.dataset.guideStep).toBe('import-documents');
  action('go-route').click(); expect(navigate).toHaveBeenCalledWith('#/documents');
  route = '#/documents'; jest.advanceTimersByTime(400); expect(action('go-route').hidden).toBe(true);
  runner.handleEvent('documents-imported');
  runner.handleEvent('route-opened-protocol');
  runner.handleEvent('protocol-saved');
  runner.handleEvent('route-opened-schema');
  expect(action('next')).toBe(document.activeElement);
  action('next').click();
  expect(action('skip').hidden).toBe(false);
  action('skip').click();
  expect(action('next').textContent).toBe('完了');
  const detached = action('next');
  detached.click(); detached.click();
  expect(progress.tours['getting-started']?.status).toBe('done');
  expect(card()).toBeNull();
  runner.start('getting-started'); action('end').click();
  expect(progress.active).toBeNull();
  expect(progress.tours['getting-started']?.status).toBe('dismissed');
});

test('対象の置換・非表示・画面外・覆いと一度だけのスクロール', async () => {
  custom();
  const step = GUIDE_TOURS['getting-started'].steps[0]!;
  step.blockTarget = true;
  const hidden = target('a'); hidden.style.visibility = 'hidden';
  const empty = target('a'); empty.getClientRects = () => [] as unknown as DOMRectList;
  runner.start('getting-started');
  expect(card()?.dataset.guideWaiting).toBe('true');
  const node = target('a');
  await Promise.resolve();
  expect(card()?.dataset.guideWaiting).toBe('false');
  expect(node.scrollIntoView).not.toHaveBeenCalled();
  jest.advanceTimersByTime(0);
  expect(node.scrollIntoView).toHaveBeenCalledTimes(1);
  expect((document.querySelector('.guide-tour-block') as HTMLElement).hidden).toBe(false);
  window.dispatchEvent(new Event('resize')); window.dispatchEvent(new Event('scroll'));
  expect(node.scrollIntoView).toHaveBeenCalledTimes(1);
  node.remove(); const replacement = target('a'); replacement.getBoundingClientRect = () => box(900);
  jest.advanceTimersByTime(400);
  expect(card()?.dataset.guideWaiting).toBe('true');
  replacement.getBoundingClientRect = () => box(200);
  replacement.dataset.tour = 'changed'; await Promise.resolve();
  expect(card()?.dataset.guideWaiting).toBe('true');
  replacement.dataset.tour = 'a'; await Promise.resolve();
  expect(card()?.dataset.guideWaiting).toBe('false');
  expect(replacement.scrollIntoView).not.toHaveBeenCalled();
  action('next').click(); action('skip').click();
  expect(card()).toBeNull();
});

test.each(['start', 'if-hidden', undefined] as const)('スクロール指定 %s と高い対象', scroll => {
  custom(); GUIDE_TOURS['getting-started'].steps[0]!.scroll = scroll;
  const node = target('a');
  runner.start('getting-started');
  expect(node.scrollIntoView).not.toHaveBeenCalled();
  jest.advanceTimersByTime(0);
  if (scroll === 'if-hidden') expect(node.scrollIntoView).not.toHaveBeenCalled();
  else expect(node.scrollIntoView).toHaveBeenLastCalledWith({ block: scroll === 'start' ? 'start' : 'center', inline: 'nearest' });
  node.getBoundingClientRect = () => box(-10, 700);
  runner.start('getting-started');
  jest.advanceTimersByTime(0);
  expect(node.scrollIntoView).toHaveBeenLastCalledWith({ block: 'start', inline: 'nearest' });
});

test('スクロールが打ち消されたら再試行し、最大5回で止まる', () => {
  custom();
  const node = target('a'); node.getBoundingClientRect = () => box(900);
  runner.start('getting-started');
  expect(node.scrollIntoView).not.toHaveBeenCalled();
  jest.advanceTimersByTime(0);
  expect(node.scrollIntoView).toHaveBeenCalledTimes(1);
  window.dispatchEvent(new Event('resize'));
  window.dispatchEvent(new Event('scroll'));
  expect(node.scrollIntoView).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(0);
  expect(node.scrollIntoView).toHaveBeenCalledTimes(2);
  jest.advanceTimersByTime(4000);
  expect(node.scrollIntoView).toHaveBeenCalledTimes(5);
});

test('画面内への移動を確認した後は利用者のスクロールを引き戻さない', () => {
  custom();
  const node = target('a'); node.getBoundingClientRect = () => box(900);
  runner.start('getting-started'); jest.advanceTimersByTime(0);
  window.dispatchEvent(new Event('scroll'));
  node.getBoundingClientRect = () => box(100);
  window.dispatchEvent(new Event('scroll'));
  node.getBoundingClientRect = () => box(900);
  window.dispatchEvent(new Event('scroll'));
  jest.advanceTimersByTime(4000);
  expect(node.scrollIntoView).toHaveBeenCalledTimes(1);
});

test('遅延処理は対象を探し直し、対象が消えた場合は次の機会を待つ', () => {
  custom();
  const node = target('a');
  runner.start('getting-started'); node.remove();
  jest.advanceTimersByTime(0);
  expect(node.scrollIntoView).not.toHaveBeenCalled();
  const replacement = target('a');
  window.dispatchEvent(new Event('resize'));
  replacement.remove();
  const latest = target('a');
  jest.advanceTimersByTime(0);
  expect(replacement.scrollIntoView).not.toHaveBeenCalled();
  expect(latest.scrollIntoView).toHaveBeenCalledTimes(1);
});

test.each(['stop', 'end', 'next', 'rerender'] as const)('遅延スクロールは %s で取り消す', operation => {
  custom();
  const node = target('a'); node.getBoundingClientRect = () => box(900);
  runner.start('getting-started');
  if (operation === 'stop' || operation === 'rerender') runner[operation]();
  else action(operation).click();
  jest.advanceTimersByTime(4000);
  expect(node.scrollIntoView).not.toHaveBeenCalled();
});

test.each([{ left: -10 }, { right: 2000 }])('if-hidden は横にはみ出した対象もスクロールする: %s', bounds => {
  custom(); GUIDE_TOURS['getting-started'].steps[0]!.scroll = 'if-hidden';
  const node = target('a'); node.getBoundingClientRect = () => ({ ...box(), ...bounds });
  runner.start('getting-started'); jest.advanceTimersByTime(0);
  expect(node.scrollIntoView).toHaveBeenCalledTimes(1);
});

test('再開、利用不可、空のツアー、未知の開始手順、条件によるスキップ', () => {
  conditions = { 'not-owner': true }; runner.start('getting-started'); expect(card()).toBeNull();
  progress = startTour(progress, 'getting-started'); runner.resume(); expect(card()).toBeNull();
  conditions = {}; custom({ draft: true }); runner.start('getting-started'); runner.resume(); expect(card()).toBeNull();
  custom({ steps: [] }); runner.start('getting-started'); expect(progress.active).toBeNull();
  custom(); runner.start('getting-started', 'b'); expect(card()?.dataset.guideStep).toBe('b');
  runner.stop(); runner.resume(); expect(card()?.dataset.guideStep).toBe('b');
  runner.start('getting-started', 'missing'); expect(card()?.dataset.guideStep).toBe('a');
  GUIDE_TOURS['getting-started'] = original;
  runner.start('getting-started'); runner.stop();
  conditions = { 'has-documents': true }; runner.resume(); expect(card()?.dataset.guideStep).toBe('open-protocol');
  conditions = { 'has-documents': true, 'has-protocol': true }; runner.handleEvent('route-opened-home');
  expect(card()?.dataset.guideStep).toBe('open-schema');
  runner.stop(); custom({ steps: [] }); runner.resume(); expect(progress.active).toBeNull();
});

test('他タブの手順・終了に追従し、追従時には保存もローカル条件でのスキップもしない', () => {
  runner.start('getting-started');
  const writes = jest.mocked(storage.updateGuideProgress);
  writes.mockClear();
  [...listeners].forEach(listener => listener()); expect(writes).not.toHaveBeenCalled();
  progress = setActiveStep(progress, 2);
  conditions = { 'has-protocol': true };
  [...listeners].forEach(listener => listener());
  expect(card()?.dataset.guideStep).toBe('open-protocol');
  runner.handleEvent('route-opened-home');
  expect(writes).not.toHaveBeenCalled();
  progress = { ...progress, active: null };
  [...listeners].forEach(listener => listener());
  expect(card()).toBeNull(); expect(writes).not.toHaveBeenCalled();
});

test.each([
  ['#/documents', 'open-documents', 'import-documents'],
  ['#/protocol', 'open-protocol', 'enter-protocol'],
  ['#/schema', 'open-schema', 'draft-schema'],
] as const)('現在の画面 %s を開く手順 %s は開始時に表示しない', (current, from, expected) => {
  route = current;
  runner.start('getting-started', from);
  expect(card()?.dataset.guideStep).toBe(expected);
  expect(progress.active?.stepId).toBe(expected);
});

test('ルートを満たす手順を連続して越え、末尾なら完了を保存する', () => {
  const first = original.steps[0]!;
  custom({ steps: [first, { ...first, id: 'again' }, { ...first, id: 'skipped', skipIf: 'has-protocol' }, original.steps[1]!] });
  route = '#/documents'; conditions = { 'has-protocol': true };
  runner.start('getting-started');
  expect(card()?.dataset.guideStep).toBe('import-documents');
  expect(progress.active?.stepIndex).toBe(3);
  runner.stop();
  custom({ steps: [first, { ...first, id: 'again' }] });
  runner.start('getting-started');
  expect(card()).toBeNull();
  expect(progress.active).toBeNull();
  expect(progress.tours['getting-started']?.status).toBe('done');
});

test('再開・次へ・イベント移動と条件再評価でも現在のルートを考慮する', () => {
  const open = original.steps[0]!;
  const finish = { ...original.steps[1]!, id: 'finish', advance: { type: 'next' as const } };
  custom({ steps: [open, finish] });
  progress = startTour(progress, 'getting-started');
  route = '#/documents'; runner.resume();
  expect(card()?.dataset.guideStep).toBe('finish');
  custom({ steps: [{ ...finish, id: 'first' }, open, finish] });
  runner.start('getting-started'); action('next').click();
  expect(card()?.dataset.guideStep).toBe('finish');
  custom({ steps: [original.steps[1]!, open, finish] });
  runner.start('getting-started'); runner.handleEvent('documents-imported');
  expect(card()?.dataset.guideStep).toBe('finish');
  custom({ steps: [open, finish] });
  route = '#/home'; runner.start('getting-started');
  expect(card()?.dataset.guideStep).toBe('open-documents');
  route = '#/documents'; runner.handleEvent('route-opened-home');
  expect(card()?.dataset.guideStep).toBe('finish');
});

test('他タブ追従では現在のルートを満たす手順も保存値どおり表示する', () => {
  runner.start('getting-started');
  route = '#/protocol'; progress = setActiveStep(progress, 2);
  const writes = jest.mocked(storage.updateGuideProgress); writes.mockClear();
  [...listeners].forEach(listener => listener());
  runner.handleEvent('route-opened-home');
  expect(card()?.dataset.guideStep).toBe('open-protocol');
  expect(writes).not.toHaveBeenCalled();
});

test.each([true, false])('現在の画面を開く手順の対象クリックで一度だけ進み保存する（追従: %s）', followed => {
  runner.start('getting-started', 'open-protocol');
  route = '#/protocol';
  if (followed) {
    progress = setActiveStep(progress, 0); [...listeners].forEach(listener => listener());
    progress = setActiveStep(progress, 2); [...listeners].forEach(listener => listener());
  }
  const writes = jest.mocked(storage.updateGuideProgress); writes.mockClear();
  target('nav-protocol').remove();
  const replacement = target('nav-protocol');
  const child = document.createElement('span'); replacement.append(child);
  document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  target('outside').click();
  expect(writes).not.toHaveBeenCalled();
  child.click();
  expect(card()?.dataset.guideStep).toBe('enter-protocol');
  expect(progress.active?.stepId).toBe('enter-protocol');
  expect(writes).toHaveBeenCalledTimes(1);
  runner.handleEvent('route-opened-protocol');
  expect(writes).toHaveBeenCalledTimes(1);
  runner.stop(); replacement.click();
  expect(writes).toHaveBeenCalledTimes(1);
});

test('別画面では対象クリックで進めず、ルートイベントで進む', () => {
  runner.start('getting-started', 'open-protocol');
  const writes = jest.mocked(storage.updateGuideProgress); writes.mockClear();
  target('nav-protocol').click();
  expect(card()?.dataset.guideStep).toBe('open-protocol');
  expect(writes).not.toHaveBeenCalled();
  route = '#/protocol'; runner.handleEvent('route-opened-protocol');
  expect(card()?.dataset.guideStep).toBe('enter-protocol');
  expect(writes).toHaveBeenCalledTimes(1);
});

test('言語による再描画は手順・追従・保存値を保ちフォーカスとスクロールを移さない', () => {
  runner.rerender();
  runner.start('getting-started');
  route = '#/protocol'; progress = setActiveStep(progress, 2);
  [...listeners].forEach(listener => listener());
  const node = target('nav-protocol');
  const input = document.createElement('input'); document.body.append(input); input.focus();
  const saved = JSON.parse(JSON.stringify(progress)) as GuideProgress;
  const writes = jest.mocked(storage.updateGuideProgress); writes.mockClear();
  try {
    setUiLanguage('en'); runner.rerender();
    expect(card()?.querySelector('h2')?.textContent).toBe('Getting started');
    expect(card()?.querySelector('p')?.textContent).toBe(t('guide.tourGettingStartedStepOpenProtocol'));
    expect(action('end').textContent).toBe('End tour');
    expect(action('go-route').textContent).toBe('Go to this screen');
    expect(card()?.dataset.guideStep).toBe('open-protocol');
    expect(document.activeElement).toBe(input);
    expect(node.scrollIntoView).not.toHaveBeenCalled();
    runner.handleEvent('route-opened-home');
    expect(progress).toEqual(saved); expect(writes).not.toHaveBeenCalled();
    runner.start('getting-started', 'draft-schema'); runner.rerender();
    expect(action('next').textContent).toBe('Next');
  } finally { setUiLanguage('ja'); }
});

test('登録した空の枠は直接開始しても進行状態とカードを作らない', () => {
  const draft: TourDefinition = {
    id: 'verify-basics', titleKey: 'title', descriptionKey: 'description', draft: true, steps: [],
  };
  GUIDE_TOURS[draft.id] = draft;
  for (const tour of [draft]) {
    runner.start(tour.id);
    expect(progress.active).toBeNull();
    expect(card()).toBeNull();
  }
});

test('実行中のツアーの利用条件だけで片づけ、保存せず同じ手順へ戻る', () => {
  runner.syncAvailability();
  custom({ unavailableIf: 'verify-basics-unavailable' });
  conditions = { 'not-owner': true };
  runner.start('getting-started', 'b');
  const currentCard = card();
  runner.syncAvailability(); runner.resume();
  expect(card()).toBe(currentCard);
  const saved = progress;
  const writes = jest.mocked(storage.updateGuideProgress); writes.mockClear();
  conditions = { 'not-owner': true, 'verify-basics-unavailable': true };
  runner.syncAvailability(); runner.resume();
  expect(card()).toBeNull();
  expect(progress).toBe(saved);
  conditions = { 'not-owner': true };
  runner.syncAvailability(); runner.resume();
  expect(card()?.dataset.guideStep).toBe('b');
  expect(writes).not.toHaveBeenCalled();
});

test('対象と子要素の実行を遮断し、Tab・対象外の操作・手順変更後・終了後は遮断しない', () => {
  custom(); GUIDE_TOURS['getting-started'].steps[0]!.blockTarget = true;
  const node = target('a');
  const child = document.createElement('span'); node.append(child);
  const outside = target('outside');
  const clicks = jest.fn(); const keys = jest.fn(); const outsideClicks = jest.fn();
  node.addEventListener('click', clicks); node.addEventListener('keydown', keys);
  outside.addEventListener('click', outsideClicks);
  runner.start('getting-started');
  node.click(); child.click();
  for (const key of ['Enter', ' ']) {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    child.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  }
  expect(clicks).not.toHaveBeenCalled(); expect(keys).not.toHaveBeenCalled();
  const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
  node.focus(); node.dispatchEvent(tab);
  expect(document.activeElement).toBe(node);
  expect(tab.defaultPrevented).toBe(false); expect(keys).toHaveBeenCalledTimes(1);
  outside.click(); expect(outsideClicks).toHaveBeenCalledTimes(1);
  document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  node.remove();
  const replacement = target('a'); replacement.addEventListener('click', clicks);
  replacement.click(); expect(clicks).not.toHaveBeenCalled();
  action('next').click();
  replacement.click(); expect(clicks).toHaveBeenCalledTimes(1);
  const unblocked = target('b'); unblocked.addEventListener('click', clicks);
  unblocked.click(); expect(clicks).toHaveBeenCalledTimes(2);
  runner.start('getting-started'); action('end').click();
  replacement.click(); expect(clicks).toHaveBeenCalledTimes(3);
  runner.start('getting-started'); runner.stop();
  replacement.click(); expect(clicks).toHaveBeenCalledTimes(4);
});

test('フォーム送信は対象内の submitter だけ遮断し、片づけた後は送信できる', () => {
  custom(); GUIDE_TOURS['getting-started'].steps[0]!.blockTarget = true;
  const form = document.createElement('form'); document.body.append(form);
  const input = document.createElement('input'); form.append(input);
  const button = target('a') as HTMLButtonElement; button.type = 'submit'; form.append(button);
  const other = document.createElement('button'); other.type = 'submit'; form.append(other);
  const submitted = jest.fn((event: Event) => event.preventDefault());
  form.addEventListener('submit', submitted);
  runner.start('getting-started');
  button.click(); expect(submitted).not.toHaveBeenCalled();
  const event = new SubmitEvent('submit', { submitter: button, bubbles: true, cancelable: true });
  form.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true); expect(submitted).not.toHaveBeenCalled();
  // jsdom のキーイベントは既定の暗黙送信を起こさないため submitter を明示して検査する。
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  expect(submitted).not.toHaveBeenCalled();
  form.dispatchEvent(new SubmitEvent('submit', { submitter: other, bubbles: true, cancelable: true }));
  form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
  expect(submitted).toHaveBeenCalledTimes(2);
  runner.stop();
  button.click();
  expect(submitted).toHaveBeenCalledTimes(3);
  expect((submitted.mock.calls[2]![0] as SubmitEvent).submitter).toBe(button);
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  expect(submitted).toHaveBeenCalledTimes(3);
});


test('空のプロジェクトでは操作後も通過済みを保持して 1 から 8 まで数える', () => {
  const number = (): string | null | undefined => card()?.querySelectorAll('p')[1]?.textContent;
  runner.start('getting-started');
  expect(number()).toBe('1 / 8');
  runner.handleEvent('route-opened-documents');
  expect(number()).toBe('2 / 8');
  conditions = { 'has-documents': true };
  runner.handleEvent('documents-imported');
  expect(number()).toBe('3 / 8');
  runner.handleEvent('route-opened-protocol');
  expect(number()).toBe('4 / 8');
  conditions = { 'has-documents': true, 'has-protocol': true };
  runner.handleEvent('protocol-saved');
  expect(number()).toBe('5 / 8');
  runner.handleEvent('route-opened-schema');
  expect(number()).toBe('6 / 8');
  action('next').click();
  expect(number()).toBe('7 / 8');
  conditions = { ...conditions, 'has-confirmed-schema': true };
  runner.handleEvent('schema-confirmed');
  expect(number()).toBe('8 / 8');
});

test('取り込み済みから開始し、後続の省略だけが分母を減らす。再開と再表示は加算しない', () => {
  conditions = { 'has-documents': true };
  runner.start('getting-started');
  expect(card()?.textContent).toContain('1 / 6');
  const writes = jest.mocked(storage.updateGuideProgress);
  writes.mockClear();
  runner.stop(); runner.resume();
  runner.rerender();
  setUiLanguage('en'); runner.rerender(); setUiLanguage('ja');
  jest.advanceTimersByTime(800);
  expect(card()?.textContent).toContain('1 / 6');
  expect(progress.active?.shownCount).toBe(1);
  expect(writes).not.toHaveBeenCalled();
  conditions = { ...conditions, 'has-confirmed-schema': true };
  window.dispatchEvent(new Event('resize'));
  expect(card()?.textContent).toContain('1 / 3');
});

test('旧保存値を条件で補完し、再描画中は条件が変わっても表示数を保持する', () => {
  progress = startTour(progress, 'getting-started', 2);
  runner.resume();
  expect(card()?.textContent).toContain('3 / 8');
  conditions = { 'has-documents': true };
  runner.rerender();
  expect(card()?.textContent).toContain('3 / 8');
  runner.handleEvent('route-opened-protocol');
  expect(progress.active?.shownCount).toBe(4);
});

test('追従は保存された表示数をそのまま使い、保存も加算もしない', () => {
  runner.start('getting-started');
  progress = { ...progress, active: { tourId: 'getting-started', stepId: 'open-protocol', stepIndex: 2, shownCount: 3 } };
  conditions = { 'has-documents': true };
  const writes = jest.mocked(storage.updateGuideProgress);
  writes.mockClear();
  [...listeners].forEach(listener => listener());
  runner.rerender();
  expect(card()?.textContent).toContain('3 / 8');
  expect(progress.active?.shownCount).toBe(3);
  expect(writes).not.toHaveBeenCalled();
});


test('同じ手順への通知でも保存値の表示数を使う', () => {
  runner.start('getting-started', 'open-protocol');
  progress = { ...progress, active: { ...progress.active!, shownCount: 3 } };
  const writes = jest.mocked(storage.updateGuideProgress);
  writes.mockClear();
  [...listeners].forEach(listener => listener());
  expect(card()?.textContent).toContain('3 / 8');
  runner.rerender();
  expect(card()?.textContent).toContain('3 / 8');
  expect(writes).not.toHaveBeenCalled();
});


test.each([-1, 0.5, 99])('不正な表示数 %s の再開は現在の条件で補完する', shownCount => {
  progress = { ...progress, active: { tourId: 'getting-started', stepId: 'open-protocol', stepIndex: 2, shownCount } };
  conditions = { 'has-documents': true };
  runner.resume();
  expect(card()?.textContent).toContain('1 / 6');
  runner.handleEvent('route-opened-protocol');
  expect(progress.active?.shownCount).toBe(2);
});
