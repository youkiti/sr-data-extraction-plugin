import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PILOT_AND_EXTRACT_TOUR as tour } from '../../../../../src/lib/guide/tours/pilotAndExtract';
import { jaApp } from '../../../../../src/lib/i18n/ja.app';
import { availableTours } from '../../../../../src/lib/guide/tourProgress';

test('公開済みの重複しない8手順を持ち、一覧を対象に next で終わる', () => {
  expect(tour.draft).toBeUndefined();
  expect(tour.steps).toHaveLength(8);
  expect(new Set(tour.steps.map(step => step.id)).size).toBe(tour.steps.length);
  expect(tour.steps.at(-1)).toMatchObject({ id: 'finish', target: 'tour-list', advance: { type: 'next' } });
  expect(tour.steps.every(step => step.skipIf === undefined)).toBe(true);
});

test.each(['run-pilot', 'run-extract'])('%s は費用がかかるため実行せず進める', id => {
  expect(tour.steps.find(step => step.id === id)?.advance).toMatchObject({ type: 'events', optional: true });
});

test('画面がある手順は実在ルートと動的対象を使う', () => {
  const source = readFileSync(join(process.cwd(), 'src/app/router.ts'), 'utf8');
  const routes = Array.from(source.matchAll(/hash: '(#\/[^']+)'/g), match => match[1]);
  for (const step of tour.steps.filter(step => step.route !== undefined)) {
    expect(routes).toContain(step.route);
    expect(step.dynamicTarget).toBe(true);
  }
});

test('前提を満たさなければ一覧に出ない', () => {
  expect(tour.unavailableIf).toBe('pilot-and-extract-unavailable');
  expect(availableTours(undefined, { 'pilot-and-extract-unavailable': true }).map(item => item.id)).not.toContain(tour.id);
  expect(availableTours(undefined, { 'pilot-and-extract-unavailable': false }).map(item => item.id)).toContain(tour.id);
});

test.each(tour.steps)('$id の日本語本文は90字以内', step => {
  expect(jaApp[step.textKey as keyof typeof jaApp].length).toBeLessThanOrEqual(90);
});
