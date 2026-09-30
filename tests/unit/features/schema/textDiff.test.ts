import { diffText, removedInstructionSentences } from '../../../../src/features/schema/textDiff';
test.each([
  ['', ''],
  ['', 'abc'],
  ['abc', ''],
  ['abc', 'abc'],
  ['a b', 'a c b'],
  ['日本語。', '日本人。'],
  ['a b c', 'b c d'],
])('差分から元と新しい文を復元する %s → %s', (before, after) => {
  const parts = diffText(before, after)!;
  expect(
    parts
      .filter((p) => p.kind !== 'ins')
      .map((p) => p.text)
      .join(''),
  ).toBe(before);
  expect(
    parts
      .filter((p) => p.kind !== 'del')
      .map((p) => p.text)
      .join(''),
  ).toBe(after);
});
test('大きい差分は全文並記へ戻す', () =>
  expect(diffText('あ'.repeat(501), 'い'.repeat(500))).toBeNull());
test('句読点・改行で文を区切り、空白を正規化して消えた文を返す', () => {
  expect(
    removedInstructionSentences(
      'Keep  rules. 消す。A!B?C！D？E;F；G\nH',
      'Keep rules. A B C D E F G',
    ),
  ).toEqual(['消す', 'H']);
});
test('小数点と略語の "." では文を区切らない', () => {
  expect(
    removedInstructionSentences('Use 0.5 mg, e.g. tablets. Drop this.', 'Use 0.5 mg, e.g. tablets.'),
  ).toEqual(['Drop this']);
});
test('同じ種類が続くトークンは 1 つの部分にまとめる', () => {
  expect(diffText('a b', 'a x y b')).toEqual([
    { kind: 'equal', text: 'a ' },
    { kind: 'ins', text: 'x y ' },
    { kind: 'equal', text: 'b' },
  ]);
});
