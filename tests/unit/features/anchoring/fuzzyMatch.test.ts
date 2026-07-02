import { bestSubstringDistance } from '../../../../src/features/anchoring/fuzzyMatch';

describe('bestSubstringDistance', () => {
  test('空パターンは距離 0', () => {
    expect(bestSubstringDistance('', 'any text')).toEqual({ distance: 0, endIndex: 0 });
  });

  test('完全部分一致は距離 0 で終了位置を返す', () => {
    const result = bestSubstringDistance('quick brown', 'the quick brown fox');
    expect(result.distance).toBe(0);
    expect(result.endIndex).toBe('the quick brown'.length);
  });

  test('1 文字置換の部分一致は距離 1', () => {
    expect(bestSubstringDistance('quick brawn', 'the quick brown fox').distance).toBe(1);
  });

  test('text 側の欠落（挿入コスト）を数える', () => {
    // "12 %" vs "12%"（空白の脱落）→ 距離 1
    expect(bestSubstringDistance('12 %', 'mortality was 12% overall').distance).toBe(1);
  });

  test('まったく一致しない場合はパターン長に近い距離になる', () => {
    const { distance } = bestSubstringDistance('abcdef', 'zzzzzz');
    expect(distance).toBe(6);
  });

  test('text が空文字列ならパターン長が距離になる', () => {
    expect(bestSubstringDistance('abc', '').distance).toBe(3);
  });
});
