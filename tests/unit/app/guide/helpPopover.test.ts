import { createHelpPopover, positionHelpPopover } from '../../../../src/app/guide/helpPopover';
import { createHelpButton } from '../../../../src/app/ui/helpButton';
import { GUIDE_TOURS } from '../../../../src/lib/guide/tours';
import { setUiLanguage } from '../../../../src/lib/i18n';

let popover: ReturnType<typeof createHelpPopover>;
let home: HTMLAnchorElement;
let verify: HTMLAnchorElement;
let unavailable: boolean;
const start = jest.fn();
const panel = (): HTMLElement | null => document.getElementById('help-popover');
const action = (name: string): HTMLElement => panel()!.querySelector(`[data-help-action="${name}"]`)!;
function click(element: EventTarget, options: MouseEventInit = {}): MouseEvent {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...options });
  element.dispatchEvent(event);
  return event;
}
beforeEach(() => {
  document.body.replaceChildren();
  setUiLanguage('ja');
  home = createHelpButton('home');
  verify = createHelpButton('verify');
  document.body.append(home, verify);
  unavailable = false;
  start.mockClear();
  popover = createHelpPopover(document, window, () => ({ 'not-owner': unavailable }), start);
});
afterEach(() => { popover.destroy(); setUiLanguage('ja'); });

test('document 全体から開き、項目と属性・フォーカス・位置を設定する', () => {
  const child = document.createElement('span');
  home.append(child);
  jest.spyOn(home, 'getBoundingClientRect').mockReturnValue({ left: 40, bottom: 60 } as DOMRect);
  expect(click(child).defaultPrevented).toBe(true);
  expect(panel()!.className).toBe('help-popover');
  expect(panel()!.getAttribute('role')).toBe('dialog');
  expect(panel()!.getAttribute('aria-label')).toBe('ヘルプと動画');
  expect([...panel()!.children].map(item => item.getAttribute('data-help-action'))).toEqual(['help', 'video', 'tour']);
  expect(action('help').getAttribute('href')).toBe('https://youkiti.github.io/sr-data-extraction-plugin/help.html?lang=ja#project');
  expect(action('video').getAttribute('href')).toBe('https://youtu.be/SYMLo4VKjMI');
  for (const name of ['help', 'video']) {
    expect(action(name).getAttribute('target')).toBe('_blank');
    expect(action(name).getAttribute('rel')).toBe('noopener noreferrer');
  }
  expect(action('tour').getAttribute('type')).toBe('button');
  expect(document.body.lastElementChild).toBe(panel());
  expect(document.activeElement).toBe(action('help'));
  expect(home.getAttribute('aria-expanded')).toBe('true');
  expect(panel()!.style.left).toBe('40px');
  expect(panel()!.style.top).toBe('68px');
  click(panel()!);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
  expect(panel()).not.toBeNull();
  popover.refreshAnchor();
  expect(panel()).not.toBeNull();
});

test('同じリンクで閉じ、別のリンクでは一つだけ切り替える', () => {
  click(home); click(home);
  expect(panel()).toBeNull();
  expect(home.hasAttribute('aria-expanded')).toBe(false);
  click(home); click(verify);
  expect(document.querySelectorAll('#help-popover')).toHaveLength(1);
  expect(home.hasAttribute('aria-expanded')).toBe(false);
  expect(verify.getAttribute('aria-expanded')).toBe('true');
  expect(action('video').getAttribute('href')).toBe('https://youtu.be/DN5YrhJilOc');
});

test('Escape は元のリンクにフォーカスを戻す', () => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  click(home);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  expect(panel()).toBeNull();
  expect(document.activeElement).toBe(home);
  expect(home.hasAttribute('aria-expanded')).toBe(false);
});

test('外側・付け替え先のないアンカー除去・close で閉じ、表示言語を反映する', () => {
  click(home); click(document.body); expect(panel()).toBeNull();
  click(home); click(document); expect(panel()).toBeNull();
  click(home); home.remove(); popover.refreshAnchor(); expect(panel()).toBeNull();
  document.body.append(home);
  click(home); popover.close(); expect(panel()).toBeNull();
  setUiLanguage('en');
  click(home);
  expect(panel()!.getAttribute('aria-label')).toBe('Help and video');
  expect(action('help').textContent).toBe('Read help');
  expect(action('help').getAttribute('href')).toContain('?lang=en#project');
  expect(action('video').textContent).toBe('▶ Watch video (in Japanese)');
  expect(action('tour').textContent).toBe('Start the tour for this screen');
});

test.each<MouseEventInit>([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { button: 2 }])('修飾キーと主ボタン以外は素通しする: %o', options => {
  expect(click(home, options).defaultPrevented).toBe(false);
  expect(panel()).toBeNull();
});

test.each(['unknown', 'toString', '', 'options', 'tours'])('未知またはヘルプだけの %s は素通しする', id => {
  home.dataset.help = id;
  expect(click(home).defaultPrevented).toBe(false);
  expect(panel()).toBeNull();
});

test('ツアーが使えなくても動画は表示する', () => {
  unavailable = true;
  click(home);
  expect(action('tour')).toBeNull();
  expect(action('video')).not.toBeNull();
});

test('動画がなくても利用可能なツアーは出し、両方なければ素通しする', () => {
  const tour = GUIDE_TOURS['getting-started'];
  const videoId = tour.videoId;
  delete tour.videoId;
  try {
    click(home);
    expect(action('video')).toBeNull();
    expect(action('tour')).not.toBeNull();
    click(home);
    unavailable = true;
    expect(click(home).defaultPrevented).toBe(false);
    expect(panel()).toBeNull();
  } finally { tour.videoId = videoId; }
});

test.each(['help', 'video', 'tour'])('%s を選ぶと閉じ、ツアーの開始だけを通知する', name => {
  click(home);
  click(action(name));
  expect(panel()).toBeNull();
  expect(home.hasAttribute('aria-expanded')).toBe(false);
  if (name === 'tour') expect(start).toHaveBeenCalledWith('getting-started');
  else expect(start).not.toHaveBeenCalled();
});

test('右端・下端と負の座標を画面内へ寄せる', () => {
  expect(positionHelpPopover({ left: 990, bottom: 790 } as DOMRect, { width: 300, height: 150 } as DOMRect, 1000, 800)).toEqual({ left: 688, top: 638 });
  expect(positionHelpPopover({ left: -50, bottom: -50 } as DOMRect, { width: 300, height: 150 } as DOMRect, 1000, 800)).toEqual({ left: 12, top: 12 });
});

test('destroy は閉じてリスナーを解除する', () => {
  const remove = jest.spyOn(document, 'removeEventListener');
  const removeWindow = jest.spyOn(window, 'removeEventListener');
  click(home); popover.destroy();
  expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function), true);
  expect(removeWindow).toHaveBeenCalledWith('resize', expect.any(Function));
  remove.mockRestore();
  removeWindow.mockRestore();
  document.dispatchEvent(new Event('scroll'));
  window.dispatchEvent(new Event('resize'));
  expect(panel()).toBeNull();
  expect(home.hasAttribute('aria-expanded')).toBe(false);
  expect(click(home).defaultPrevented).toBe(false);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  window.dispatchEvent(new Event('hashchange'));
  setUiLanguage('en');
  expect(panel()).toBeNull();
});


test.each(['click', 'Escape'])('再描画後は最初の同じトピックへ付け替え、%s は新しいリンクに作用する', closing => {
  popover.refreshAnchor();
  click(home);
  const originalPanel = panel()!;
  const help = action('help');
  const focus = document.activeElement;
  const replacement = createHelpButton('home');
  const second = createHelpButton('home');
  jest.spyOn(replacement, 'getBoundingClientRect').mockReturnValue({ left: 120, bottom: 160 } as DOMRect);
  home.replaceWith(replacement, second);
  popover.refreshAnchor();
  expect(panel()).toBe(originalPanel);
  expect(action('help')).toBe(help);
  expect(document.activeElement).toBe(focus);
  expect(home.hasAttribute('aria-expanded')).toBe(false);
  expect(replacement.getAttribute('aria-expanded')).toBe('true');
  expect(second.hasAttribute('aria-expanded')).toBe(false);
  expect(originalPanel.style.left).toBe('120px');
  expect(originalPanel.style.top).toBe('168px');
  if (closing === 'click') click(replacement);
  else {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.activeElement).toBe(replacement);
  }
  expect(panel()).toBeNull();
  expect(replacement.hasAttribute('aria-expanded')).toBe(false);
});

test('外の非バブリングのスクロールで追従し、吹き出し内では位置を計算し直さない', () => {
  const rect = jest.spyOn(home, 'getBoundingClientRect').mockReturnValue({ left: 40, right: 60, top: 40, bottom: 60 } as DOMRect);
  click(home);
  rect.mockClear();
  panel()!.dispatchEvent(new Event('scroll'));
  action('help').dispatchEvent(new Event('scroll'));
  expect(rect).not.toHaveBeenCalled();
  rect.mockReturnValue({ left: 120, right: 140, top: 140, bottom: 160 } as DOMRect);
  home.dispatchEvent(new Event('scroll'));
  expect(panel()!.style.left).toBe('120px');
  expect(panel()!.style.top).toBe('168px');
  expect(home.getAttribute('aria-expanded')).toBe('true');
});

test('画面を縮めたら位置を画面内へ寄せる', () => {
  const { innerWidth, innerHeight } = window;
  try {
    window.innerWidth = 1000;
    window.innerHeight = 800;
    jest.spyOn(home, 'getBoundingClientRect').mockReturnValue({ left: 390, right: 410, top: 390, bottom: 410 } as DOMRect);
    click(home);
    jest.spyOn(panel()!, 'getBoundingClientRect').mockReturnValue({ width: 300, height: 150 } as DOMRect);
    window.dispatchEvent(new Event('resize'));
    expect(panel()!.style.top).toBe('418px');
    window.innerWidth = 500;
    window.innerHeight = 400;
    window.dispatchEvent(new Event('resize'));
    expect(panel()!.style.left).toBe('188px');
    expect(panel()!.style.top).toBe('238px');
    expect(home.getAttribute('aria-expanded')).toBe('true');
  } finally { window.innerWidth = innerWidth; window.innerHeight = innerHeight; }
});

test.each(['scroll', 'resize'])('%s で表示領域の上下左右の外へ出たら閉じる', event => {
  const rect = jest.spyOn(home, 'getBoundingClientRect');
  for (const outside of [
    { bottom: -1 }, { top: window.innerHeight + 1 },
    { right: -1 }, { left: window.innerWidth + 1 },
  ]) {
    rect.mockReturnValue({ top: 40, bottom: 60, left: 40, right: 60 } as DOMRect);
    click(home);
    rect.mockReturnValue({ top: 40, bottom: 60, left: 40, right: 60, ...outside } as DOMRect);
    (event === 'scroll' ? document : window).dispatchEvent(new Event(event));
    expect(panel()).toBeNull();
    expect(home.hasAttribute('aria-expanded')).toBe(false);
  }
});

test.each(['scroll', 'resize'])('%s の時点で外れたアンカーを付け替え、候補がなければ閉じる', event => {
  click(home);
  const originalPanel = panel();
  const replacement = createHelpButton('home');
  jest.spyOn(replacement, 'getBoundingClientRect').mockReturnValue({ left: 120, right: 140, top: 140, bottom: 160 } as DOMRect);
  home.replaceWith(replacement);
  (event === 'scroll' ? document : window).dispatchEvent(new Event(event));
  expect(panel()).toBe(originalPanel);
  expect(home.hasAttribute('aria-expanded')).toBe(false);
  expect(replacement.getAttribute('aria-expanded')).toBe('true');
  expect(panel()!.style.left).toBe('120px');
  expect(panel()!.style.top).toBe('168px');
  replacement.remove();
  (event === 'scroll' ? document : window).dispatchEvent(new Event(event));
  expect(panel()).toBeNull();
  expect(replacement.hasAttribute('aria-expanded')).toBe(false);
});

test('閉じているときのスクロール・画面サイズ変更では何もしない', () => {
  const rect = jest.spyOn(home, 'getBoundingClientRect');
  document.dispatchEvent(new Event('scroll'));
  window.dispatchEvent(new Event('resize'));
  expect(rect).not.toHaveBeenCalled();
  expect(panel()).toBeNull();
});

test('resize の登録失敗時は document のリスナーも解除する', () => {
  popover.destroy();
  const error = new Error('登録失敗');
  const add = jest.spyOn(window, 'addEventListener').mockImplementationOnce(() => { throw error; });
  const remove = jest.spyOn(document, 'removeEventListener');
  try {
    expect(() => createHelpPopover(document, window, () => ({}), start)).toThrow(error);
    expect(remove).toHaveBeenCalledWith('click', expect.any(Function));
    expect(remove).toHaveBeenCalledWith('keydown', expect.any(Function));
    expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function), true);
    expect(click(home).defaultPrevented).toBe(false);
    expect(panel()).toBeNull();
  } finally { add.mockRestore(); remove.mockRestore(); }
});
