import {
  ASK_PAPER_PROMPT_VERSION,
  ASK_PAPER_SKILL_NAME,
  ASK_PAPER_SYSTEM_PROMPT,
  ASK_PAPER_RESPONSE_SCHEMA,
  AskPaperFormatError,
  buildAskPaperDocumentPrefix,
  buildAskPaperMessages,
  parseAskPaperResponse,
} from '../../../../../src/features/verification/skills/askPaper';
import type { SchemaField } from '../../../../../src/domain/schemaField';

const field: SchemaField = {
  schemaVersion: 1,
  fieldId: 'f1',
  fieldIndex: 1,
  section: 'methods',
  fieldName: 'sample_size',
  fieldLabel: '人数',
  entityLevel: 'study',
  dataType: 'integer',
  unit: '人',
  allowedValues: null,
  required: true,
  extractionInstruction: '人数を報告',
  example: 'DATA_ROW_SECRET',
  aiGenerated: true,
  note: 'DECISION_SECRET',
  maxQuotes: null,
};

test('本文と定義だけを入力契約に持ち、監査属性やデータ行を含めない', () => {
  const prefix = buildAskPaperDocumentPrefix({
    documents: [
      {
        role: 'primary',
        filename: '論文.pdf',
        pages: [
          { page: 2, text: '対象者120人' },
          { page: 3, text: '結果' },
        ],
      },
      { role: 'supplement', filename: '補足.pdf', pages: [] },
    ],
    fields: [field],
    // @ts-expect-error 根拠や判定を受け取るパラメータは設けない
    evidence: 'EVIDENCE_SECRET',
  });
  expect(prefix).toContain(
    '[DOCUMENT 1] primary / 論文.pdf\n\n[PAGE 2]\n対象者120人\n\n[PAGE 3]\n結果',
  );
  expect(prefix).toContain('[DOCUMENT 2] supplement / 補足.pdf\n\n(no text layer available)');
  expect(JSON.parse(prefix.split('## Schema definitions\n\n')[1] as string)).toEqual([
    {
      field_name: 'sample_size',
      label: '人数',
      entity_level: 'study',
      data_type: 'integer',
      unit: '人',
      allowed_values: null,
      extraction_instruction: '人数を報告',
    },
  ]);
  for (const excluded of [
    'EVIDENCE_SECRET',
    'DECISION_SECRET',
    'DATA_ROW_SECRET',
    'ai_generated',
    'aiGenerated',
    'note',
  ]) {
    expect(prefix).not.toContain(excluded);
  }
});

test('固定文脈を先頭に置き、履歴は最後の5往復に制限する', () => {
  const history = Array.from({ length: 7 }, (_, i) => ({ question: `問${i}`, answer: `答${i}` }));
  const messages = buildAskPaperMessages({ prefix: '固定本文', history, question: '次の質問' });
  expect(messages).toEqual([
    { role: 'system', content: ASK_PAPER_SYSTEM_PROMPT },
    { role: 'user', content: '固定本文' },
    ...history.slice(2).flatMap((turn) => [
      { role: 'user', content: turn.question },
      { role: 'model', content: turn.answer },
    ]),
    { role: 'user', content: '次の質問' },
  ]);
  expect(buildAskPaperMessages({ prefix: '固定本文', history: [], question: '初回' })).toHaveLength(
    3,
  );
  expect(ASK_PAPER_SKILL_NAME).toBe('ask-paper');
  expect(ASK_PAPER_PROMPT_VERSION).toBe(1);
  expect(ASK_PAPER_RESPONSE_SCHEMA.required).toEqual(['answer', 'citations', 'found']);
  expect(ASK_PAPER_SYSTEM_PROMPT).toContain('NEVER translate');
});

test('余分なキーを許容し、不正な引用だけを除外して原文を保持する', () => {
  const long = '文'.repeat(301);
  const parsed = parseAskPaperResponse(
    '```json\n' +
      JSON.stringify({
        answer: '回答',
        found: true,
        extra: '許容',
        citations: [
          { document_index: 1, quote: long, page: 2, extra: '許容' },
          { document_index: 2, quote: '有効', page: -1 },
          { document_index: 2, quote: 'ページ不明', page: null },
          { document_index: 2, quote: 'ページ省略' },
          ...[0, -1, 1.5, 3, '1'].map((document_index) => ({
            document_index,
            quote: '無効',
            page: 1,
          })),
          { document_index: 1, quote: '  ', page: 1 },
          null,
        ],
      }) +
      '\n```',
    2,
  );
  expect(parsed).toEqual({
    answer: '回答',
    found: true,
    citations: [
      { document_index: 1, quote: long, page: 2 },
      { document_index: 2, quote: '有効', page: null },
      { document_index: 2, quote: 'ページ不明', page: null },
      { document_index: 2, quote: 'ページ省略', page: null },
      ...[0, -1, 3].map((document_index) => ({ document_index, quote: '無効', page: 1 })),
    ],
  });
});

test('未発見では残された引用を無視する', () => {
  expect(
    parseAskPaperResponse(
      JSON.stringify({
        answer: '記載なし',
        found: false,
        citations: [{ document_index: 1, quote: '残骸', page: 1 }],
      }),
      1,
    ),
  ).toEqual({ answer: '記載なし', found: false, citations: [] });
});

test.each(['不正なJSON', '{}', '{"answer":1,"found":true,"citations":[]}'])(
  '不正形式は専用エラーにする: %s',
  (text) => {
    expect(() => parseAskPaperResponse(text, 1)).toThrow(AskPaperFormatError);
  },
);
