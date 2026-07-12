import { parseCsv } from '../../../../../src/features/export/parseCsv';
import {
  buildDataDictionaryCsv,
  DATA_DICTIONARY_HEADER,
} from '../../../../../src/features/export/rset/buildDataDictionaryCsv';
import { makeField } from './testHelpers';

describe('buildDataDictionaryCsv', () => {
  test('項目が無ければヘッダーのみ', () => {
    const result = buildDataDictionaryCsv([]);
    expect(result.csv).toBe(`${DATA_DICTIONARY_HEADER.join(',')}\r\n`);
    expect(result.rowCount).toBe(0);
  });

  test('field_index 順に並び、null 許容列は空文字へ正規化する', () => {
    const fields = [
      makeField({
        fieldId: 'f-2',
        fieldIndex: 2,
        fieldName: 'country',
        unit: null,
        allowedValues: null,
        example: null,
      }),
      makeField({
        fieldId: 'f-1',
        fieldIndex: 1,
        fieldName: 'sample_size_total',
        unit: 'people',
        allowedValues: 'a|b',
        example: '120',
        required: false,
      }),
    ];
    const result = buildDataDictionaryCsv(fields);
    expect(result.rowCount).toBe(2);
    const records = parseCsv(result.csv);
    expect(records[1]).toEqual([
      'f-1',
      'sample_size_total',
      'フィールド 1',
      'methods',
      'study',
      'text',
      'people',
      'a|b',
      'false',
      '抽出指示',
      '120',
      '1',
    ]);
    expect(records[2]).toEqual([
      'f-2',
      'country',
      'フィールド 1',
      'methods',
      'study',
      'text',
      '',
      '',
      'true',
      '抽出指示',
      '',
      '1',
    ]);
  });
});
