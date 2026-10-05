// スキーマの書き出し・読み込み（issue #316）の純関数のテスト
import {
  SCHEMA_EXPORT_FORMAT,
  SCHEMA_EXPORT_FORMAT_VERSION,
  SchemaImportError,
  importNoteDefault,
  parseSchemaExport,
  schemaExportFilename,
  serializeSchemaExport,
  type SchemaExportSource,
} from '../../../../src/features/schema/schemaTransfer';
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

const SOURCE: SchemaExportSource = {
  projectName: '不眠 SR',
  schemaVersion: 3,
  exportedAt: '2026-10-05T12:00:00Z',
  exportedBy: 'owner@example.com',
  extractPromptVersion: 12,
  appVersion: '0.13.0',
};

function fileWith(fields: unknown[], patch: Record<string, unknown> = {}): string {
  return JSON.stringify({ format: SCHEMA_EXPORT_FORMAT, formatVersion: 1, source: SOURCE, fields, ...patch });
}

const VALID_RAW = {
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
  note: null,
  maxQuotes: null,
  multiSelect: null,
};

describe('serializeSchemaExport / parseSchemaExport', () => {
  const fields = [
    makeField({
      fieldId: 'f-2',
      fieldIndex: 2,
      fieldName: 'data_source',
      dataType: 'enum',
      allowedValues: 'Students|Faculty|Other|NA',
      multiSelect: { exclusiveValues: ['NA'], freeTextValues: ['Other'] },
    }),
    makeField({ fieldId: 'f-1', fieldIndex: 1, fieldName: 'themes', maxQuotes: 12, unit: 'n', example: 'ex' }),
    makeField({
      fieldId: 'f-3',
      fieldIndex: 3,
      fieldName: 'rob2_judgement',
      entityLevel: 'rob_domain',
      dataType: 'enum',
      allowedValues: 'low|some|high',
      note: '{"type":"rob2_prespec"}',
    }),
  ];

  test('field_index の順に並べ、field_id・版・ai_generated を書き出さない', () => {
    const json = JSON.parse(serializeSchemaExport(fields, SOURCE));
    expect(json.format).toBe(SCHEMA_EXPORT_FORMAT);
    expect(json.formatVersion).toBe(SCHEMA_EXPORT_FORMAT_VERSION);
    expect(json.source).toEqual(SOURCE);
    expect(json.fields.map((field: { fieldName: string }) => field.fieldName)).toEqual([
      'themes',
      'data_source',
      'rob2_judgement',
    ]);
    expect(json.fields[0]).not.toHaveProperty('fieldId');
    expect(json.fields[0]).not.toHaveProperty('schemaVersion');
    expect(json.fields[0]).not.toHaveProperty('aiGenerated');
    expect(json.fields[1].multiSelect).toEqual({ exclusiveValues: ['NA'], freeTextValues: ['Other'] });
  });

  test('書き出したファイルを読み戻すと、複数選択・複数引用・事前設定まで欠けずにエディタ行になる', () => {
    const { source, rows } = parseSchemaExport(serializeSchemaExport(fields, SOURCE));
    expect(source).toEqual(SOURCE);
    expect(rows).toEqual([
      expect.objectContaining({ fieldId: null, fieldName: 'themes', maxQuotes: 12, unit: 'n', example: 'ex', aiGenerated: false }),
      expect.objectContaining({
        fieldId: null,
        fieldName: 'data_source',
        multiSelect: true,
        exclusiveValues: 'NA',
        freeTextValues: 'Other',
      }),
      expect.objectContaining({ fieldName: 'rob2_judgement', entityLevel: 'rob_domain', note: '{"type":"rob2_prespec"}', multiSelect: false, exclusiveValues: null }),
    ]);
  });

  test('複数選択で空の一覧は null にする', () => {
    const { rows } = parseSchemaExport(
      fileWith([{ ...VALID_RAW, dataType: 'enum', allowedValues: 'A|B', multiSelect: { exclusiveValues: [], freeTextValues: [] } }]),
    );
    expect(rows[0]).toMatchObject({ multiSelect: true, exclusiveValues: null, freeTextValues: null });
  });

  test('出所の任意項目が無い・型違いなら null にする', () => {
    const { source } = parseSchemaExport(
      fileWith([VALID_RAW], { source: { ...SOURCE, extractPromptVersion: 'x', appVersion: 3 } }),
    );
    expect(source.extractPromptVersion).toBeNull();
    expect(source.appVersion).toBeNull();
  });

  test.each([
    ['JSON でない', '{', 'JSON として読めませんでした。'],
    ['配列', '[]', 'この拡張で書き出したスキーマのファイルではありません。'],
    ['形式名が違う', JSON.stringify({ format: 'other', formatVersion: 1 }), 'この拡張で書き出したスキーマのファイルではありません。'],
    ['形式の版が整数でない', JSON.stringify({ format: SCHEMA_EXPORT_FORMAT, formatVersion: '1' }), 'この拡張で書き出したスキーマのファイルではありません。'],
    ['形式の版が新しい', fileWith([VALID_RAW], { formatVersion: 2 }), 'ファイルの形式（版 2）がこの拡張より新しいため読み込めません。拡張を更新してください。'],
    ['出所が無い', fileWith([VALID_RAW], { source: null }), 'この拡張で書き出したスキーマのファイルではありません。'],
    ['出所の必須項目の型が違う', fileWith([VALID_RAW], { source: { ...SOURCE, schemaVersion: '3' } }), 'この拡張で書き出したスキーマのファイルではありません。'],
    ['項目が配列でない', fileWith([], { fields: {} }), 'この拡張で書き出したスキーマのファイルではありません。'],
    ['項目が 0 件', fileWith([]), 'ファイルに項目が 1 件もありません。'],
  ])('%sファイルは理由をつけて拒否する', (_label, text, message) => {
    expect(() => parseSchemaExport(text)).toThrow(SchemaImportError);
    expect(() => parseSchemaExport(text)).toThrow(message);
  });

  test.each([
    ['オブジェクトでない', 'x', 'not an object'],
    ['文字列が必要な列', { ...VALID_RAW, fieldLabel: 1 }, 'fieldLabel'],
    ['null か文字列の列', { ...VALID_RAW, unit: 1 }, 'unit'],
    ['entity_level', { ...VALID_RAW, entityLevel: 'trial' }, 'entityLevel'],
    ['data_type', { ...VALID_RAW, dataType: 'number' }, 'dataType'],
    ['required', { ...VALID_RAW, required: 'yes' }, 'required'],
    ['max_quotes', { ...VALID_RAW, maxQuotes: 2.5 }, 'maxQuotes'],
    ['multiSelect の形', { ...VALID_RAW, multiSelect: { exclusiveValues: 'NA', freeTextValues: [] } }, 'multiSelect'],
    ['multiSelect が配列', { ...VALID_RAW, multiSelect: [] }, 'multiSelect'],
  ])('項目の%sが不正なら、何番目のどの列かを示して拒否する', (_label, raw, reason) => {
    expect(() => parseSchemaExport(fileWith([VALID_RAW, raw]))).toThrow(`2 番目の項目が読めません（${reason}）。`);
  });

  test('読めても項目の検証エラーがあれば全体を拒否する（一部だけ読み込まない）', () => {
    expect(() => parseSchemaExport(fileWith([VALID_RAW, VALID_RAW]))).toThrow(
      /^読み込んだ項目にエラーが 2 件あります（先頭: 1: field_name "study_design" が重複しています）。$/,
    );
  });
});

describe('schemaExportFilename / importNoteDefault', () => {
  test('英数字・ハイフン・ドット以外は _ にし、何も残らなければ project にする', () => {
    expect(schemaExportFilename('不眠 SR: 2026/10 v1.2', 3, '2026-10-05T12:00:00Z')).toBe('schema-v3-SR_2026_10_v1.2-2026-10-05.json');
    expect(schemaExportFilename('不眠症', 1, '2026-10-05T12:00:00Z')).toBe('schema-v1-project-2026-10-05.json');
  });

  test('出所を改訂理由の初期値にする', () => {
    expect(importNoteDefault(SOURCE)).toBe('不眠 SR の v3（2026-10-05）から読み込み');
  });
});
