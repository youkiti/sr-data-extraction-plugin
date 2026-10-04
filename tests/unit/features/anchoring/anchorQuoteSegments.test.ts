import { anchorQuoteSegments, MIN_SEGMENT_LENGTH } from '../../../../src/features/anchoring/anchorQuoteSegments';
import { normalizeText } from '../../../../src/features/anchoring/normalizeText';

const heading = 'Sleep efficiency (%)';
const data = 'CBT-I 66.12 (1.37) 82.64 (1.35)';
const pages = [{ page: 1, text: normalizeText(`${heading} intervening table columns ${data}`) }];

test.each(['', 'plain quote', '\n … ... \r\n', '\n single fragment …'])('断片が 1 個以下なら分割しない: %j', (quote) => {
  expect(anchorQuoteSegments(quote, pages, 1)).toBeNull();
});

test('折り返しをすべて結合できるときは分割しない', () => {
  expect(anchorQuoteSegments('Sleep\nefficiency\r(%)', pages, 1)).toBeNull();
});

test.each(['\n', '\r\n', '\r', '...', '....', '…'])('離れた行見出しとデータ行を照合する: %j', (separator) => {
  expect(anchorQuoteSegments(` ${heading} ${separator} ${data} `, pages, 1)).toEqual([
    { quote: heading, anchor: expect.objectContaining({ status: 'exact', page: 1 }) },
    { quote: data, anchor: expect.objectContaining({ status: 'exact', page: 1 }) },
  ]);
});

test('省略記号でつないだ年齢見出しと数値を照合する', () => {
  const quote = 'Age, M (SD) ... 46.53 (6.31)';
  const source = [{ page: 2, text: 'Age, M (SD) control treatment baseline 46.53 (6.31)' }];
  expect(anchorQuoteSegments(quote, source, null)?.map((part) => part.quote)).toEqual(['Age, M (SD)', '46.53 (6.31)']);
});

test('短い断片を左隣に結合する', () => {
  expect(anchorQuoteSegments(`Sleep efficiency\n(%)\n${data}`, pages, 1)?.map((part) => part.quote)).toEqual([heading, data]);
});

test.each([`Sleep\nefficiency (%)\n${data}`, `${data}\nSleep\nefficiency (%)`])('短い断片を右隣に結合する（先頭も含む）: %j', (quote) => {
  const expected = quote.startsWith('Sleep') ? [heading, data] : [data, heading];
  expect(anchorQuoteSegments(quote, pages, 1)?.map((part) => part.quote)).toEqual(expected);
});

test('長い断片にも結合規則を適用し、正規化して原文を探す', () => {
  const source = [{ page: 1, text: 'long heading data values unrelated section another fragment' }];
  expect(anchorQuoteSegments('ｌｏｎｇ heading\ndata values\nanother fragment', source, 1)?.map((part) => part.quote)).toEqual([
    'ｌｏｎｇ heading data values', 'another fragment',
  ]);
});

test('結合に fuzzy を使わず、各断片の照合には fuzzy を使う', () => {
  const source = [{ page: 1, text: 'abcdefghXijklmnop' }];
  expect(anchorQuoteSegments('abcdefgh\nijklmnop', source, 1)).toHaveLength(2);
  expect(anchorQuoteSegments(`${heading}\n${data}`, [{ page: 1, text: heading }, { page: 5, text: data.replace('66.12', '66.13') }], 1)).toEqual([
    { quote: heading, anchor: expect.objectContaining({ status: 'exact', page: 1 }) },
    { quote: data, anchor: expect.objectContaining({ status: 'fuzzy', page: 5 }) },
  ]);
});

test('別ページで見つかった断片を採用し、AI ヒントではなく照合ページを返す', () => {
  expect(anchorQuoteSegments(`${heading}\n${data}`, [{ page: 1, text: heading }, { page: 5, text: data }], 1)).toEqual([
    { quote: heading, anchor: expect.objectContaining({ status: 'exact', page: 1 }) },
    { quote: data, anchor: expect.objectContaining({ status: 'normalized', page: 5 }) },
  ]);
});

test('最小長は正規化後の 8 文字で判定し、7 文字は採用しない', () => {
  expect(MIN_SEGMENT_LENGTH).toBe(8);
  const source = [{ page: 1, text: 'abcdefgh intervening text ijklmnop' }];
  expect(anchorQuoteSegments('abcdefgh\nijklmnop', source, 1)).toHaveLength(2);
  // 7 文字の断片は原文にそのまま在っても（= 照合自体は成功しても）採用しない
  const shortSource = [{ page: 1, text: 'abcdefg intervening text ijklmnop あいうえおかき' }];
  expect(anchorQuoteSegments('abcdefg\nijklmnop', shortSource, 1)).toBeNull();
  expect(anchorQuoteSegments('あ い う え お か き\nijklmnop', shortSource, 1)).toBeNull();
});

test.each([`${heading}\ncompletely absent words`, 'totally missing phrase\ncompletely absent words'])('一部または全部が失敗すれば採用しない: %j', (quote) => {
  expect(anchorQuoteSegments(quote, pages, 1)).toBeNull();
});
