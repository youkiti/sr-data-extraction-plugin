import { GUIDE_TOURS, type TourDefinition } from '../../../../src/lib/guide/tours';
import { availableTours, createEmptyGuideProgress, isTourUnavailable, shouldSuggest, tourToSuggestOnEvent } from '../../../../src/lib/guide/tourProgress';
import { useTestTours } from './__fixtures__/tours';

const published: TourDefinition = {
  id: 'getting-started', titleKey: 'title', descriptionKey: 'description', unavailableIf: 'not-owner',
  steps: [{ id: 'finish', target: 'tour-list', textKey: 'finish', advance: { type: 'next' } }],
};
const draft: TourDefinition = { ...published, id: 'verify-basics', draft: true, steps: [], suggestOn: 'route-opened-home' };
useTestTours([published, draft]);

test('公開ツアーと空の枠は独立して判定し、owner 制約と未定義条件を区別する', () => {
  expect(availableTours([draft, published])).toEqual([published]);
  expect(availableTours(undefined, { 'not-owner': true })).toEqual([]);
  expect(availableTours(undefined, { 'not-owner': false })).toEqual([published]);
  expect(isTourUnavailable({}, {})).toBe(false);
  expect(isTourUnavailable(published, new Set(['not-owner']))).toBe(true);
  expect(shouldSuggest(createEmptyGuideProgress(), { screen: 'home' })).toBe(true);
  GUIDE_TOURS['getting-started'] = { ...draft, id: 'getting-started' };
  expect(shouldSuggest(createEmptyGuideProgress(), { screen: 'home' })).toBe(false);
});

test('登録した空の枠は一覧とイベントによる提案から除外する', () => {
  expect(availableTours()).toEqual([published]);
  expect(tourToSuggestOnEvent(createEmptyGuideProgress(), 'route-opened-home')).toBeNull();
  expect(tourToSuggestOnEvent(createEmptyGuideProgress(), 'route-opened-home', [draft])).toBeNull();
});
