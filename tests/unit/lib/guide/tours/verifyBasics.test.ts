import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VERIFY_BASICS_TOUR } from '../../../../../src/lib/guide/tours/verifyBasics';

import { jaApp } from '../../../../../src/lib/i18n/ja.app';

const tour = VERIFY_BASICS_TOUR;

test('公開済みで、重複しない 5〜9 手順を持ち一覧への案内で終わる', () => {
  expect(tour.draft).toBeUndefined();
  expect(tour.steps.length).toBeGreaterThanOrEqual(5);
  expect(tour.steps.length).toBeLessThanOrEqual(9);
  expect(new Set(tour.steps.map(step => step.id)).size).toBe(tour.steps.length);
  expect(tour.steps.at(-1)).toMatchObject({ id: 'finish', target: 'tour-list', advance: { type: 'next' } });
  expect(tour.unavailableIf).toBe('verify-basics-unavailable');
});

test.each(['decide', 'edit-evidence'])('%s の保存操作を必須にしない', id => {
  expect(tour.steps.find(step => step.id === id)!.advance).toEqual({ type: 'next' });
});

test('画面固有の対象は実在する検証ルートと対象待ちに対応する', () => {
  const source = readFileSync(join(process.cwd(), 'src/app/router.ts'), 'utf8');
  const routes = new Set(Array.from(source.matchAll(/hash: '(#\/[^']+)'/g), match => match[1]));
  for (const step of tour.steps.filter(step => step.route !== undefined)) {
    expect(routes.has(step.route)).toBe(true);
    expect(step.route).toBe('#/verify');
    expect(step.dynamicTarget).toBe(true);
  }
  expect(tour.steps[0]).toMatchObject({ id: 'open-verify', target: 'nav-verify',
    advance: { type: 'events', events: ['route-opened-verify'] } });
  expect(tour.steps.every(step => step.skipIf === undefined)).toBe(true);
});

test.each(tour.steps)('$id の日本語本文は 90 字以内', step => {
  expect(jaApp[step.textKey as keyof typeof jaApp].length).toBeLessThanOrEqual(90);
});

test('引用の削除対象は案内中の操作を遮断する', () => {
  expect(tour.steps.find(step => step.id === 'edit-evidence')!.blockTarget).toBe(true);
});
