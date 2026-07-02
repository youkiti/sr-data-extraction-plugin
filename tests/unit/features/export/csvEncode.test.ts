import { CSV_BOM, buildCsv, encodeCsvField } from '../../../../src/features/export/csvEncode';

describe('CSV_BOM', () => {
  test('U+FEFF の 1 文字である', () => {
    expect(CSV_BOM.length).toBe(1);
    expect(CSV_BOM.charCodeAt(0)).toBe(0xfeff);
  });
});

describe('encodeCsvField', () => {
  test('カンマ・引用符・改行を含まない値はそのまま', () => {
    expect(encodeCsvField('plain')).toBe('plain');
    expect(encodeCsvField('')).toBe('');
  });

  test('カンマを含む値は引用する', () => {
    expect(encodeCsvField('Smith, 2020')).toBe('"Smith, 2020"');
  });

  test('引用符は "" にエスケープして引用する', () => {
    expect(encodeCsvField('the "gold" standard')).toBe('"the ""gold"" standard"');
  });

  test('改行（LF / CRLF）を含む値は引用する', () => {
    expect(encodeCsvField('line1\nline2')).toBe('"line1\nline2"');
    expect(encodeCsvField('line1\r\nline2')).toBe('"line1\r\nline2"');
  });
});

describe('buildCsv', () => {
  test('BOM + ヘッダー + データ行を CRLF 区切り（末尾改行あり）で組み立てる', () => {
    const csv = buildCsv(['a', 'b'], [['1', 'x,y'], ['2', 'z']]);
    expect(csv).toBe(`${CSV_BOM}a,b\r\n1,"x,y"\r\n2,z\r\n`);
  });

  test('データ行なしはヘッダーのみ', () => {
    expect(buildCsv(['a', 'b'], [])).toBe(`${CSV_BOM}a,b\r\n`);
  });
});
