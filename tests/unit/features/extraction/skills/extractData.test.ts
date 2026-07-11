// extract-data skill（プロンプト管理）の単体テスト
// - プロンプト構築: 項目定義の条件付き行・entity_key 規約の出し分け・複数文書のロール付き連結
// - pdf_native: 画像文書（mode: 'image'）のプロンプト注記 + buildExtractDataUserContent の
//   画像パート構築（handoff-scanned-pdf-native-highlight.md §7.4 PR2）
// - 応答パース: フェンス剥がし + JSON 不正の AiOutputFormatError + validateAiOutput への委譲（document_index 込み）
import type { DocumentRole } from '../../../../../src/domain/document';
import type { SchemaField } from '../../../../../src/domain/schemaField';
import type { ChatContentPart } from '../../../../../src/lib/llm/LLMProvider';
import {
  buildExtractDataSystemPrompt,
  buildExtractDataUserContent,
  buildExtractDataUserPrompt,
  extractDataResponseSchema,
  parseExtractDataResponse,
  EXTRACT_DATA_PROMPT_VERSION,
  EXTRACT_DATA_RESPONSE_SCHEMA,
  EXTRACT_DATA_SKILL_NAME,
  EXTRACT_DATA_SYSTEM_PROMPT,
  type ExtractDataDocument,
  type ExtractDataImagePage,
} from '../../../../../src/features/extraction/skills/extractData';
import { AiOutputFormatError } from '../../../../../src/features/extraction/validateAiOutput';

function makeField(
  overrides: Pick<SchemaField, 'fieldId' | 'fieldName' | 'entityLevel' | 'dataType'> &
    Partial<SchemaField>,
): SchemaField {
  return {
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

const STUDY_FIELD = makeField({
  fieldId: 'f_design',
  fieldName: 'study_design',
  entityLevel: 'study',
  dataType: 'text',
});

const PAGES = [
  { page: 1, text: 'A randomized controlled trial of 120 patients.' },
  { page: 2, text: 'Mortality at 30 days was 12% vs 18%.' },
];

function makeDoc(
  overrides: Partial<{ role: DocumentRole; filename: string; pages: typeof PAGES }> = {},
): ExtractDataDocument {
  return {
    role: 'article' as DocumentRole,
    filename: 'smith2020.pdf',
    mode: 'text',
    pages: PAGES,
    ...overrides,
  };
}

const IMAGE_PAGES: ExtractDataImagePage[] = [
  { page: 1, mimeType: 'image/png', dataBase64: 'QUJD' },
  { page: 2, mimeType: 'image/png', dataBase64: 'REVG' },
];

function makeImageDoc(
  overrides: Partial<{ role: DocumentRole; filename: string; imagePages: ExtractDataImagePage[] }> = {},
): ExtractDataDocument {
  return {
    role: 'supplement' as DocumentRole,
    filename: 'scan.pdf',
    mode: 'image',
    imagePages: IMAGE_PAGES,
    ...overrides,
  };
}

const DOCS = [makeDoc()];

describe('extract-data skill 定数', () => {
  it('skill 名とプロンプト版数を公開する（LLMApiLog 記録用）', () => {
    expect(EXTRACT_DATA_SKILL_NAME).toBe('extract-data');
    // v4: box_2d（bbox）の取得に対応（requestBox=true 時のみ）
    expect(EXTRACT_DATA_PROMPT_VERSION).toBe(4);
  });

  it('システムプロンプトに verbatim quote の規約（300 文字上限）と document_index の規約を含む', () => {
    expect(EXTRACT_DATA_SYSTEM_PROMPT).toContain('VERBATIM');
    expect(EXTRACT_DATA_SYSTEM_PROMPT).toContain('300 characters');
    expect(EXTRACT_DATA_SYSTEM_PROMPT).toContain('"not_reported": true');
    expect(EXTRACT_DATA_SYSTEM_PROMPT).toContain('"document_index"');
    expect(EXTRACT_DATA_SYSTEM_PROMPT).toContain('SAME trial');
  });

  it('システムプロンプトにスキャン文書（画像添付）向けの quote / page 規約を含む', () => {
    expect(EXTRACT_DATA_SYSTEM_PROMPT).toContain('scanned document with no text layer');
    expect(EXTRACT_DATA_SYSTEM_PROMPT).toContain('verbatim transcription');
  });

  it('構造化出力スキーマは応答 8 キー（document_index 込み）すべてを required にする', () => {
    const items = EXTRACT_DATA_RESPONSE_SCHEMA['items'] as Record<string, unknown>;
    expect(items['required']).toEqual([
      'field_id',
      'entity_key',
      'value',
      'not_reported',
      'quote',
      'page',
      'document_index',
      'confidence',
    ]);
  });
});

describe('buildExtractDataSystemPrompt（box_2d ルール。§7.4 PR3）', () => {
  it('requestBox=false は EXTRACT_DATA_SYSTEM_PROMPT と完全一致する（text_only 経路は 1 文字も変えない）', () => {
    expect(buildExtractDataSystemPrompt(false)).toBe(EXTRACT_DATA_SYSTEM_PROMPT);
  });

  it('requestBox=true は box ルールを末尾に追記する', () => {
    const prompt = buildExtractDataSystemPrompt(true);
    expect(prompt.startsWith(EXTRACT_DATA_SYSTEM_PROMPT)).toBe(true);
    expect(prompt).toContain('box_2d');
    expect(prompt).toContain('scanned document');
    // 幻覚 box 防止: 位置特定できたときだけ返す・最も近い box の推測は禁止、を明示する
    expect(prompt).toContain('only if');
    expect(prompt).toMatch(/NEVER guess/);
  });
});

describe('extractDataResponseSchema（box_2d 込みスキーマ。§7.4 PR3）', () => {
  it('requestBox=false は EXTRACT_DATA_RESPONSE_SCHEMA をそのまま返す', () => {
    expect(extractDataResponseSchema(false)).toBe(EXTRACT_DATA_RESPONSE_SCHEMA);
  });

  it('requestBox=true は box_2d（4 要素固定長配列 | null）を追加した新オブジェクトを返す', () => {
    const schema = extractDataResponseSchema(true);
    expect(schema).not.toBe(EXTRACT_DATA_RESPONSE_SCHEMA); // 既存定数は変更しない
    const items = schema['items'] as Record<string, unknown>;
    const properties = items['properties'] as Record<string, unknown>;
    expect(properties['box_2d']).toEqual({
      type: ['array', 'null'],
      items: { type: 'integer' },
      minItems: 4,
      maxItems: 4,
    });
    expect(items['required']).toEqual([
      'field_id',
      'entity_key',
      'value',
      'not_reported',
      'quote',
      'page',
      'document_index',
      'confidence',
      'box_2d',
    ]);
    // 既存定数は 1 文字も変わっていない（副作用のない純粋関数であること）
    expect(EXTRACT_DATA_RESPONSE_SCHEMA['items']).not.toHaveProperty(
      'properties.box_2d',
    );
  });
});

describe('buildExtractDataUserPrompt', () => {
  it('抽出項目が空なら投げる', () => {
    expect(() => buildExtractDataUserPrompt({ fields: [], documents: DOCS })).toThrow(
      '抽出項目が 1 件も',
    );
  });

  it('文書が空なら投げる', () => {
    expect(() => buildExtractDataUserPrompt({ fields: [STUDY_FIELD], documents: [] })).toThrow(
      '文書が 1 件も',
    );
  });

  it('本文ページが 1 件も無い文書が含まれると投げる', () => {
    expect(() =>
      buildExtractDataUserPrompt({
        fields: [STUDY_FIELD],
        documents: [makeDoc({ pages: [] })],
      }),
    ).toThrow('本文ページが 1 件も無い文書');
  });

  it('ページ画像が 1 件も無い画像文書が含まれると投げる（pdf_native）', () => {
    expect(() =>
      buildExtractDataUserPrompt({
        fields: [STUDY_FIELD],
        documents: [makeImageDoc({ imagePages: [] })],
      }),
    ).toThrow('ページ画像が 1 件も無い文書');
  });

  it('画像文書（mode: image）は本文の代わりに画像添付の注記を出す（pdf_native）', () => {
    const prompt = buildExtractDataUserPrompt({
      fields: [STUDY_FIELD],
      documents: [makeImageDoc()],
    });
    expect(prompt).toContain('=== Document 1/1 [supplement] scan.pdf ===');
    expect(prompt).toContain('scanned PDF with no text layer');
    expect(prompt).toContain('Document 1/1 page p');
    // 画像文書には本文（[PAGE n]）を出さない
    expect(prompt).not.toContain('[PAGE');
  });

  it('study 項目のみの最小構成: field_id・study 規約・ページマーカー・出力形式を含む', () => {
    const prompt = buildExtractDataUserPrompt({ fields: [STUDY_FIELD], documents: DOCS });
    expect(prompt).toContain('- field_id: f_design');
    expect(prompt).toContain('  field_name: study_design');
    expect(prompt).toContain('  entity_level: study');
    expect(prompt).toContain('  data_type: text');
    expect(prompt).toContain('- study level: "entity_key" is always "-"');
    expect(prompt).toContain('[PAGE 1]\nA randomized controlled trial of 120 patients.');
    expect(prompt).toContain('[PAGE 2]\nMortality at 30 days was 12% vs 18%.');
    expect(prompt).toContain('## Output format');
    // 単一文書の見出し（1/1）
    expect(prompt).toContain('=== Document 1/1 [article] smith2020.pdf ===');
    expect(prompt).toContain('One document is provided.');
    // 補助情報が未設定の項目には該当行を出さない
    expect(prompt).not.toContain('unit:');
    expect(prompt).not.toContain('allowed_values:');
    expect(prompt).not.toContain('instruction:');
    expect(prompt).not.toContain('example:');
    // バッチに存在しない entity_level の規約は提示しない
    expect(prompt).not.toContain('- arm level:');
    expect(prompt).not.toContain('- outcome_result level:');
    expect(prompt).not.toContain('- rob_domain level:');
    // protocolContext 未指定ならセクションごと省略
    expect(prompt).not.toContain('## Protocol context');
    // requestBox 未指定（既定 false）は出力形式に box_2d を出さない
    expect(prompt).not.toContain('box_2d');
  });

  it('requestBox=true は出力形式の要素定義に box_2d を追記する（§7.4 PR3）', () => {
    const prompt = buildExtractDataUserPrompt({
      fields: [STUDY_FIELD],
      documents: DOCS,
      requestBox: true,
    });
    expect(prompt).toContain('"box_2d": [ymin, xmin, ymax, xmax] | null');
  });

  it('複数文書はロール付きの区切りで document_index 順に連結する', () => {
    const prompt = buildExtractDataUserPrompt({
      fields: [STUDY_FIELD],
      documents: [
        makeDoc({ role: 'article', filename: 'main.pdf' }),
        makeDoc({ role: 'registration', filename: 'NCT01.pdf', pages: [{ page: 1, text: 'NCT01234567' }] }),
      ],
    });
    expect(prompt).toContain('2 documents from the same trial');
    expect(prompt).toContain('=== Document 1/2 [article] main.pdf ===');
    expect(prompt).toContain('=== Document 2/2 [registration] NCT01.pdf ===');
    // 出力形式に document_index の範囲を明示
    expect(prompt).toContain('"document_index": <1..2>');
    // 並びは入力順（article → registration）
    expect(prompt.indexOf('main.pdf')).toBeLessThan(prompt.indexOf('NCT01.pdf'));
  });

  it('unit / allowed_values / instruction / example を設定した項目は行として描画する', () => {
    const field = makeField({
      fieldId: 'f_dose',
      fieldName: 'dose',
      entityLevel: 'arm',
      dataType: 'float',
      unit: 'mg/day',
      allowedValues: 'low|high',
      extractionInstruction: 'Extract the daily maintenance dose.',
      example: '50 mg/day',
    });
    const prompt = buildExtractDataUserPrompt({ fields: [field], documents: DOCS });
    expect(prompt).toContain('  unit: mg/day (report the value as written');
    expect(prompt).toContain('  allowed_values: low|high ("value" must be one of these)');
    expect(prompt).toContain('  instruction: Extract the daily maintenance dose.');
    expect(prompt).toContain('  example: 50 mg/day');
  });

  it('protocolContext があれば先頭セクションとして含める', () => {
    const prompt = buildExtractDataUserPrompt({
      fields: [STUDY_FIELD],
      documents: DOCS,
      protocolContext: 'RQ: Does drug X reduce mortality?',
    });
    expect(prompt).toContain('## Protocol context\n\nRQ: Does drug X reduce mortality?');
    expect(prompt.indexOf('## Protocol context')).toBeLessThan(prompt.indexOf('## Fields to extract'));
  });

  it('protocolContext が空白のみなら省略する', () => {
    const prompt = buildExtractDataUserPrompt({
      fields: [STUDY_FIELD],
      documents: DOCS,
      protocolContext: '   ',
    });
    expect(prompt).not.toContain('## Protocol context');
  });

  it('項目は fieldIndex 順に並べ、存在する entity_level の規約を規定順で提示する', () => {
    const outcomeField = makeField({
      fieldId: 'f_mortality',
      fieldName: 'mortality_n',
      entityLevel: 'outcome_result',
      dataType: 'integer',
      fieldIndex: 2,
    });
    const armField = makeField({
      fieldId: 'f_arm_n',
      fieldName: 'sample_size_arm',
      entityLevel: 'arm',
      dataType: 'integer',
      fieldIndex: 1,
    });
    const robField = makeField({
      fieldId: 'f_rob_rand',
      fieldName: 'rob_randomization',
      entityLevel: 'rob_domain',
      dataType: 'enum',
      fieldIndex: 3,
      allowedValues: 'low|some_concerns|high',
    });
    const prompt = buildExtractDataUserPrompt({
      fields: [robField, outcomeField, armField],
      documents: DOCS,
    });
    // fieldIndex 昇順（arm → outcome → rob）
    const armPos = prompt.indexOf('- field_id: f_arm_n');
    const outcomePos = prompt.indexOf('- field_id: f_mortality');
    const robPos = prompt.indexOf('- field_id: f_rob_rand');
    expect(armPos).toBeGreaterThan(-1);
    expect(armPos).toBeLessThan(outcomePos);
    expect(outcomePos).toBeLessThan(robPos);
    // entity_key 規約は study なし・arm / outcome_result / rob_domain ありの出し分け
    expect(prompt).not.toContain('- study level:');
    expect(prompt).toContain('- arm level:');
    expect(prompt).toContain('- outcome_result level:');
    expect(prompt).toContain('- rob_domain level:');
    expect(prompt.indexOf('- arm level:')).toBeLessThan(prompt.indexOf('- outcome_result level:'));
  });
});

describe('buildExtractDataUserContent（pdf_native）', () => {
  it('画像文書が 1 件も無ければ buildExtractDataUserPrompt の文字列と完全一致する（既存テスト保護）', () => {
    const input = { fields: [STUDY_FIELD], documents: DOCS };
    expect(buildExtractDataUserContent(input)).toBe(buildExtractDataUserPrompt(input));
  });

  it('画像文書があれば [テキスト本文, ラベル, 画像, ラベル, 画像, ...] の配列を返す', () => {
    const content = buildExtractDataUserContent({
      fields: [STUDY_FIELD],
      documents: [makeDoc(), makeImageDoc()],
    });
    expect(Array.isArray(content)).toBe(true);
    const parts = content as ChatContentPart[];
    expect(parts[0]).toMatchObject({ type: 'text' });
    expect((parts[0] as { text: string }).text).toBe(
      buildExtractDataUserPrompt({ fields: [STUDY_FIELD], documents: [makeDoc(), makeImageDoc()] }),
    );
    // 画像は文書順 → ページ順。各画像の直前にラベル（実際の document_index / total / page 番号）
    expect(parts.slice(1)).toEqual([
      { type: 'text', text: '[Document 2/2 page 1]' },
      { type: 'image', mimeType: 'image/png', dataBase64: 'QUJD' },
      { type: 'text', text: '[Document 2/2 page 2]' },
      { type: 'image', mimeType: 'image/png', dataBase64: 'REVG' },
    ]);
  });

  it('複数の画像文書がある場合、文書順（document_index）→ ページ順で画像パートを並べる', () => {
    const secondImageDoc = makeImageDoc({
      role: 'other',
      filename: 'scan2.pdf',
      imagePages: [{ page: 1, mimeType: 'image/png', dataBase64: 'WFla' }],
    });
    const content = buildExtractDataUserContent({
      fields: [STUDY_FIELD],
      documents: [makeImageDoc(), secondImageDoc],
    });
    const parts = content as ChatContentPart[];
    // 1 番目の text パートはプロンプト本文。以降は 1 番目の画像文書のページ → 2 番目の画像文書のページ
    expect(parts.slice(1)).toEqual([
      { type: 'text', text: '[Document 1/2 page 1]' },
      { type: 'image', mimeType: 'image/png', dataBase64: 'QUJD' },
      { type: 'text', text: '[Document 1/2 page 2]' },
      { type: 'image', mimeType: 'image/png', dataBase64: 'REVG' },
      { type: 'text', text: '[Document 2/2 page 1]' },
      { type: 'image', mimeType: 'image/png', dataBase64: 'WFla' },
    ]);
  });
});

describe('parseExtractDataResponse', () => {
  const VALID_ITEM = {
    field_id: 'f_design',
    entity_key: '-',
    value: 'RCT',
    not_reported: false,
    quote: 'A randomized controlled trial of 120 patients.',
    page: 1,
    document_index: 1,
    confidence: 'high',
  };

  it('素の JSON 配列を validateAiOutput に委譲して返す', () => {
    const result = parseExtractDataResponse(JSON.stringify([VALID_ITEM]), [STUDY_FIELD], 1);
    expect(result.items).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
    expect(result.items[0]?.fieldId).toBe('f_design');
    expect(result.items[0]?.confidence).toBe('high');
    expect(result.items[0]?.documentIndex).toBe(1);
  });

  it('```json フェンスで包まれた応答も剥がしてパースする', () => {
    const fenced = '```json\n' + JSON.stringify([VALID_ITEM]) + '\n```';
    const result = parseExtractDataResponse(fenced, [STUDY_FIELD], 1);
    expect(result.items).toHaveLength(1);
  });

  it('言語指定なしのフェンスも剥がす', () => {
    const fenced = '```\n' + JSON.stringify([VALID_ITEM]) + '\n```';
    const result = parseExtractDataResponse(fenced, [STUDY_FIELD], 1);
    expect(result.items).toHaveLength(1);
  });

  it('JSON としてパースできない応答は AiOutputFormatError', () => {
    expect(() => parseExtractDataResponse('not a json', [STUDY_FIELD], 1)).toThrow(
      AiOutputFormatError,
    );
    expect(() => parseExtractDataResponse('not a json', [STUDY_FIELD], 1)).toThrow(
      'JSON としてパースできません',
    );
  });

  it('配列でない JSON は validateAiOutput 側の AiOutputFormatError', () => {
    expect(() => parseExtractDataResponse('{}', [STUDY_FIELD], 1)).toThrow(AiOutputFormatError);
  });

  it('未知の field_id は rejected として返る（validateAiOutput の規則がそのまま効く）', () => {
    const result = parseExtractDataResponse(
      JSON.stringify([{ ...VALID_ITEM, field_id: 'f_unknown' }]),
      [STUDY_FIELD],
      1,
    );
    expect(result.items).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.reason).toBe('unknown_field_id');
  });

  it('document_index の範囲外は rejected（documentCount を渡してそのまま検証される）', () => {
    const result = parseExtractDataResponse(
      JSON.stringify([{ ...VALID_ITEM, document_index: 3 }]),
      [STUDY_FIELD],
      2,
    );
    expect(result.items).toHaveLength(0);
    expect(result.rejected[0]?.reason).toBe('invalid_document_index');
  });
});
