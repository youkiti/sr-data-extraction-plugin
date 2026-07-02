import { generateUuid } from '../../../src/utils/uuid';

describe('generateUuid', () => {
  test('UUID v4 形式の文字列を返す', () => {
    const uuid = generateUuid();
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  test('呼び出しごとに異なる値を返す', () => {
    expect(generateUuid()).not.toBe(generateUuid());
  });
});
