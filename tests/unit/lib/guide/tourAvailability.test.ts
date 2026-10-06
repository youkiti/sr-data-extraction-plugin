import { GUIDE_TOURS } from '../../../../src/lib/guide/tours';
import { availableTours, createEmptyGuideProgress, isTourUnavailable, shouldSuggest } from '../../../../src/lib/guide/tourProgress';

test('公開ツアーと空の枠は独立して判定し、owner 制約と未定義条件を区別する', () => {
  const published = GUIDE_TOURS['getting-started'];
  const draft = { ...published, draft: true as const, steps: [] };
  expect(availableTours([draft, published])).toEqual([published]);
  expect(availableTours(undefined, { 'not-owner': true })).toEqual([]);
  expect(availableTours(undefined, { 'not-owner': false })).toEqual([published]);
  expect(isTourUnavailable({}, {})).toBe(false);
  expect(isTourUnavailable(published, new Set(['not-owner']))).toBe(true);
  expect(shouldSuggest(createEmptyGuideProgress(), { screen: 'home' })).toBe(true);
  try {
    GUIDE_TOURS['getting-started'] = draft;
    expect(shouldSuggest(createEmptyGuideProgress(), { screen: 'home' })).toBe(false);
  } finally {
    GUIDE_TOURS['getting-started'] = published;
  }
});
