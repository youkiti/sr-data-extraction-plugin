// 担当セット識別子と表示順の境界値を検証する。
import {
  CALIBRATION_SET_ID,
  compareReviewSetIds,
  groupSetId,
  isGroupSetId,
} from '../../../src/domain/reviewSet';

describe('担当セット識別子', () => {
  test('calibration と 1 から始まるグループ番号を定義する', () => {
    expect(CALIBRATION_SET_ID).toBe('calibration');
    expect(groupSetId(1)).toBe('group-1');
    expect(groupSetId(10)).toBe('group-10');
    for (const n of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => groupSetId(n)).toThrow('グループ番号');
    }
  });
  test('グループ識別子は正の安全整数だけを許容する', () => {
    expect(isGroupSetId('group-1')).toBe(true);
    expect(isGroupSetId('group-10')).toBe(true);
    for (const id of [
      'calibration',
      '',
      'group-0',
      'group-01',
      'group--1',
      'group-1.5',
      'group-1x',
      'group-9007199254740992',
    ]) {
      expect(isGroupSetId(id)).toBe(false);
    }
  });
  test('calibration、番号順のグループ、不明な識別子の順に並べる', () => {
    const ids = ['z', 'group-10', 'group-2', 'calibration', 'group-1', 'a'];
    expect(ids.sort(compareReviewSetIds)).toEqual([
      'calibration',
      'group-1',
      'group-2',
      'group-10',
      'a',
      'z',
    ]);
    expect(compareReviewSetIds('group-1', 'group-1')).toBe(0);
    expect(compareReviewSetIds('calibration', 'group-1')).toBeLessThan(0);
    expect(compareReviewSetIds('group-1', 'calibration')).toBeGreaterThan(0);
    expect(compareReviewSetIds('group-1', '不明')).toBeLessThan(0);
    expect(compareReviewSetIds('不明', 'group-1')).toBeGreaterThan(0);
  });
});
