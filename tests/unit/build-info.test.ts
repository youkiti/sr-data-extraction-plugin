// build-info のテスト。jest では __DEV_NAME_SUFFIX__ に dev ビルド相当の「 (dev)」を
// 与えている（jest.config.ts）ため、付与後の値を直接検証できる
import { BUILD_DATE, DEV_NAME_SUFFIX, withDevSuffix } from '../../src/build-info';

describe('build-info', () => {
  test('BUILD_DATE / DEV_NAME_SUFFIX は DefinePlugin（jest では globals）の値を公開する', () => {
    expect(BUILD_DATE).toBe('2026-07-06');
    expect(DEV_NAME_SUFFIX).toBe(' (dev)');
  });

  describe('withDevSuffix', () => {
    test('表示名の末尾へ DEV_NAME_SUFFIX を付ける', () => {
      expect(withDevSuffix('SR Data Extraction Plugin')).toBe('SR Data Extraction Plugin (dev)');
    });

    test('textContent が null でも安全（空文字として扱う）', () => {
      expect(withDevSuffix(null)).toBe(' (dev)');
    });
  });
});
