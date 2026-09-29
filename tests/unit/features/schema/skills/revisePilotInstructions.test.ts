import type { SchemaField } from '../../../../../src/domain/schemaField';
import {
  REVISE_PILOT_INSTRUCTIONS_SKILL_NAME,
  REVISE_PILOT_INSTRUCTIONS_PROMPT_VERSION,
  REVISE_PILOT_INSTRUCTIONS_SYSTEM_PROMPT,
  REVISE_PILOT_INSTRUCTIONS_RESPONSE_SCHEMA,
  buildRevisePilotInstructionsUserPrompt,
  parseRevisePilotInstructionsResponse,
  RevisePilotInstructionsFormatError,
  toRevisionEditorRows,
} from '../../../../../src/features/schema/skills/revisePilotInstructions';

function makeField(overrides: Partial<SchemaField> = {}): SchemaField {
  return {
    schemaVersion: 1,
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

const revision = {
  field_name: 'study_design',
  extraction_instruction: ' 新しい指示 ',
  example: ' 架空例 ',
  rationale: ' 理由 ',
};

test('指示・例だけの一般化と正解漏れ防止、言語保持の制約を固定する', () => {
  expect(REVISE_PILOT_INSTRUCTIONS_SKILL_NAME).toBe('revise-pilot-instructions');
  expect(REVISE_PILOT_INSTRUCTIONS_PROMPT_VERSION).toBe(1);
  for (const phrase of [
    'Only revise extraction_instruction and example.',
    'Never add or remove fields, never change field_name, data type, allowed values, unit, entity level, section.',
    'Return only fields that should change; omit fields that are fine.',
    "Do NOT embed pilot-specific values, numbers, drug names, study names, quotations or other literal strings from the pilot papers or the reviewers' values into the instruction or the example.",
    "The example must be a generic, invented illustration, never a reviewer's value copied verbatim.",
    'Reviewer notes are hints about what went wrong; turn them into general guidance.',
    'Keep the existing language of each instruction (if the current instruction is Japanese, answer in Japanese).',
  ])
    expect(REVISE_PILOT_INSTRUCTIONS_SYSTEM_PROMPT).toContain(phrase);
  expect(REVISE_PILOT_INSTRUCTIONS_RESPONSE_SCHEMA).toMatchObject({
    type: 'object',
    required: ['revisions'],
  });
});

test('対象の項目定義・判定・承認数を含め、引用を300文字に制限する', () => {
  const item = {
    fieldId: 'f-1',
    fieldName: 'study_design',
    acceptCount: 2,
    entries: [
      {
        studyId: 's',
        entityKey: '-',
        action: 'edit' as const,
        aiValue: 'AI',
        humanValue: '人',
        quote: 'あ'.repeat(301),
        note: 'メモ',
      },
      {
        studyId: 's2',
        entityKey: '-',
        action: 'reject' as const,
        aiValue: null,
        humanValue: null,
        quote: null,
        note: null,
      },
    ],
  };
  const userPrompt = buildRevisePilotInstructionsUserPrompt({
    fields: [
      makeField(),
      makeField({ fieldId: 'protected', entityLevel: 'rob_domain' }),
      makeField({ fieldId: 'unused' }),
    ],
    feedback: {
      items: [item, { ...item, fieldId: 'unknown' }, { ...item, fieldId: 'protected' }],
      decisionCount: 2,
    },
  });
  expect(userPrompt).toContain('acceptCount counts cells accepted as-is');
  expect(userPrompt).toContain('pilot data to learn from, not to copy');
  const prompt = JSON.parse(userPrompt.split('\n\n')[1]!);
  expect(prompt).toHaveLength(1);
  expect(prompt[0]).toEqual({
    field_name: 'study_design',
    field_label: '研究デザイン',
    entity_level: 'study',
    data_type: 'text',
    unit: null,
    allowed_values: null,
    extraction_instruction: 'Report the design.',
    example: null,
    acceptCount: 2,
    entries: [{ ...item.entries[0], quote: 'あ'.repeat(300) }, item.entries[1]],
  });
});

test('フェンス・空白を許容し、未知・保護・重複・無変更を数えて除外する', () => {
  const fields = [
    makeField(),
    makeField({ fieldName: 'same', extractionInstruction: ' 同じ ', example: ' 例 ' }),
    makeField({ fieldName: 'rob', entityLevel: 'rob_domain' }),
    makeField({ fieldName: 'risk', section: ' risk_of_bias_extra' }),
  ];
  const result = parseRevisePilotInstructionsResponse(
    '```json\n' +
      JSON.stringify({
        revisions: [
          revision,
          { ...revision, extraction_instruction: '重複' },
          { ...revision, field_name: 'unknown' },
          { ...revision, field_name: 'rob' },
          { ...revision, field_name: 'risk' },
          { ...revision, field_name: 'same', extraction_instruction: '同じ', example: '例' },
        ],
      }) +
      '\n```',
    fields,
  );
  expect(result).toEqual({
    revisions: [
      {
        fieldName: 'study_design',
        extractionInstruction: '新しい指示',
        example: '架空例',
        rationale: '理由',
      },
    ],
    droppedCount: 5,
  });
  const rows = toRevisionEditorRows(fields, result.revisions);
  expect(rows).toEqual([
    {
      fieldId: 'f-1',
      section: 'methods',
      fieldName: 'study_design',
      fieldLabel: '研究デザイン',
      entityLevel: 'study',
      dataType: 'text',
      unit: null,
      allowedValues: null,
      required: true,
      extractionInstruction: '新しい指示',
      example: '架空例',
      aiGenerated: true,
      note: null,
    },
  ]);
  expect(
    toRevisionEditorRows(
      fields,
      ['unknown', 'rob'].map((fieldName) => ({ ...result.revisions[0]!, fieldName })),
    ),
  ).toEqual([]);
});

test('空の例を null にし、無変更が先着でも後続の重複を採用しない', () => {
  const parse = (items: unknown[]) =>
    parseRevisePilotInstructionsResponse(JSON.stringify({ revisions: items }), [
      makeField({ aiGenerated: false }),
    ]);
  expect(parse([{ ...revision, example: ' ' }]).revisions[0]?.example).toBeNull();
  expect(parse([{ ...revision, example: null }]).revisions[0]?.example).toBeNull();
  expect(
    parse([{ ...revision, extraction_instruction: 'Report the design.', example: null }, revision]),
  ).toEqual({ revisions: [], droppedCount: 2 });
  expect(parse([])).toEqual({ revisions: [], droppedCount: 0 });
  expect(
    toRevisionEditorRows([makeField({ aiGenerated: false })], parse([revision]).revisions)[0]
      ?.aiGenerated,
  ).toBe(false);
});

test.each([
  'broken',
  '{}',
  '{"revisions":[{}]}',
  JSON.stringify({ revisions: [{ ...revision, extraction_instruction: ' ' }] }),
])('不正な応答を専用エラーにする: %s', (text) => {
  expect(() => parseRevisePilotInstructionsResponse(text, [makeField()])).toThrow(
    RevisePilotInstructionsFormatError,
  );
});

test('必須属性を検証しながらモデルの余分なキーは許容する', () => {
  const parsed = parseRevisePilotInstructionsResponse(
    JSON.stringify({
      extra: true,
      revisions: [{ ...revision, extra: '許容' }],
    }),
    [makeField()],
  );
  expect(parsed.revisions).toHaveLength(1);
});
