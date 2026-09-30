import {
  classifyDiscrepancy,
  filterLeakingRevisions,
  maskPilotNote,
  selectRevisionFeedback,
  valueShape,
} from '../../../../src/features/schema/pilotRevisionSafety';
import { buildRevisePilotInstructionsUserPrompt } from '../../../../src/features/schema/skills/revisePilotInstructions';
import type { SchemaField } from '../../../../src/domain/schemaField';
import type { PilotFeedbackField } from '../../../../src/features/schema/pilotFeedback';

const field: SchemaField = {
  schemaVersion: 1,
  fieldId: 'f',
  fieldIndex: 1,
  section: 'methods',
  fieldName: 'design',
  fieldLabel: '設計',
  entityLevel: 'study',
  dataType: 'text',
  unit: null,
  allowedValues: null,
  required: true,
  extractionInstruction: 'Keep rules.',
  example: null,
  aiGenerated: false,
  note: null,
};
const entry: PilotFeedbackField['entries'][number] = {
  studyId: 'private-study',
  entityKey: 'outcome:secret',
  action: 'edit',
  aiValue: 'Sleep hygiene',
  humanValue: 'BBTI',
  quote: 'private quotation',
  note: null,
};
const item = {
  fieldId: 'f',
  fieldName: 'design',
  acceptCount: 0,
  entries: [entry, { ...entry, studyId: 'private-second' }],
};
const feedback = { items: [item], decisionCount: 2 };
const revision = {
  fieldName: 'design',
  extractionInstruction: 'Keep rules. Clarify.',
  example: null,
  rationale: '理由',
};

test.each([
  [null, 'empty'],
  ['', 'empty'],
  ['  ', 'empty'],
  ['+12', 'integer'],
  ['-.25', 'decimal(2)'],
  ['42.70', 'decimal(2)'],
  ['12 patients', 'number_with_text'],
  ['two words', 'text(2)'],
  ['日本語', 'text(1)'],
])('形 %s', (value, expected) => expect(valueShape(value)).toBe(expected));
test.each([
  [null, 'yes', 'ai_empty'],
  [null, null, 'formatting_only'],
  ['', '', 'formatting_only'],
  [' A B ', 'ab', 'formatting_only'],
  ['42.70', '42.7', 'formatting_only'],
  ['1', '100', 'numeric_scale'],
  ['10', '.1', 'numeric_scale'],
  ['-1', '-10', 'numeric_scale'],
  ['-1', '10', 'numeric_different'],
  ['0', '10', 'numeric_different'],
  ['10', '0', 'numeric_different'],
  ['2', '3', 'numeric_different'],
  ['2', 'two', 'number_vs_text'],
  ['two', '2', 'number_vs_text'],
  ['abc def', 'abc', 'ai_longer'],
  ['abc', 'abc def', 'ai_shorter'],
  ['abc', '', 'ai_longer'],
  ['cat', 'dog', 'text_different'],
  ['1,000', '1000', 'number_vs_text'],
])('相違 %s → %s', (a, h, expected) => expect(classifyDiscrepancy(a, h)).toBe(expected));
test('メモの全文・語・数字・引用の伏せ字と長さ制限', () => {
  expect(maskPilotNote(entry)).toBeNull();
  expect(
    maskPilotNote({
      ...entry,
      note: 'SLEEP HYGIENE and bbti; hygiene; 42.70; 9; "country"; \'arm\'; 「国名」; 『群名』',
    }),
  ).toBe('<value> and <value>; <value>; <num>; <num>; <text>; <text>; <text>; <text>');
  expect(maskPilotNote({ ...entry, aiValue: 'a+b', humanValue: '', note: 'a+b 7.3' })).toBe(
    '<value> <num>',
  );
  expect(maskPilotNote({ ...entry, aiValue: null, humanValue: null, note: '9 "abc"' })).toBe(
    '<num> <text>',
  );
  expect(maskPilotNote({ ...entry, note: 'あ'.repeat(301) })).toHaveLength(300);
});
test('生の値・識別子・引用を送らず、同じ study の仮名を維持する', () => {
  const prompt = buildRevisePilotInstructionsUserPrompt({
    fields: [field],
    feedback: {
      ...feedback,
      items: [{ ...item, entries: [...item.entries, { ...entry, action: 'not_reported' }] }],
    },
    rationaleLanguage: 'English',
  });
  for (const value of [
    'Sleep hygiene',
    'BBTI',
    'private-study',
    'private-second',
    'outcome:secret',
    'private quotation',
    'aiValue',
    'humanValue',
    'quote',
    'studyId',
    'entityKey',
  ])
    expect(prompt).not.toContain(value);
  const data = JSON.parse(prompt.split('\n\n')[1]!);
  expect(data[0].entries.map((e: { study: string }) => e.study)).toEqual(['S1', 'S2', 'S1']);
  expect(prompt).toContain('Write the rationale in English');
});
test('非承認の study を重複除去し、対象外と件数を返す', () => {
  const result = selectRevisionFeedback(
    {
      items: [
        item,
        { ...item, fieldId: 'missing' },
        { ...item, fieldId: 'rob' },
        { ...item, fieldId: 'single', entries: [entry, entry] },
        { ...item, fieldId: 'accepted', entries: [{ ...entry, action: 'accept' }] },
      ],
      decisionCount: 10,
    },
    [
      field,
      { ...field, fieldId: 'rob', entityLevel: 'rob_domain' },
      { ...field, fieldId: 'single' },
      { ...field, fieldId: 'accepted' },
    ],
  );
  expect(result).toEqual({ feedback, excludedSingleStudyCount: 1 });
});
test('文字列は全項目、数値は同じ項目だけ照合し、既存定義は許容する', () => {
  const run = (instruction: string, example: string | null = null, fields = [field]) =>
    filterLeakingRevisions([{ ...revision, extractionInstruction: instruction, example }], fields, {
      items: [
        item,
        {
          ...item,
          fieldId: 'other',
          entries: [{ ...entry, aiValue: '42.70', humanValue: null, note: '"Country X" and 88' }],
        },
      ],
      decisionCount: 3,
    });
  expect(run('Use BBTI').droppedFieldNames).toEqual(['design']);
  expect(run('Use country x').droppedFieldNames).toEqual(['design']);
  expect(run('Use generic', 'sleep HYGIENE').revisions).toEqual([]);
  expect(run('Use 88').revisions).toHaveLength(1);
  expect(run('Use BBTI', null, [{ ...field, allowedValues: 'BBTI|other' }]).revisions).toHaveLength(
    1,
  );
  expect(run('Use 42.7').revisions).toHaveLength(1);
  expect(run('safe', null, []).revisions).toEqual([]);
  const numericFeedback = {
    items: [
      { ...item, entries: [{ ...entry, aiValue: '42.70', humanValue: null, note: '8 and ""' }] },
    ],
    decisionCount: 1,
  };
  expect(
    filterLeakingRevisions([{ ...revision, example: '42.7' }], [field], numericFeedback)
      .droppedFieldNames,
  ).toEqual(['design']);
  expect(
    filterLeakingRevisions([{ ...revision, example: '8' }], [field], numericFeedback)
      .droppedFieldNames,
  ).toEqual(['design']);
  expect(
    filterLeakingRevisions(
      [{ ...revision, example: '8' }],
      [{ ...field, unit: '8', example: 'example' }],
      numericFeedback,
    ).revisions,
  ).toHaveLength(1);
  expect(
    filterLeakingRevisions([revision], [field], {
      items: [{ ...item, entries: [{ ...entry, aiValue: null, humanValue: null, note: null }] }],
      decisionCount: 1,
    }).revisions,
  ).toHaveLength(1);
});
test('語の途中への一致は漏れとしない・数値は符号を捨てて照合する', () => {
  const feedbackOf = (aiValue: string) => ({
    items: [{ ...item, entries: [{ ...entry, aiValue, humanValue: null, note: null }] }],
    decisionCount: 1,
  });
  const drop = (instruction: string, aiValue: string) =>
    filterLeakingRevisions(
      [{ ...revision, extractionInstruction: instruction, example: null }],
      [field],
      feedbackOf(aiValue),
    ).droppedFieldNames;
  expect(drop('Use the written protocol', 'ITT')).toEqual([]);
  expect(drop('Prefer the ITT population', 'ITT')).toEqual(['design']);
  expect(drop('Ages 18-65 only', '65')).toEqual(['design']);
  expect(drop('Report (a)', '(a)')).toEqual(['design']);
});
test('スキーマ内のどれかの項目の定義にある語・数値は漏れとしない', () => {
  const feedbackOf = {
    items: [{ ...item, entries: [{ ...entry, aiValue: 'ISI', humanValue: '12', note: null }] }],
    decisionCount: 1,
  };
  const other = {
    ...field,
    fieldId: 'other',
    fieldName: 'scale',
    extractionInstruction: 'ISI > SCI',
    unit: '12',
  };
  const run = (instruction: string, schema = [field, other]) =>
    filterLeakingRevisions(
      [{ ...revision, extractionInstruction: instruction, example: null }],
      [field],
      feedbackOf,
      schema,
    ).droppedFieldNames;
  expect(run('Use ISI and 12')).toEqual([]);
  expect(run('Use ISI', [field])).toEqual(['design']);
  expect(run('Use 12', [field])).toEqual(['design']);
});
