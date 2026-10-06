import { createTourEntry } from '../../../../src/app/guide/tourEntry';
import { createSuggestBand } from '../../../../src/app/guide/suggestBand';
import { createEmptyGuideProgress, completeTour } from '../../../../src/lib/guide/tourProgress';
import * as storage from '../../../../src/lib/storage/guideProgressStore';
import { setUiLanguage } from '../../../../src/lib/i18n';

test('一覧のヘルプは表示言語に追従し、初期フォーカスは閉じるボタンに残る', () => {
  document.body.innerHTML = '<button id="anchor">ツアー</button>';
  const anchor = document.getElementById('anchor')!;
  const entry = createTourEntry(document, anchor, () => ({}), jest.fn());
  try {
    setUiLanguage('ja');
    anchor.click();
    const panel = document.getElementById('guide-tour-list')!;
    const link = panel.querySelector<HTMLAnchorElement>('a[data-help="tours"]')!;
    expect(link.textContent).toBe('?');
    expect(link.className).toBe('help-button');
    expect(link.href).toBe('https://youkiti.github.io/sr-data-extraction-plugin/help.html?lang=ja#project-tours');
    expect(document.activeElement).toBe(panel.querySelector('[data-guide-action="close-list"]'));
    expect(link.previousElementSibling).toBe(document.activeElement);
    setUiLanguage('en');
    entry.refresh();
    const refreshed = panel.querySelector<HTMLAnchorElement>('a[data-help="tours"]')!;
    expect(refreshed).not.toBe(link);
    expect(refreshed.href).toBe('https://youkiti.github.io/sr-data-extraction-plugin/help.html?lang=en#project-tours');
    anchor.click();
    anchor.click();
    expect(document.activeElement).toBe(panel.querySelector('[data-guide-action="close-list"]'));
    expect(panel.querySelector<HTMLAnchorElement>('a[data-help="tours"]')!.href).toBe(refreshed.href);
  } finally {
    entry.destroy();
    setUiLanguage('ja');
  }
});

test('提案帯は三つの操作を配線する', () => {
  const actions = { start: jest.fn(), postpone: jest.fn(), suppress: jest.fn() };
  const band = createSuggestBand(document, actions);
  for (const name of ['start', 'postpone', 'suppress'] as const) {
    band.querySelector<HTMLButtonElement>(`[data-guide-action="${name}"]`)!.click();
    expect(actions[name]).toHaveBeenCalledTimes(1);
  }
});
test('一覧の開閉、外側、Esc、開始、済み、owner 制約', () => {
  const progress = jest.spyOn(storage, 'getGuideProgress').mockReturnValue(createEmptyGuideProgress());
  document.body.innerHTML = '<button id="anchor">ツアー</button><p>外</p>';
  const anchor = document.getElementById('anchor')!;
  let unavailable = false;
  const start = jest.fn();
  const entry = createTourEntry(document, anchor, () => ({ 'not-owner': unavailable }), start);
  const panel = (): HTMLElement | null => document.getElementById('guide-tour-list');
  anchor.click(); expect(panel()).not.toBeNull(); expect(anchor.getAttribute('aria-expanded')).toBe('true');
  panel()!.click(); expect(panel()).not.toBeNull();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' })); expect(panel()).not.toBeNull();
  anchor.click(); expect(panel()).toBeNull();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  anchor.click(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  expect(document.activeElement).toBe(anchor); expect(panel()).toBeNull();
  anchor.click(); document.querySelector('p')!.click(); expect(panel()).toBeNull();
  anchor.click(); panel()!.querySelector<HTMLButtonElement>('[data-guide-action="close-list"]')!.click(); expect(panel()).toBeNull();
  progress.mockReturnValue(completeTour(createEmptyGuideProgress(), 'getting-started', 'now'));
  anchor.click(); expect(panel()!.textContent).toContain('済み');
  panel()!.querySelector<HTMLButtonElement>('[data-guide-action="start"]')!.click();
  expect(start).toHaveBeenCalledWith('getting-started'); expect(panel()).toBeNull();
  unavailable = true; anchor.click(); expect(panel()!.querySelector('[data-guide-action="start"]')).toBeNull();
  unavailable = false; entry.refresh(); expect(panel()!.querySelector('[data-guide-action="start"]')).not.toBeNull();
  progress.mockReturnValue({ ...createEmptyGuideProgress(), tours: { 'getting-started': { status: 'dismissed', at: 'now' } } });
  entry.refresh(); expect(panel()!.textContent).not.toContain('済み');
  entry.destroy(); anchor.click(); expect(panel()).toBeNull();
  progress.mockRestore();
});
