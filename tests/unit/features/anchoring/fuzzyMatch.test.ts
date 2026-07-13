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

  // 和文（issue #95 層 1）: DP は文字（UTF-16 コード単位）ベースで単語区切り（空白）を
  // 前提としないため、語間空白のない連続文字列でも英文と同品質でマッチする
  test('和文（語間空白なしの連続文字列）の完全部分一致は距離 0', () => {
    const result = bestSubstringDistance('歯科保健行動', '母親の歯科保健行動を検討した');
    expect(result.distance).toBe(0);
    expect(result.endIndex).toBe('母親の歯科保健行動'.length);
  });

  test('和文の 1 文字置換（保健 → 保険）は距離 1', () => {
    expect(bestSubstringDistance('歯科保険行動', '母親の歯科保健行動を検討した').distance).toBe(1);
  });
});
