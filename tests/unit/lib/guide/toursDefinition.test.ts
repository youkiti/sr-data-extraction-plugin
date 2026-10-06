import { GUIDE_TOURS, GUIDE_TOUR_IDS, isGuideTourId, stepKey, tourDescKey, tourKeyBase, tourTitleKey } from '../../../../src/lib/guide/tours';
import { jaApp } from '../../../../src/lib/i18n/ja.app';
import { enApp } from '../../../../src/lib/i18n/en.app';

test('登録 ID と定義は一致し、未知の値や継承プロパティを ID と認めない', () => {
  expect(GUIDE_TOUR_IDS).toEqual(['getting-started']);
  for (const [id, tour] of Object.entries(GUIDE_TOURS)) {
    expect(tour.id).toBe(id);
    expect(isGuideTourId(id)).toBe(true);
  }
  for (const value of [undefined, null, 1, 'unknown', 'toString']) expect(isGuideTourId(value)).toBe(false);
});

test('文言キーは「画面.要素」の形で、ID は PascalCase になる（語が1つでも複数でも）', () => {
  expect(tourKeyBase('getting-started')).toBe('guide.tourGettingStarted');
  expect(tourKeyBase('schema')).toBe('guide.tourSchema');
  const base = tourKeyBase('getting-started');
  expect(tourTitleKey(base)).toBe('guide.tourGettingStartedTitle');
  expect(tourDescKey(base)).toBe('guide.tourGettingStartedDesc');
  expect(stepKey(base, 'import-documents')).toBe('guide.tourGettingStartedStepImportDocuments');
  expect(stepKey(base, 'import')).toBe('guide.tourGettingStartedStepImport');
  for (const key of [tourTitleKey(base), tourDescKey(base), stepKey(base, 'import-documents'), stepKey(base, 'import')]) {
    expect(key).toMatch(/^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/);
  }
});

test('枠も含め見出し・説明が日英にあり、公開ツアーは重複しない手順を持ち next で終わる', () => {
  for (const tour of Object.values(GUIDE_TOURS)) {
    const base = tourKeyBase(tour.id);
    expect(tour.titleKey).toBe(tourTitleKey(base));
    expect(tour.descriptionKey).toBe(tourDescKey(base));
    for (const key of [tour.titleKey, tour.descriptionKey]) {
      for (const dict of [jaApp, enApp]) {
        expect(Object.prototype.hasOwnProperty.call(dict, key)).toBe(true);
        expect((dict as Record<string, string>)[key]!.length).toBeGreaterThan(0);
      }
    }
    if (tour.draft) {
      expect(tour.steps).toEqual([]);
    } else {
      expect(tour.steps.length).toBeGreaterThan(0);
      expect(new Set(tour.steps.map(step => step.id)).size).toBe(tour.steps.length);
      expect(tour.steps[tour.steps.length - 1]!.advance.type).toBe('next');
    }
  }
});
