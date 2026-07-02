import { locateQuoteRange } from '../../../../src/features/anchoring/locateQuote';

describe('locateQuoteRange', () => {
  const page = 'the primary outcome was mortality at 30 days';

  test('exact: 最初の出現の範囲を返す', () => {
    expect(locateQuoteRange('primary outcome', page, 'exact')).toEqual({ start: 4, end: 19 });
  });

  test('normalized: exact と同じく indexOf で特定する', () => {
    expect(locateQuoteRange('mortality', page, 'normalized')).toEqual({ start: 24, end: 33 });
  });

  test('ページ上に見つからない場合は null（ページ選択と食い違う入力への防御）', () => {
    expect(locateQuoteRange('absent phrase', page, 'exact')).toBeNull();
  });

  test('failed は null（検証画面のフォールバック検索 UI に委ねる）', () => {
    expect(locateQuoteRange('primary outcome', page, 'failed')).toBeNull();
  });

  test('空 quote は null', () => {
    expect(locateQuoteRange('', page, 'exact')).toBeNull();
  });

  test('fuzzy: 準大域アライメントで始端・終端を復元する（1 文字欠落）', () => {
    const range = locateQuoteRange('primary outcom was mortality', page, 'fuzzy');
    expect(range).not.toBeNull();
    const { start, end } = range as { start: number; end: number };
    expect(page.slice(start, end)).toBe('primary outcome was mortality');
  });

  test('fuzzy: 置換を含む quote でも範囲を復元する', () => {
    const range = locateQuoteRange('mortality at 3O days', page, 'fuzzy'); // O ↔ 0 の OCR 揺れ
    expect(range).not.toBeNull();
    const { start, end } = range as { start: number; end: number };
    expect(page.slice(start, end)).toBe('mortality at 30 days');
  });
});
