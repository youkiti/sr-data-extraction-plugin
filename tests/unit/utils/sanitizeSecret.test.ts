import { sanitizeSecret } from '../../../src/utils/sanitizeSecret';

describe('sanitizeSecret', () => {
  test('9 文字以上は先頭 8 文字 + "..." に省略する', () => {
    expect(sanitizeSecret('AIzaSyABCDEFG')).toBe('AIzaSyAB...');
  });

  test('8 文字以下は全体を伏せる', () => {
    expect(sanitizeSecret('short')).toBe('***');
    expect(sanitizeSecret('12345678')).toBe('***');
  });

  test('9 文字ちょうどは省略形式になる（境界）', () => {
    expect(sanitizeSecret('123456789')).toBe('12345678...');
  });
});
