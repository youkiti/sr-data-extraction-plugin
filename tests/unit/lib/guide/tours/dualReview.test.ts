import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { jaApp } from '../../../../../src/lib/i18n/ja.app';
import { DUAL_REVIEW_TOUR } from '../../../../../src/lib/guide/tours/dualReview';

test('公開された 9 手順は一意で、最後は一覧を示して next で終了する', () => {
  const tour = DUAL_REVIEW_TOUR;
  expect(tour.draft).toBeUndefined();
  expect(tour.steps).toHaveLength(9);
  expect(new Set(tour.steps.map(step => step.id)).size).toBe(tour.steps.length);
  expect(tour.steps[tour.steps.length - 1]).toMatchObject({
    id: 'finish', target: 'tour-list', advance: { type: 'next' },
  });
});

test.each(['add-reviewer', 'review-mode', 'review-sets', 'resolve'])('%s は影響のある操作を実行せず進める', id => {
  const step = DUAL_REVIEW_TOUR.steps.find(step => step.id === id)!;
  expect(step.advance).toEqual({ type: 'next' });
});

test('ルートは実在し、状態で消える操作部は動的対象として扱う', () => {
  const router = readFileSync(join(process.cwd(), 'src/app/router.ts'), 'utf8');
  const routes = new Set(Array.from(router.matchAll(/hash: '(#\/[^']+)'/g), match => match[1]));
  for (const step of DUAL_REVIEW_TOUR.steps) {
    if (step.route !== undefined) {
      expect(routes.has(step.route)).toBe(true);
      expect(step.dynamicTarget).toBe(true);
    }
  }
});

test.each(DUAL_REVIEW_TOUR.steps)('$id の日本語本文は 90 字以内', step => {
  expect(jaApp[step.textKey as keyof typeof jaApp].length).toBeLessThanOrEqual(90);
});

test('担当セットの分割は案内中に操作できない', () => {
  expect(DUAL_REVIEW_TOUR.steps.find(step => step.id === 'review-sets')).toMatchObject({
    blockTarget: true,
  });
});

test('モード選択は追加より前、文献を開く案内は一致度と不一致の間に置く', () => {
  const ids = DUAL_REVIEW_TOUR.steps.map(step => step.id);
  expect(ids.indexOf('review-mode')).toBeLessThan(ids.indexOf('add-reviewer'));
  expect(ids.indexOf('agreement')).toBeLessThan(ids.indexOf('open-study'));
  expect(ids.indexOf('open-study')).toBeLessThan(ids.indexOf('resolve'));
  expect(DUAL_REVIEW_TOUR.steps.find(step => step.id === 'open-study')).toMatchObject({
    route: '#/adjudicate', target: 'dual-review-studies', dynamicTarget: true, advance: { type: 'next' },
  });
});
