import {
  PAGE_SEPARATOR,
  parseExtractedText,
  serializeExtractedText,
} from '../../../../src/features/documents/extractedText';

const FF = String.fromCharCode(12); // form feed（U+000C）

describe('PAGE_SEPARATOR', () => {
  test('form feed（U+000C）である', () => {
    expect(PAGE_SEPARATOR).toBe(FF);
  });
});

describe('serializeExtractedText / parseExtractedText', () => {
  test('ページ別テキストがラウンドトリップする（空ページも保持）', () => {
    const pages = [
      { page: 1, text: 'first page' },
      { page: 2, text: '' }, // テキストのないページも空区画として保持
      { page: 3, text: 'third page' },
    ];
    const serialized = serializeExtractedText(pages);
    expect(serialized).toBe(`first page${FF}${FF}third page`);
    expect(parseExtractedText(serialized)).toEqual(pages);
  });

  test('本文中の form feed は同じ幅の空白へ置換する（文字オフセット保存）', () => {
    const dirty = `abc${FF}def`;
    const serialized = serializeExtractedText([{ page: 1, text: dirty }]);
    expect(serialized).toBe('abc def');
    expect(serialized).toHaveLength(dirty.length);
  });

  test('ページ番号が 1 始まりの連番でなければ throw', () => {
    expect(() => serializeExtractedText([{ page: 2, text: 'x' }])).toThrow('連番ではありません');
    expect(() =>
      serializeExtractedText([
        { page: 1, text: 'x' },
        { page: 3, text: 'y' },
      ]),
    ).toThrow('2 番目のページが page=3');
  });

  test('serialize は 0 ページを拒否し、parse は空文字列を [] にする', () => {
    expect(() => serializeExtractedText([])).toThrow('ページが 1 件も渡されていません');
    expect(parseExtractedText('')).toEqual([]);
  });
});
