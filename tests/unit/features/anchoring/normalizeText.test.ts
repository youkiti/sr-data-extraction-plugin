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

  // 和文対応（issue #95 層 1）。NFKC の挙動固定と、波ダッシュ折り畳み・
  // 和文文字に隣接する空白の除去（行折り返し由来のノイズ対策）を検証する
  const jaCases: Array<{ name: string; input: string; expected: string }> = [
    {
      name: '全角英数・全角記号を半角へ統一する（NFKC）',
      input: 'ｐ＜０．０５（両側検定）',
      expected: 'p<0.05(両側検定)',
    },
    {
      name: '半角カナを全角へ統一し、濁点も合成する（NFKC）',
      input: 'ﾃﾞｰﾀﾍﾞｰｽ',
      expected: 'データベース',
    },
    {
      name: '半角中黒（U+FF65）は全角中黒（U+30FB）へ統一する（NFKC）',
      input: 'ｸﾞﾙｰﾌﾟA･B',
      expected: 'グループA・B',
    },
    {
      name: '波ダッシュ（U+301C）は ~ へ折り畳む（JIS 由来のテキスト層）',
      input: '追跡期間は 1〜2 年（中央値）',
      expected: '追跡期間は1~2年(中央値)',
    },
    {
      name: '全角チルダ（U+FF5E）も NFKC 経由で ~ へ揃う（CP932 由来の LLM 出力）',
      input: '追跡期間は 1～2 年（中央値）',
      expected: '追跡期間は1~2年(中央値)',
    },
    {
      name: '和文の行折り返し（改行）は空白を残さず結合する',
      input: '本研究ではよりバイア\nスに対処可能なデザインを用い，効果を検\n討した．',
      expected: '本研究ではよりバイアスに対処可能なデザインを用い,効果を検討した.',
    },
    {
      name: '全角スペース（U+3000）も和文文字に隣接すれば除去する',
      input: '山田　太郎',
      expected: '山田太郎',
    },
    {
      name: '和文文字と英数字の境界の空白も除去する（テキスト層のフォント切替由来）',
      input: '1 歳 0 か月（図 2 参照）',
      expected: '1歳0か月(図2参照)',
    },
    {
      name: '句読点（NFKC 後の記号含む）に隣接する空白も除去する',
      input: '対処した．\nまた，考察では',
      expected: '対処した.また,考察では',
    },
    {
      name: '長音符（U+30FC。Script=Common）に隣接する空白も除去する',
      input: 'コーヒー\n摂取との関連',
      expected: 'コーヒー摂取との関連',
    },
    {
      name: 'サロゲートペアの漢字（𠮟）に隣接する空白も除去する',
      input: '𠮟\nる指導と a 𠮟 b',
      expected: '𠮟る指導とa𠮟b',
    },
    {
      name: '英文だけの空白は従来どおり保持する（既存の英文マッチ品質を変えない）',
      input: 'word\nword and 12 %',
      expected: 'word word and 12 %',
    },
  ];

  test.each(jaCases)('$name', ({ input, expected }) => {
    expect(normalizeText(input)).toBe(expected);
  });

  // 不正なサロゲート（対にならない前半 / 後半）は和文と誤判定せず空白を保持する
  test('孤立サロゲートに隣接する空白は除去しない（防御的分岐）', () => {
    expect(normalizeText('a \ud842')).toBe('a \ud842');
    expect(normalizeText('\udc00 a')).toBe('\udc00 a');
  });
});
