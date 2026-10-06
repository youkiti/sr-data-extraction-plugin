import { computeTourCardPosition as place, intersectsViewport } from '../../../../src/app/guide/placement';

const base = { viewport: { width: 1000, height: 800 }, card: { width: 200, height: 200 }, margin: 10, gap: 10, pad: 0 };
test('下、上、左、右、下端、対象待ちの配置を画面内へ収める', () => {
  expect(place({ ...base, target: { left: 100, right: 200, top: 100, bottom: 200 } })).toEqual({ left: 100, top: 210 });
  expect(place({ ...base, target: { left: 900, right: 1000, top: 600, bottom: 700 } })).toEqual({ left: 790, top: 390 });
  expect(place({ ...base, target: { left: 400, right: 600, top: 100, bottom: 700 } })).toEqual({ left: 190, top: 100 });
  expect(place({ ...base, target: { left: 0, right: 100, top: 100, bottom: 700 } })).toEqual({ left: 110, top: 100 });
  expect(place({ ...base, target: { left: 0, right: 1000, top: 100, bottom: 700 } })).toEqual({ left: 10, top: 590 });
  expect(place({ ...base, target: null })).toEqual({ left: 790, top: 590 });
  expect(place({ ...base, target: { left: 0, right: 100, top: -200, bottom: -100 } })).toEqual({ left: 790, top: 590 });
  expect(place({ ...base, card: { width: 2000, height: 2000 }, target: null })).toEqual({ left: 10, top: 10 });
});
test('画面外を四方向で判定する', () => {
  for (const box of [
    { top: -100, bottom: 0, left: 0, right: 10 }, { top: 800, bottom: 900, left: 0, right: 10 },
    { top: 0, bottom: 10, left: -100, right: 0 }, { top: 0, bottom: 10, left: 1000, right: 1010 },
  ]) expect(intersectsViewport(box, base.viewport)).toBe(false);
});
