import { nowIso8601 } from '../../../src/utils/iso8601';

describe('nowIso8601', () => {
  test('ISO 8601（UTC・ミリ秒付き）形式を返す', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-02T12:34:56.789Z'));
    expect(nowIso8601()).toBe('2026-07-02T12:34:56.789Z');
    jest.useRealTimers();
  });
});
