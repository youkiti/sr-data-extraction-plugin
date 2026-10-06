import { createTourEntry } from '../../../../src/app/guide/tourEntry';
import { createSuggestBand } from '../../../../src/app/guide/suggestBand';
import { createEmptyGuideProgress, completeTour } from '../../../../src/lib/guide/tourProgress';
import * as storage from '../../../../src/lib/storage/guideProgressStore';

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
