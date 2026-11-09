// スキーマの CSV 書き出し・読み込み（issue #469）の純関数のテスト
import { TextDecoder as NodeTextDecoder } from 'util';
import {
  SCHEMA_CSV_COLUMNS,
  decodeSchemaCsv,
  parseSchemaCsv,
  serializeSchemaCsv,
} from '../../../../src/features/schema/schemaCsv';
import { SchemaImportError } from '../../../../src/features/schema/schemaTransfer';
import type { SchemaField } from '../../../../src/domain/schemaField';

function makeField(overrides: Partial<SchemaField> = {}): SchemaField {
  return {
    maxQuotes: null,
    multiSelect: null,
    schemaVersion: 3,
    fieldId: 'f-1',
    fieldIndex: 1,
    section: 'methods',
    fieldName: 'study_design',
    fieldLabel: '研究デザイン',
    entityLevel: 'study',
    dataType: 'text',
    unit: null,
    allowedValues: null,
    required: true,
    extractionInstruction: 'Report the design.',
    example: null,
    aiGenerated: true,
    note: null,
    ...overrides,
  };
}

const makeDecoder = (label: string, options?: { fatal?: boolean }) => new NodeTextDecoder(label, options);

function expectImportError(text: string, message: string): void {
  let caught: unknown;
  try {
    parseSchemaCsv(text);
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(SchemaImportError);
  expect((caught as Error).message).toBe(message);
}

const HEADER = 'section,field_name,field_label,entity_level,data_type,extraction_instruction';

describe('serializeSchemaCsv', () => {
  test('field_index の順に、BOM 付き・CRLF の CSV にする', () => {
    const csv = serializeSchemaCsv([
      makeField({
        fieldIndex: 2,
        fieldName: 'symptoms',
        fieldLabel: '症状, 複数',
        dataType: 'enum',
        allowedValues: 'a|b|none',
        required: false,
        maxQuotes: 3,
        unit: 'mg',
        example: 'a',
        note: 'メモ "引用"',
        multiSelect: { exclusiveValues: ['none'], freeTextValues: ['b'] },
      }),
      makeField(),
    ]);
    expect(csv.startsWith('﻿')).toBe(true);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0]).toBe(SCHEMA_CSV_COLUMNS.join(','));
    expect(lines[1]).toBe('methods,study_design,研究デザイン,study,text,,,TRUE,Report the design.,,,,FALSE,,');
    expect(lines[2]).toBe(
      'methods,symptoms,"症状, 複数",study,enum,mg,a|b|none,FALSE,Report the design.,a,"メモ ""引用""",3,TRUE,none,b',
    );
    expect(lines[3]).toBe('');
  });

  test('書き出した CSV を読み戻すと同じ内容になる', () => {
    const fields = [
      makeField(),
      makeField({
        fieldIndex: 2,
        fieldName: 'symptoms',
        dataType: 'enum',
        allowedValues: 'a|b|none',
        note: '改行\nあり',
        multiSelect: { exclusiveValues: ['none'], freeTextValues: [] },
      }),
      makeField({ fieldIndex: 3, fieldName: 'quotes', maxQuotes: 2, required: false }),
    ];
    const text = decodeSchemaCsv(new Uint8Array(Buffer.from(serializeSchemaCsv(fields), 'utf-8')), makeDecoder);
    const rows = parseSchemaCsv(text);
    expect(rows).toEqual([
      {
        fieldId: null, section: 'methods', fieldName: 'study_design', fieldLabel: '研究デザイン', entityLevel: 'study',
        dataType: 'text', unit: null, allowedValues: null, required: true, extractionInstruction: 'Report the design.',
        example: null, aiGenerated: false, note: null, maxQuotes: null, multiSelect: false, exclusiveValues: null, freeTextValues: null,
      },
      {
        fieldId: null, section: 'methods', fieldName: 'symptoms', fieldLabel: '研究デザイン', entityLevel: 'study',
        dataType: 'enum', unit: null, allowedValues: 'a|b|none', required: true, extractionInstruction: 'Report the design.',
        example: null, aiGenerated: false, note: '改行\nあり', maxQuotes: null, multiSelect: true, exclusiveValues: 'none', freeTextValues: null,
      },
      {
        fieldId: null, section: 'methods', fieldName: 'quotes', fieldLabel: '研究デザイン', entityLevel: 'study',
        dataType: 'text', unit: null, allowedValues: null, required: false, extractionInstruction: 'Report the design.',
        example: null, aiGenerated: false, note: null, maxQuotes: 2, multiSelect: false, exclusiveValues: null, freeTextValues: null,
      },
    ]);
  });
});

describe('decodeSchemaCsv', () => {
  test('UTF-8 は BOM を外して読み、UTF-8 として読めなければ Shift_JIS で読む', () => {
    expect(decodeSchemaCsv(new Uint8Array(Buffer.from('﻿あ,b', 'utf-8')), makeDecoder)).toBe('あ,b');
    expect(decodeSchemaCsv(new Uint8Array(Buffer.from('あ,b', 'utf-8')), makeDecoder)).toBe('あ,b');
    // 「あ,b」の Shift_JIS
    expect(decodeSchemaCsv(new Uint8Array([0x82, 0xa0, 0x2c, 0x62]), makeDecoder)).toBe('あ,b');
  });

  test('既定ではブラウザの TextDecoder を使う', () => {
    const original = (globalThis as { TextDecoder?: unknown }).TextDecoder;
    (globalThis as { TextDecoder?: unknown }).TextDecoder = NodeTextDecoder;
    try {
      expect(decodeSchemaCsv(new Uint8Array(Buffer.from('ok', 'utf-8')))).toBe('ok');
    } finally {
      (globalThis as { TextDecoder?: unknown }).TextDecoder = original;
    }
  });
});

describe('parseSchemaCsv', () => {
  test('列は見出し名で照合し、順は問わず、知らない列と空行は無視する。無い任意列は既定値', () => {
    const rows = parseSchemaCsv(
      [
        ' Field_Name ,memo,extraction_instruction,data_type,entity_level,field_label,section,required,multi_select,exclusive_values,allowed_values',
        'b_field,自分用メモ,Do B.,enum,arm,B,results,yes,はい,none,x|none',
        ',,,,,,,,,,',
        'a_field,,Do A.,text,study,A,methods,,no,ignored,',
      ].join('\n'),
    );
    expect(rows.map((row) => [row.fieldName, row.required, row.multiSelect, row.exclusiveValues, row.unit, row.maxQuotes])).toEqual([
      ['b_field', true, true, 'none', null, null],
      ['a_field', false, false, null, null, null],
    ]);
  });

  test('セルが足りない行は空として読む', () => {
    const rows = parseSchemaCsv(`${HEADER},unit\nmethods,a_field,A,study,text,Do A.`);
    expect(rows[0]?.unit).toBeNull();
  });

  test('見出し行も項目も無いファイルは拒否する', () => {
    expectImportError('', 'ファイルに項目が 1 件もありません。');
    expectImportError(`${HEADER}\n,,,,,\n`, 'ファイルに項目が 1 件もありません。');
  });

  test('必須の列が無い・同じ列が 2 つあるファイルは拒否する', () => {
    expectImportError(
      'section,field_name,field_label',
      '必須の列がありません: entity_level, data_type, extraction_instruction。1 行目を見出し行（書き出した CSV と同じ列名）にしてください。',
    );
    expectImportError(`${HEADER},Section`, '列「section」が 2 つあります。');
  });

  test.each([
    ['entity_level', 'methods,a,A,trial,text,Do.', '2 行目の entity_level の値「trial」は使えません（使える値: study / arm / outcome_result / rob_domain）。'],
    ['data_type', 'methods,a,A,study,number,Do.', '2 行目の data_type の値「number」は使えません（使える値: text / integer / float / boolean / enum / date）。'],
  ])('%s が不正な行は行番号つきで拒否する', (_column, line, message) => {
    expectImportError(`${HEADER}\n${line}`, message);
  });

  test.each([
    ['required', 'maybe', '3 行目の required の値「maybe」は使えません（使える値: TRUE / FALSE）。'],
    ['multi_select', '2', '3 行目の multi_select の値「2」は使えません（使える値: TRUE / FALSE）。'],
    ['max_quotes', '1.5', '3 行目の max_quotes の値「1.5」は使えません（使える値: 1, 2, 3 …）。'],
  ])('%s が不正な行は行番号つきで拒否する', (column, value, message) => {
    expectImportError(`${HEADER},${column}\nmethods,a,A,study,text,Do.,\nmethods,b,B,study,text,Do.,${value}`, message);
  });

  test('検証エラーは件数と先頭の行番号を示す（空行を飛ばしても CSV の行番号で数える）', () => {
    expectImportError(
      `${HEADER}\nmethods,a,A,study,text,Do.\n,,,,,\nmethods,a,A,study,text,Do.`,
      '読み込んだ項目にエラーが 2 件あります（先頭: 2 行目 field_name "a" が重複しています）。',
    );
  });
});
