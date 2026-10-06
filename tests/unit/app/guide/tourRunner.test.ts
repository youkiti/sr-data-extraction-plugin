import { createTourRunner } from '../../../../src/app/guide/tourRunner';
import { GUIDE_TOURS, type TourDefinition } from '../../../../src/lib/guide/tours';
import { createEmptyGuideProgress, startTour, setActiveStep, type GuideProgress, type GuideConditionValues } from '../../../../src/lib/guide/tourProgress';
import * as storage from '../../../../src/lib/storage/guideProgressStore';
import { setUiLanguage, t } from '../../../../src/lib/i18n';

jest.mock('../../../../src/lib/storage/guideProgressStore');
const original = GUIDE_TOURS['getting-started'];
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
afterEach(() => { runner.stop(); GUIDE_TOURS['getting-started'] = original; jest.useRealTimers(); });

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
  if (scroll === 'if-hidden') expect(node.scrollIntoView).not.toHaveBeenCalled();
  else expect(node.scrollIntoView).toHaveBeenLastCalledWith({ block: scroll === 'start' ? 'start' : 'center', inline: 'nearest' });
  node.getBoundingClientRect = () => box(-10, 700);
  runner.start('getting-started');
  expect(node.scrollIntoView).toHaveBeenLastCalledWith({ block: 'start', inline: 'nearest' });
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
