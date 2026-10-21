// プロンプトの文面と版数の組を固定するテスト（issue #381・RAISE 3）。
//
// なぜ: LLMApiLog と Drive の prompt payload には各 skill の版数（*_PROMPT_VERSION）を残し、
// 「どの文面で作った値か」を後から追えるようにしている。ところが文面を変えても版数を上げ忘れると、
// 違う文面で作った値が同じ版数として記録され、監査とベンチマークの比較が成り立たなくなる。
// RAISE 3 の「プロンプトの文面を変えたら版を上げる」を機械的に守るため、各 skill の
// システムプロンプト・応答スキーマ・固定の入力から組み立てたユーザープロンプトのハッシュを
// 版数と組にして固定する。文面を 1 文字でも変えるとハッシュが変わってこのテストが落ちる。
//
// 落ちたときの手順（docs/architecture.md §2.1 の「プロンプトの版数」）:
// 1. 文面の変更が意図どおりなら、その skill の *_PROMPT_VERSION を 1 上げる
// 2. 下の EXPECTED の version とハッシュを新しい値へ更新する（失敗メッセージに新しいハッシュが出る）
// 文面を変えていないのにハッシュだけ変わった（固定入力の組み立て関数の挙動が変わった）場合も、
// 実際に LLM へ送る文面が変わっているので同じく版数を上げる
import type { SchemaField } from '../../../src/domain/schemaField';
import {
  buildExtractDataSystemPrompt,
  buildExtractDataUserContent,
  buildExtractDataUserPrompt,
  extractDataResponseSchema,
  EXTRACT_DATA_PROMPT_VERSION,
} from '../../../src/features/extraction/skills/extractData';
import {
  buildRelocateQuoteUserPrompt,
  RELOCATE_QUOTE_PROMPT_VERSION,
  RELOCATE_QUOTE_RESPONSE_SCHEMA,
  RELOCATE_QUOTE_SYSTEM_PROMPT,
} from '../../../src/features/extraction/skills/relocateQuote';
import {
  buildDraftSchemaUserPrompt,
  DRAFT_SCHEMA_PROMPT_VERSION,
  DRAFT_SCHEMA_RESPONSE_SCHEMA,
  DRAFT_SCHEMA_SYSTEM_PROMPT,
} from '../../../src/features/schema/skills/draftSchema';
import {
  ASK_PAPER_PROMPT_VERSION,
  ASK_PAPER_RESPONSE_SCHEMA,
  buildAskPaperDocumentPrefix,
  buildAskPaperMessages,
} from '../../../src/features/verification/skills/askPaper';
import { md5Hex } from '../../../src/utils/md5';

/** UTF-8 にした JSON の MD5（改ざん検知ではなく変更検知だけが目的なので MD5 で足りる） */
function fingerprint(value: unknown): string {
  // jsdom には TextEncoder が無いため Node の Buffer で UTF-8 にする
  const bytes = Buffer.from(JSON.stringify(value), 'utf8');
  return md5Hex(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
}

function makeField(
  overrides: Pick<SchemaField, 'fieldId' | 'fieldName' | 'entityLevel' | 'dataType'> &
    Partial<SchemaField>,
): SchemaField {
  return {
    maxQuotes: null,
    multiSelect: null,
    schemaVersion: 1,
    fieldIndex: 0,
    section: 'methods',
    fieldLabel: overrides.fieldName,
    unit: null,
    allowedValues: null,
    required: true,
    extractionInstruction: '',
    example: null,
    aiGenerated: true,
    note: null,
    ...overrides,
  };
}

// 条件付きの文面（entity_key 規約の出し分け・arm completeness・単位・許容値・複数引用など）が
// すべてプロンプトへ出るよう、4 つの entity_level と主な任意属性を 1 つずつ含める
const FIELDS: readonly SchemaField[] = [
  makeField({
    fieldId: 'f_design',
    fieldName: 'study_design',
    entityLevel: 'study',
    dataType: 'enum',
    allowedValues: 'RCT|cohort|other',
    multiSelect: { exclusiveValues: ['RCT'], freeTextValues: ['other'] },
    extractionInstruction: 'Report the design.',
    example: 'RCT',
  }),
  makeField({
    fieldId: 'f_setting',
    fieldName: 'setting',
    entityLevel: 'study',
    dataType: 'text',
    maxQuotes: 3,
    note: 'Country and care level.',
  }),
  makeField({
    fieldId: 'f_arm_n',
    fieldName: 'sample_size_arm',
    entityLevel: 'arm',
    dataType: 'integer',
    unit: 'participants',
  }),
  makeField({
    fieldId: 'f_mortality',
    fieldName: 'mortality_events',
    entityLevel: 'outcome_result',
    dataType: 'integer',
    section: 'results',
  }),
  makeField({
    fieldId: 'f_rob',
    fieldName: 'rob_judgement',
    entityLevel: 'rob_domain',
    dataType: 'enum',
    allowedValues: 'low|some_concerns|high',
    required: false,
  }),
];

const PAGES = [
  { page: 1, text: 'Methods. Participants were randomised.' },
  { page: 2, text: 'Results. Ten deaths occurred.' },
];

function extractDataFingerprint(): string {
  const textInput = {
    fields: FIELDS,
    documents: [
      { role: 'article' as const, filename: 'main.pdf', mode: 'text' as const, pages: PAGES },
      { role: 'registration' as const, filename: 'reg.pdf', mode: 'text' as const, pages: PAGES },
    ],
    protocolContext: 'RQ: does X reduce mortality?',
  };
  const imageInput = {
    fields: FIELDS,
    documents: [
      {
        role: 'article' as const,
        filename: 'scan.pdf',
        mode: 'image' as const,
        imagePages: [{ page: 1, mimeType: 'image/png', dataBase64: 'AAAA' }],
      },
    ],
    protocolContext: null,
    requestBox: true,
  };
  return fingerprint({
    systemText: buildExtractDataSystemPrompt(false),
    systemBox: buildExtractDataSystemPrompt(true),
    schemaText: extractDataResponseSchema(false),
    schemaBox: extractDataResponseSchema(true),
    userText: buildExtractDataUserPrompt(textInput),
    userImage: buildExtractDataUserContent(imageInput),
  });
}

function draftSchemaFingerprint(): string {
  return fingerprint({
    system: DRAFT_SCHEMA_SYSTEM_PROMPT,
    schema: DRAFT_SCHEMA_RESPONSE_SCHEMA,
    user: buildDraftSchemaUserPrompt({
      protocolText: 'PICO: adults; X vs placebo; mortality.',
      samples: [
        { label: 'Smith 2020', pages: PAGES },
        { label: 'Jones 2021', pages: PAGES },
      ],
    }),
  });
}

function relocateQuoteFingerprint(): string {
  return fingerprint({
    system: RELOCATE_QUOTE_SYSTEM_PROMPT,
    schema: RELOCATE_QUOTE_RESPONSE_SCHEMA,
    userWithHints: buildRelocateQuoteUserPrompt({
      field: FIELDS[3]!,
      value: '10',
      originalQuote: 'Ten deaths',
      originalPage: 2,
      pages: PAGES,
    }),
    userWithoutHints: buildRelocateQuoteUserPrompt({
      field: FIELDS[0]!,
      value: null,
      originalQuote: null,
      originalPage: null,
      pages: PAGES,
    }),
  });
}

function askPaperFingerprint(): string {
  const prefix = buildAskPaperDocumentPrefix({
    documents: [
      { role: 'article', filename: 'main.pdf', pages: PAGES },
      { role: 'registration', filename: 'reg.pdf', pages: [] },
    ],
    fields: FIELDS,
  });
  return fingerprint({
    schema: ASK_PAPER_RESPONSE_SCHEMA,
    messages: buildAskPaperMessages({
      prefix,
      history: [{ question: 'How many arms?', answer: 'Two.' }],
      question: 'How many deaths?',
    }),
  });
}

// 版数を上げたら、その skill の version と hash を新しい値へ更新する
const EXPECTED = {
  'extract-data（EXTRACT_DATA_PROMPT_VERSION）': {
    version: 12,
    hash: 'aa3e470e39d31dd02e625b47ca59e957',
    actual: () => ({ version: EXTRACT_DATA_PROMPT_VERSION, hash: extractDataFingerprint() }),
  },
  'draft-schema（DRAFT_SCHEMA_PROMPT_VERSION）': {
    version: 3,
    hash: 'feb314f86cdda5591c6cc2a70abbed47',
    actual: () => ({ version: DRAFT_SCHEMA_PROMPT_VERSION, hash: draftSchemaFingerprint() }),
  },
  'relocate-quote（RELOCATE_QUOTE_PROMPT_VERSION）': {
    version: 2,
    hash: '1cbb08a8933d9d5a8940ee97cbe3d13a',
    actual: () => ({ version: RELOCATE_QUOTE_PROMPT_VERSION, hash: relocateQuoteFingerprint() }),
  },
  'ask-paper（ASK_PAPER_PROMPT_VERSION）': {
    version: 1,
    hash: 'ff8b777fa392abdb54101c2f46206a22',
    actual: () => ({ version: ASK_PAPER_PROMPT_VERSION, hash: askPaperFingerprint() }),
  },
};

describe('プロンプトの文面と版数の組（RAISE 3: 文面を変えたら版を上げる）', () => {
  test.each(Object.entries(EXPECTED))('%s', (name, expected) => {
    const actual = expected.actual();
    if (actual.version !== expected.version || actual.hash !== expected.hash) {
      throw new Error(
        `${name} のプロンプト（システムプロンプト・応答スキーマ・ユーザープロンプト）か版数が、` +
          `固定した組（版 ${expected.version} / ${expected.hash}）と一致しません` +
          `（現在: 版 ${actual.version} / ${actual.hash}）。` +
          '文面を変えたなら版を上げて、このテストの version とハッシュを更新してください' +
          '（手順は docs/architecture.md §2.1 の「プロンプトの版数」）。',
      );
    }
  });
});
