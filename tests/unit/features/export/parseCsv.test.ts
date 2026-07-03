import { buildCsv, CSV_BOM } from '../../../../src/features/export/csvEncode';
import { parseCsv } from '../../../../src/features/export/parseCsv';

describe('parseCsv', () => {
  test('buildCsv の出力（BOM + CRLF + 末尾改行）をそのまま読み戻せる', () => {
    const csv = buildCsv(
      ['a', 'b'],
      [
        ['1', '2'],
        ['3', '4'],
      ],
    );
    expect(parseCsv(csv)).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  test('引用フィールド（カンマ・改行・"" エスケープ）を復元する', () => {
    const csv = buildCsv(['q'], [['say "hi", ok?\r\nnext line']]);
    expect(parseCsv(csv)).toEqual([['q'], ['say "hi", ok?\r\nnext line']]);
  });

  test('BOM なし・末尾改行なし・LF 改行の入力も読める', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  test('空文字は空配列、末尾カンマは空フィールドとして残る', () => {
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv(`${CSV_BOM}a,`)).toEqual([['a', '']]);
  });

  test('引用外の単独 \\r は通常文字として扱う（内部利用の割り切り）', () => {
    expect(parseCsv('a\rb')).toEqual([['a\rb']]);
  });
});
