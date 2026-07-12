import type { SchemaField } from '../../../../../src/domain/schemaField';
import {
  buildRelocateQuoteUserPrompt,
  parseRelocateQuoteResponse,
  RELOCATE_QUOTE_PAGE_WINDOW,
  RELOCATE_QUOTE_PROMPT_VERSION,
  RELOCATE_QUOTE_RESPONSE_SCHEMA,
  RELOCATE_QUOTE_SYSTEM_PROMPT,
  selectRelocateQuoteWindow,
} from '../../../../../src/features/extraction/skills/relocateQuote';
import type { ExtractDataPage } from '../../../../../src/features/extraction/skills/extractData';

function makeField(overrides: Partial<SchemaField> = {}): SchemaField {
  return {
    schemaVersion: 1,
    fieldId: 'f-1',
    fieldIndex: 1,
    section: 'population',
    fieldName: 'sample_size_total',
    fieldLabel: '総サンプルサイズ',
    entityLevel: 'study',
    dataType: 'integer',
    unit: null,
    allowedValues: null,
    required: true,
    extractionInstruction: 'Report the total number of randomised participants.',
    example: null,
    aiGenerated: false,
    note: null,
    ...overrides,
  };
}

function pages(count: number): ExtractDataPage[] {
  return Array.from({ length: count }, (_, i) => ({ page: i + 1, text: `page ${i + 1} text` }));
}

describe('selectRelocateQuoteWindow', () => {
  test('aiPage が null なら全ページを返す', () => {
    const all = pages(5);
    expect(selectRelocateQuoteWindow(all, null)).toEqual(all);
  });

  test('aiPage ± RELOCATE_QUOTE_PAGE_WINDOW に絞る', () => {
    const all = pages(30);
    const windowed = selectRelocateQuoteWindow(all, 15);
    expect(windowed.map((p) => p.page)).toEqual(
      Array.from(
        { length: RELOCATE_QUOTE_PAGE_WINDOW * 2 + 1 },
        (_, i) => 15 - RELOCATE_QUOTE_PAGE_WINDOW + i,
      ),
    );
  });

  test('窓の中にページが 1 件も無ければ全ページへフォールバックする', () => {
    const all = pages(3); // 全ページが 1..3 で、aiPage=100 の窓には掛からない
    expect(selectRelocateQuoteWindow(all, 100)).toEqual(all);
  });
});

describe('buildRelocateQuoteUserPrompt', () => {
  test('Field / Reported value / Document text / Output format のセクションを組み立てる', () => {
    const prompt = buildRelocateQuoteUserPrompt({
      field: makeField(),
      value: '120',
      originalQuote: 'a total of 120 patients',
      originalPage: 3,
      pages: pages(2),
    });
    expect(prompt).toContain('## Field');
    expect(prompt).toContain('field_name: sample_size_total');
    expect(prompt).toContain('instruction: Report the total number of randomised participants.');
    expect(prompt).toContain('## Reported value');
    expect(prompt).toContain('value: 120');
    expect(prompt).toContain('previously attempted quote (could not be located verbatim in the document): "a total of 120 patients"');
    expect(prompt).toContain('original page hint: 3');
    expect(prompt).toContain('## Document text');
    expect(prompt).toContain('[PAGE 1]\npage 1 text');
    expect(prompt).toContain('## Output format');
  });

  test('unit / originalQuote / originalPage が無ければ該当行を出さない', () => {
    const prompt = buildRelocateQuoteUserPrompt({
      field: makeField({ unit: null, extractionInstruction: '' }),
      value: null,
      originalQuote: null,
      originalPage: null,
      pages: pages(1),
    });
    expect(prompt).toContain('value: (null)');
    expect(prompt).not.toContain('previously attempted quote');
    expect(prompt).not.toContain('original page hint');
    expect(prompt).not.toContain('instruction:');
  });

  test('unit があれば出す', () => {
    const prompt = buildRelocateQuoteUserPrompt({
      field: makeField({ unit: 'mg/day' }),
      value: '10',
      originalQuote: null,
      originalPage: null,
      pages: pages(1),
    });
    expect(prompt).toContain('unit: mg/day');
  });

  test('ページが 1 件も無ければ throw する', () => {
    expect(() =>
      buildRelocateQuoteUserPrompt({
        field: makeField(),
        value: '1',
        originalQuote: null,
        originalPage: null,
        pages: [],
      }),
    ).toThrow('relocate-quote skill にページ本文が 1 件も渡されていません');
  });
});

describe('RELOCATE_QUOTE_SYSTEM_PROMPT / RELOCATE_QUOTE_RESPONSE_SCHEMA / RELOCATE_QUOTE_PROMPT_VERSION', () => {
  test('システムプロンプトは quote の verbatim 必須化を明示する', () => {
    expect(RELOCATE_QUOTE_SYSTEM_PROMPT).toContain('VERBATIM');
    expect(RELOCATE_QUOTE_SYSTEM_PROMPT).toContain('found');
  });

  test('応答スキーマは found/quote/page の必須プロパティを持つ', () => {
    expect(RELOCATE_QUOTE_RESPONSE_SCHEMA['required']).toEqual(['found', 'quote', 'page']);
  });

  test('プロンプト版数は正の整数', () => {
    expect(Number.isInteger(RELOCATE_QUOTE_PROMPT_VERSION)).toBe(true);
    expect(RELOCATE_QUOTE_PROMPT_VERSION).toBeGreaterThan(0);
  });
});

describe('parseRelocateQuoteResponse', () => {
  test('found: true の応答をそのままパースする', () => {
    const result = parseRelocateQuoteResponse(
      JSON.stringify({ found: true, quote: 'a total of 120 patients were randomised', page: 4 }),
    );
    expect(result).toEqual({
      found: true,
      quote: 'a total of 120 patients were randomised',
      page: 4,
    });
  });

  test('found: false は quote/page の中身に関わらず正規化して返す', () => {
    const result = parseRelocateQuoteResponse(
      JSON.stringify({ found: false, quote: 'ignored', page: 9 }),
    );
    expect(result).toEqual({ found: false, quote: null, page: null });
  });

  test('found: true だが quote が null（不整合）も not_found 扱いへ正規化する', () => {
    const result = parseRelocateQuoteResponse(JSON.stringify({ found: true, quote: null, page: null }));
    expect(result).toEqual({ found: false, quote: null, page: null });
  });

  test('markdown フェンス付きの JSON も剥がしてパースする', () => {
    const fenced = '```json\n{"found": true, "quote": "abc", "page": 1}\n```';
    expect(parseRelocateQuoteResponse(fenced)).toEqual({ found: true, quote: 'abc', page: 1 });
  });

  test('JSON としてパースできない応答は throw する', () => {
    expect(() => parseRelocateQuoteResponse('not json')).toThrow(
      'relocate-quote 応答が JSON としてパースできません',
    );
  });

  test('形式不正（found が欠落）の応答は throw する', () => {
    expect(() => parseRelocateQuoteResponse(JSON.stringify({ quote: 'x', page: 1 }))).toThrow(
      'relocate-quote 応答の形式が不正です',
    );
  });

  test('page が正の整数でない場合は null へ落とす（catch）', () => {
    const result = parseRelocateQuoteResponse(
      JSON.stringify({ found: true, quote: 'abc', page: -1 }),
    );
    expect(result).toEqual({ found: true, quote: 'abc', page: null });
  });
});
