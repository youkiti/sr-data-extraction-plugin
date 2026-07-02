// 共通正規化の table-driven テスト（architecture.md §4.3 のケース一覧に対応）
import { normalizeText } from '../../../../src/features/anchoring/normalizeText';

describe('normalizeText', () => {
  const cases: Array<{ name: string; input: string; expected: string }> = [
    {
      name: '行末ハイフネーションを結合する（exam-\\nple → example）',
      input: 'this is an exam-\nple of text',
      expected: 'this is an example of text',
    },
    {
      name: 'ハイフン前後の空白（PDF テキスト層の揺れ）も吸収する',
      input: 'exam- \n ple',
      expected: 'example',
    },
    {
      name: '大文字が続くハイフンは結合しない（複合語 X-\\nRay 等）',
      input: 'the X-\nRay result',
      expected: 'the X- Ray result',
    },
    {
      name: 'リガチャを展開する（ﬁ → fi。NFKC が吸収）',
      input: 'the ﬁrst eﬃcacy analysis',
      expected: 'the first efficacy analysis',
    },
    {
      name: '全角英数・全角スペースを半角へ統一する（NFKC）',
      input: 'ｎ＝４２　patients',
      expected: 'n=42 patients',
    },
    {
      name: '連続空白・改行・タブを 1 個の半角スペースへ圧縮する',
      input: '  multiple\t\twhitespace\n\nchars  ',
      expected: 'multiple whitespace chars',
    },
    {
      name: '正規化不要のテキストはそのまま',
      input: 'plain text',
      expected: 'plain text',
    },
  ];

  test.each(cases)('$name', ({ input, expected }) => {
    expect(normalizeText(input)).toBe(expected);
  });
});
