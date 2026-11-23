import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import type { SchemaField } from '../../../../../src/domain/schemaField';
import { parseCsv } from '../../../../../src/features/export/parseCsv';
import { buildMaCsv } from '../../../../../src/features/export/rset/buildMaCsv';
import { buildTab1Csv } from '../../../../../src/features/export/rset/buildTab1Csv';
import type { SchemaEditorRow } from '../../../../../src/features/schema/types';
import { validateEditorRows } from '../../../../../src/features/schema/validateField';
import { makeField, makeStudy, makeStudyDataRow } from './testHelpers';

interface FrozenSchema {
  schema_version: number;
  fields: {
    field_id: string;
    field_name: string;
    entity_level: SchemaField['entityLevel'];
    data_type: SchemaField['dataType'];
    extraction_instruction: string;
  }[];
}

describe('凍結ベンチのスキーマとの互換性', () => {
  test.each([
    'experiments/extraction-benchmark/schema/benchmark-schema.json',
    'experiments/anchor-spike/schema/mini-schema.json',
  ])('%s は見出しの衝突を回避して出力し、保存時は改名を求める', (schemaPath) => {
    const root = path.resolve(__dirname, '../../../../..');
    const schema = JSON.parse(readFileSync(path.resolve(root, schemaPath), 'utf8')) as FrozenSchema;
    const fields = schema.fields.map((field, i) => makeField({
      fieldId: field.field_id, fieldName: field.field_name, fieldIndex: i, entityLevel: field.entity_level,
    }));
    const study = makeStudy({ registrationId: 'NCT-key' });
    const result = buildTab1Csv([study], [makeStudyDataRow({
      values: { registration_id: 'NCT-reported' },
    })], [], [], fields);
    expect(new Set(result.header).size).toBe(result.header.length);
    expect(result.header).toContain('registration_id_field');
    expect(parseCsv(result.csv)[1]?.[result.header.indexOf('registration_id_field')]).toBe('NCT-reported');
    expect(parseCsv(result.csv)[1]?.[result.header.indexOf('registration_id')]).toBe('NCT-key');

    const ma = buildMaCsv([study], [], [], [], [], fields);
    expect(new Set(ma.header).size).toBe(ma.header.length);

    const registration = schema.fields.find((field) => field.field_id === 'f07_registration_id')!;
    const row: SchemaEditorRow = {
      maxQuotes: null, multiSelect: false, exclusiveValues: null, freeTextValues: null,
      fieldId: registration.field_id, section: 'methods', fieldName: registration.field_name,
      fieldLabel: '登録番号', entityLevel: registration.entity_level, dataType: registration.data_type,
      unit: null, allowedValues: null, required: true,
      extractionInstruction: registration.extraction_instruction,
      example: null, aiGenerated: false, note: null,
    };
    expect(validateEditorRows([row])).toEqual([{
      index: 0, column: 'fieldName', message:
        '"registration_id" は R セットの tab1.csv のキー列名のため、研究単位（study）の項目名に使えません。' +
        '別名（例: "registration_id_reported"）へ変更してください',
    }]);
    expect(validateEditorRows([row], { existingFields: fields })).toEqual([]);
  });
});
