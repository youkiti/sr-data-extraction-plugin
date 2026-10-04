import {
  buildEnrichFieldUserPrompt, parseEnrichFieldResponse, EnrichFieldFormatError,
  ENRICH_FIELD_PROMPT_VERSION, ENRICH_FIELD_SKILL_NAME, ENRICH_FIELD_SYSTEM_PROMPT,
  type EnrichFieldInput,
} from '../../../../../src/features/schema/skills/enrichField';

const FIELD: EnrichFieldInput = {
  fieldId: 'n', fieldName: 'analyzed_n', fieldLabel: '解析人数', entityLevel: 'arm',
  dataType: 'integer', unit: '人', allowedValues: null,
  extractionInstruction: '解析対象者数を返す', example: null,
};
const FIELDS = [FIELD, { ...FIELD, fieldId: 'other' }];
const item = (overrides: Record<string, unknown> = {}) => ({
  field_id: 'n', location_hint: 'CONSORT 図', rules: 'enrolled N ではなく analyzed N', ...overrides,
});
const response = (items: unknown[]) => JSON.stringify({ fields: items });

test('版数と識別子・制約をプロンプトに含める', () => {
  expect(ENRICH_FIELD_PROMPT_VERSION).toBe(1);
  expect(ENRICH_FIELD_SKILL_NAME).toBe('enrich-field');
  for (const instruction of [
    'Do not change or paraphrase', 'Do not repeat the same generic caution',
    'Do not create or change examples', 'numbers, arm names or author names',
    'meaning or format of classification codes', 'never page numbers',
    'Japanese for Japanese', 'English for English', 'Return null', '500 characters',
  ]) expect(ENRICH_FIELD_SYSTEM_PROMPT).toContain(instruction);
});

test.each(['', '介入レビューの要約'])('複数項目と要約 %p を元の値のまま渡す', (protocolSummary) => {
  const prompt = buildEnrichFieldUserPrompt({ fields: FIELDS, protocolSummary });
  expect(prompt).toContain(`## Protocol summary\n${protocolSummary}\n`);
  expect(JSON.parse(prompt.split('## Fields\n')[1] as string)).toEqual(FIELDS.map((field) => ({
    field_id: field.fieldId, field_name: field.fieldName, field_label: field.fieldLabel,
    entity_level: field.entityLevel, data_type: field.dataType, unit: field.unit,
    allowed_values: field.allowedValues, instruction: field.extractionInstruction, example: field.example,
  })));
});

test.each([
  ['{', 'invalid_json'], ['null', 'invalid_fields'], ['{}', 'invalid_fields'],
  ['{"fields":{}}', 'invalid_fields'],
  [response([item({ field_id: 'unknown' })]), 'unknown_field_id'],
  [response([item(), item()]), 'duplicate_field_id'],
  ...[3, true, {}, [], undefined].flatMap((value) => [
    [response([item({ location_hint: value })]), 'invalid_value'],
    [response([item({ rules: value })]), 'invalid_value'],
  ]),
  [response([null]), 'invalid_value'], [response([item({ field_id: 1 })]), 'invalid_value'],
])('不正出力を理由別に区別する %p', (text, reason) => {
  expect(() => parseEnrichFieldResponse(text as string, FIELDS)).toThrow(EnrichFieldFormatError);
  try {
    parseEnrichFieldResponse(text as string, FIELDS);
  } catch (error) {
    expect(error).toMatchObject({ name: 'EnrichFieldFormatError', reason });
  }
});

test('入力順で返し、出力にない項目は提案なし', () => {
  expect(parseEnrichFieldResponse(response([item()]), FIELDS)).toEqual({
    fields: [
      { fieldId: 'n', locationHint: 'CONSORT 図', rules: 'enrolled N ではなく analyzed N' },
      { fieldId: 'other', locationHint: null, rules: null },
    ], rejected: [],
  });
  expect(parseEnrichFieldResponse(response([]), []).fields).toEqual([]);
});

test.each([null, '', ' \n\t '])('空の値 %p を null にする', (value) => {
  expect(parseEnrichFieldResponse(response([item({ location_hint: value, rules: value })]), [FIELD]).fields)
    .toEqual([{ fieldId: 'n', locationHint: null, rules: null }]);
});

test('前後の空白を除去する', () => {
  expect(parseEnrichFieldResponse(response([item({ location_hint: ' Methods ', rules: ' N ' })]), [FIELD]).fields)
    .toEqual([{ fieldId: 'n', locationHint: 'Methods', rules: 'N' }]);
});

test('500 文字は受け入れる', () => {
  const value = 'あ'.repeat(500);
  expect(parseEnrichFieldResponse(response([item({ location_hint: value, rules: value })]), [FIELD]))
    .toEqual({ fields: [{ fieldId: 'n', locationHint: value, rules: value }], rejected: [] });
});

test.each([
  { location_hint: 'あ'.repeat(501) }, { rules: 'あ'.repeat(501) },
  { location_hint: null, rules: 'あ'.repeat(501) },
])('長すぎる値は項目全体を破棄し理由を返す', (values) => {
  const result = parseEnrichFieldResponse(response([item(values), item({ field_id: 'other' })]), FIELDS);
  expect(result.fields[0]).toEqual({ fieldId: 'n', locationHint: null, rules: null });
  expect(result.fields[1]?.locationHint).toBe('CONSORT 図');
  expect(result.rejected).toEqual([{ fieldId: 'n', reason: 'too_long', detail: expect.stringContaining('500') }]);
});

test('破棄した項目の重複も拒否する', () => {
  expect(() => parseEnrichFieldResponse(response([item({ rules: 'x'.repeat(501) }), item()]), FIELDS))
    .toThrow(expect.objectContaining({ reason: 'duplicate_field_id' }));
});
