// build-info のテスト。(dev) サフィックスの分岐は jest では __IS_DEV_BUILD__ が
// 固定値（false）のため、withDevSuffix を直接呼んで両分岐を検証する
import { BUILD_DATE, IS_DEV_BUILD, withDevSuffix } from '../../src/build-info';

describe('build-info', () => {
  test('BUILD_DATE / IS_DEV_BUILD は DefinePlugin（jest では globals）の値を公開する', () => {
    expect(BUILD_DATE).toBe('2026-07-06');
    expect(IS_DEV_BUILD).toBe(false);
  });

  describe('withDevSuffix', () => {
    test('dev ビルドでは「 (dev)」を付ける', () => {
      expect(withDevSuffix('SR Data Extraction Plugin', true)).toBe(
        'SR Data Extraction Plugin (dev)',
      );
    });

    test('本番ビルドでは名前をそのまま返す', () => {
      expect(withDevSuffix('SR Data Extraction Plugin', false)).toBe('SR Data Extraction Plugin');
    });

    test('textContent が null でも安全（空文字として扱う）', () => {
      expect(withDevSuffix(null, true)).toBe(' (dev)');
      expect(withDevSuffix(null, false)).toBe('');
    });
  });
});
