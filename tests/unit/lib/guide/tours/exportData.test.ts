import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { jaApp } from '../../../../../src/lib/i18n/ja.app';
import { enApp } from '../../../../../src/lib/i18n/en.app';
import { EXPORT_DATA_TOUR } from '../../../../../src/lib/guide/tours/exportData';

test('公開された手順は重複せず、一覧を対象とする next で終わる', () => {
  expect(EXPORT_DATA_TOUR.draft).toBeUndefined();
  expect(EXPORT_DATA_TOUR.unavailableIf).toBe('export-data-unavailable');
  const steps = EXPORT_DATA_TOUR.steps;
  expect(steps.length).toBeGreaterThanOrEqual(5);
  expect(steps.length).toBeLessThanOrEqual(9);
  expect(new Set(steps.map(step => step.id)).size).toBe(steps.length);
  expect(steps[steps.length - 1]).toMatchObject({
    id: 'finish', target: 'tour-list', advance: { type: 'next' },
  });
});

test.each(['generate', 'unverified-warning'])('%s は保存や警告の表示を強制しない', id => {
  expect(EXPORT_DATA_TOUR.steps.find(step => step.id === id)!.advance).toEqual({ type: 'next' });
});

test('画面固有の手順は実在するルートと動的対象を持つ', () => {
  const router = readFileSync(join(process.cwd(), 'src/app/router.ts'), 'utf8');
  const routes = new Set(Array.from(router.matchAll(/hash: '(#\/[^']+)'/g), match => match[1]));
  for (const step of EXPORT_DATA_TOUR.steps) {
    if (step.route !== undefined) {
      expect(routes.has(step.route)).toBe(true);
      expect(step.dynamicTarget).toBe(true);
    }
  }
});

test.each(EXPORT_DATA_TOUR.steps)('$id の本文は短く、完了は 1 文に収まる', step => {
  const ja = (jaApp as Record<string, string>)[step.textKey]!;
  const en = (enApp as Record<string, string>)[step.textKey]!;
  expect(ja.length).toBeLessThanOrEqual(90);
  const limit = step.id === 'finish' ? 1 : 2;
  expect(ja.split('。').filter(sentence => sentence.trim()).length).toBeLessThanOrEqual(limit);
  expect(en.split(/[.!?]/).filter(sentence => sentence.trim()).length).toBeLessThanOrEqual(limit);
});
