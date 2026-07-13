// 写像付き正規化のテスト。normalizeText との結果一致（同一実装）と、
// 正規化後 index → 元テキスト範囲の写像を検証する
import {
  normalizeText,
  normalizeTextWithMap,
  toRawRange,
} from '../../../../src/features/anchoring/normalizeText';

describe('normalizeTextWithMap', () => {
  test('normalizeText と同一の正規化結果を返す（同一実装）', () => {
    const inputs = [
      'this is an exam-\nple of text',
      'exam- \n ple',
      'the X-\nRay result',
      'the ﬁrst eﬃcacy analysis',
      'ｎ＝４２　patients',
      '  multiple\t\twhitespace\n\nchars  ',
      'plain text',
      // 和文（issue #95 層 1）
      '効果を検\n討した．',
      '追跡期間は 1〜2 年（中央値）',
      '山田　太郎',
      'ﾃﾞｰﾀﾍﾞｰｽ',
      '𠮟\nる',
    ];
    for (const input of inputs) {
      expect(normalizeTextWithMap(input).text).toBe(normalizeText(input));
    }
  });

  test('和文の行折り返し: 除去された改行は写像に現れず、前後の文字が元位置を指す', () => {
    const map = normalizeTextWithMap('検\n討');
    expect(map.text).toBe('検討');
    expect(map.rawStart).toEqual([0, 2]);
    expect(map.rawEnd).toEqual([1, 3]);
  });

  test('波ダッシュの折り畳みは 1 文字 → 1 文字で写像を変えない', () => {
    const map = normalizeTextWithMap('1〜2');
    expect(map.text).toBe('1~2');
    expect(map.rawStart).toEqual([0, 1, 2]);
    expect(map.rawEnd).toEqual([1, 2, 3]);
  });

  test('全角スペースの除去: 由来の位置は写像から消える（山田　太郎 → 山田太郎）', () => {
    const map = normalizeTextWithMap('山田　太郎');
    expect(map.text).toBe('山田太郎');
    expect(map.rawStart).toEqual([0, 1, 3, 4]);
    expect(map.rawEnd).toEqual([1, 2, 4, 5]);
  });

  test('ハイフネーション結合: 結合後の各文字が元位置を指す（- と改行は写像から消える）', () => {
    const map = normalizeTextWithMap('exam-\nple');
    expect(map.text).toBe('example');
    expect(map.rawStart).toEqual([0, 1, 2, 3, 6, 7, 8]);
    expect(map.rawEnd).toEqual([1, 2, 3, 4, 7, 8, 9]);
  });

  test('リガチャ展開: fi の 2 文字が元の 1 文字（ﬁ）を指す', () => {
    const map = normalizeTextWithMap('ﬁt');
    expect(map.text).toBe('fit');
    expect(map.rawStart).toEqual([0, 0, 1]);
    expect(map.rawEnd).toEqual([1, 1, 2]);
  });

  test('空白圧縮: 1 個のスペースが連続空白全体の範囲を指す', () => {
    const map = normalizeTextWithMap('a \t\n b');
    expect(map.text).toBe('a b');
    expect(map.rawStart).toEqual([0, 1, 5]);
    expect(map.rawEnd).toEqual([1, 5, 6]);
  });

  test('前後の空白は trim され写像にも現れない', () => {
    const map = normalizeTextWithMap('  ab  ');
    expect(map.text).toBe('ab');
    expect(map.rawStart).toEqual([2, 3]);
    expect(map.rawEnd).toEqual([3, 4]);
  });

  test('結合記号は基底文字と合成され、由来は列全体（基底 + 記号）を指す', () => {
    const map = normalizeTextWithMap('e\u0301x'); // e + 結合アキュート（U+0301）
    expect(map.text).toBe('\u00e9x'); // NFKC で合成済み é になる
    expect(map.rawStart).toEqual([0, 2]);
    expect(map.rawEnd).toEqual([2, 3]);
  });

  test('サロゲートペア（数学用英字 𝐀）も NFKC で写像付き変換される', () => {
    const map = normalizeTextWithMap('\u{1D400}b'); // 𝐀 → A
    expect(map.text).toBe('Ab');
    expect(map.rawStart).toEqual([0, 2]);
    expect(map.rawEnd).toEqual([2, 3]);
  });

  test('空文字列は空の写像を返す', () => {
    expect(normalizeTextWithMap('')).toEqual({ text: '', rawStart: [], rawEnd: [] });
  });
});

describe('toRawRange', () => {
  const map = normalizeTextWithMap('exam-\nple');

  test('正規化範囲を元テキスト範囲へ写像する', () => {
    expect(toRawRange(map, { start: 0, end: 7 })).toEqual({ start: 0, end: 9 });
    expect(toRawRange(map, { start: 4, end: 7 })).toEqual({ start: 6, end: 9 });
  });

  test('不正範囲（負・超過・空）は null', () => {
    expect(toRawRange(map, { start: -1, end: 2 })).toBeNull();
    expect(toRawRange(map, { start: 0, end: 8 })).toBeNull();
    expect(toRawRange(map, { start: 3, end: 3 })).toBeNull();
  });
});
