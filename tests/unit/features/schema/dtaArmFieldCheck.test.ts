import { checkDtaArmFields, DTA_ARM_FIELD_REPLACEMENTS } from '../../../../src/features/schema/dtaArmFieldCheck';
import { QUADAS3_SECTION } from '../../../../src/features/schema/presets/robTemplates';
import type { SchemaEditorRow } from '../../../../src/features/schema/types';
import type { SchemaField } from '../../../../src/domain/schemaField';

function row(patch: Partial<SchemaEditorRow> = {}): SchemaEditorRow {
  return {
    fieldId: null,
    section: 'intervention',
    fieldName: 'arm_name',
    fieldLabel: '治療群名',
    entityLevel: 'outcome_result',
    dataType: 'text',
    unit: null,
    allowedValues: null,
    required: false,
    extractionInstruction: 'Extract the treatment arm.',
    example: null,
    aiGenerated: true,
    note: null,
    maxQuotes: null,
    multiSelect: false,
    exclusiveValues: null,
    freeTextValues: null,
    ...patch,
  };
}

const quadas = row({ section: QUADAS3_SECTION, fieldName: 'bias', entityLevel: 'rob_domain' });

test('確定済みの SchemaField をそのまま判定できる', () => {
  const target: SchemaField = {
    schemaVersion: 1,
    fieldId: 'arm-name',
    fieldIndex: 1,
    section: QUADAS3_SECTION,
    fieldName: 'arm_name',
    fieldLabel: '治療群名',
    entityLevel: 'outcome_result',
    dataType: 'text',
    unit: null,
    allowedValues: null,
    required: false,
    extractionInstruction: 'Extract the treatment arm.',
    example: null,
    aiGenerated: true,
    note: null,
    maxQuotes: null,
    multiSelect: null,
  };
  expect(checkDtaArmFields([target])).toEqual([{ index: 0, row: target, kind: 'name' }]);
});

test.each([
  quadas,
  row({ fieldName: 'quadas3_bias', entityLevel: 'rob_domain' }),
  ...['true_positive_count', 'false_positive', 'false_negative', 'true_negative', 'TP', 'n_FP', 'FN_count', 'n_TN_count']
    .map((fieldName) => row({ fieldName, fieldLabel: '' })),
  ...['真陽性', '偽陽性', '偽陰性', '真陰性'].map((fieldLabel) => row({ fieldName: 'count', fieldLabel })),
])('QUADAS-3 または 2×2 項目で DTA と判定する: %o', (marker) => {
  const target = row();
  expect(checkDtaArmFields([marker, target])).toContainEqual({ index: 1, row: target, kind: 'name' });
});

test('DTA の手がかりがない場合と、study の TP・部分一致だけの場合は対象なし', () => {
  expect(checkDtaArmFields([row()])).toEqual([]);
  expect(checkDtaArmFields([row({ fieldName: 'tp', fieldLabel: '', entityLevel: 'study' }), row()])).toEqual([]);
  expect(checkDtaArmFields([row({ fieldName: 'attempt', fieldLabel: '' }), row()])).toEqual([]);
  expect(checkDtaArmFields([])).toEqual([]);
});

test('名前型・人数型を振り分け、対象外の型・レベル・単語の部分一致は除く', () => {
  const targets = [
    row(),
    row({ fieldName: 'n_GROUP_size', fieldLabel: '', dataType: 'integer' }),
    row({ fieldName: 'name', fieldLabel: '群名' }),
    row({ fieldName: 'n', fieldLabel: '群別解析対象者数', dataType: 'integer' }),
    row({ dataType: 'float' }),
    row({ entityLevel: 'study' }),
    row({ fieldName: 'subgroup', fieldLabel: '' }),
    row({ entityLevel: 'arm' }),
  ];
  expect(checkDtaArmFields([quadas, ...targets]).map(({ index, kind }) => ({ index, kind }))).toEqual([
    { index: 1, kind: 'name' },
    { index: 2, kind: 'size' },
    { index: 3, kind: 'name' },
    { index: 4, kind: 'size' },
  ]);
});

test.each([
  { extractionInstruction: 'Extract the treatment group(s) whose participants contribute to this accuracy estimate, as reported (e.g., escitalopram, rTMS 10 Hz). If the estimate pools several arms, list each arm name separated by "; " (keep a combination arm such as "escitalopram + bupropion" as one name) and do not split the estimate by arm.' },
  DTA_ARM_FIELD_REPLACEMENTS.size,
])('指定指示文への書き換え後は再警告しない: %o', (replacement) => {
  expect(checkDtaArmFields([quadas, row({
    fieldLabel: 'この推定の対象治療群',
    extractionInstruction: replacement.extractionInstruction,
  })])).toEqual([]);
});
