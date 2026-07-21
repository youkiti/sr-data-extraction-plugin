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

const ARM_FIELD = makeField({
  fieldId: 'f_arm_n',
  fieldName: 'sample_size_arm',
  entityLevel: 'arm',
  dataType: 'integer',
});

const OUTCOME_FIELD = makeField({
  fieldId: 'f_mortality',
  fieldName: 'mortality_n',
  entityLevel: 'outcome_result',
  dataType: 'integer',
});

const ROB_FIELD = makeField({
  fieldId: 'f_rob_rand',
  fieldName: 'rob_randomization',
  entityLevel: 'rob_domain',
  dataType: 'enum',
  allowedValues: 'low|some_concerns|high',
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

/** 高精度読み取りモード（issue #176）の文書: 本文 + ページ画像を併用する */
function makeTextWithImagesDoc(
  overrides: Partial<{
    role: DocumentRole;
    filename: string;
    pages: typeof PAGES;
    imagePages: ExtractDataImagePage[];
  }> = {},
): ExtractDataDocument {
  return {
    role: 'article' as DocumentRole,
    filename: 'smith2020.pdf',
    mode: 'text_with_images',
    pages: PAGES,
    imagePages: IMAGE_PAGES,
    ...overrides,
  };
}

const DOCS = [makeDoc()];

describe('extract-data skill 定数', () => {
  it('skill 名とプロンプト版数を公開する（LLMApiLog 記録用）', () => {
    expect(EXTRACT_DATA_SKILL_NAME).toBe('extract-data');
    // v8: 高精度読み取りモード（issue #176・input_mode = text_with_page_images）対応
    expect(EXTRACT_DATA_PROMPT_VERSION).toBe(8);
  });

  it('システムプロンプトに verbatim quote の規約（300 文字上限）と document_index の規約を含む', () => {
    expect(EXTRACT_DATA_SYSTEM_PROMPT).toContain('VERBATIM');
    expect(EXTRACT_DATA_SYSTEM_PROMPT).toContain('300 characters');
    expect(EXTRACT_DATA_SYSTEM_PROMPT).toContain('"not_reported": true');
    expect(EXTRACT_DATA_SYSTEM_PROMPT).toContain('"document_index"');
    expect(EXTRACT_DATA_SYSTEM_PROMPT).toContain('SAME trial');
  });

  it('システムプロンプトに quote / value を原文の言語・文字体系のまま返す規約（翻訳・音写の禁止）を含む（issue #95 層 2）', () => {
    expect(EXTRACT_DATA_SYSTEM_PROMPT).toContain(
      "Keep it in the document's original language and script — NEVER translate or transliterate",
    );
    expect(EXTRACT_DATA_SYSTEM_PROMPT).toContain(
      'report exactly as written in the document, in its original language and script',
    );
  });

  it('システムプロンプトにスキャン文書（画像添付）向けの quote / page 規約を含む', () => {
    expect(EXTRACT_DATA_SYSTEM_PROMPT).toContain('scanned document with no text layer');
    expect(EXTRACT_DATA_SYSTEM_PROMPT).toContain('verbatim transcription');
  });

  it('システムプロンプトに高精度読み取りモード（テキスト層 + 画像併用文書）向けの quote 規約を含む（issue #176）', () => {
    expect(EXTRACT_DATA_SYSTEM_PROMPT).toContain('DO have a text layer are ALSO attached as page images');
    expect(EXTRACT_DATA_SYSTEM_PROMPT).toContain(
      'still copy "quote" VERBATIM from that document\'s extracted TEXT below (not from the image)',
    );
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

  it('本文ページが 1 件も無い text_with_images 文書が含まれると投げる（issue #176）', () => {
    expect(() =>
      buildExtractDataUserPrompt({
        fields: [STUDY_FIELD],
        documents: [makeTextWithImagesDoc({ pages: [] })],
      }),
    ).toThrow('本文ページが 1 件も無い文書');
  });

  it('ページ画像が 1 件も無い text_with_images 文書が含まれると投げる（issue #176）', () => {
    expect(() =>
      buildExtractDataUserPrompt({
        fields: [STUDY_FIELD],
        documents: [makeTextWithImagesDoc({ imagePages: [] })],
      }),
    ).toThrow('ページ画像が 1 件も無い文書');
  });

  it('text_with_images 文書（issue #176・高精度読み取りモード）は本文をそのまま出したうえで画像併用の注記を足す', () => {
    const prompt = buildExtractDataUserPrompt({
      fields: [STUDY_FIELD],
      documents: [makeTextWithImagesDoc()],
    });
    expect(prompt).toContain('=== Document 1/1 [article] smith2020.pdf ===');
    // 本文（[PAGE n]）はそのまま出る（image モードと違い省略しない）
    expect(prompt).toContain('[PAGE 1]\nA randomized controlled trial of 120 patients.');
    expect(prompt).toContain('ALSO attached as images');
    expect(prompt).toContain('Document 1/1 page p');
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
    // protocol は Documents より前（さらに Fields より前）
    expect(prompt.indexOf('## Protocol context')).toBeLessThan(prompt.indexOf('## Documents'));
    expect(prompt.indexOf('## Protocol context')).toBeLessThan(prompt.indexOf('## Fields to extract'));
  });

  it('セクションは protocol → documents → fields → entity_key rules → 出力形式 の順に並ぶ（issue #89: 暗黙 prefix キャッシュ対応）', () => {
    const prompt = buildExtractDataUserPrompt({
      fields: [STUDY_FIELD],
      documents: DOCS,
      protocolContext: 'RQ: Does drug X reduce mortality?',
    });
    const protocolPos = prompt.indexOf('## Protocol context');
    const documentsPos = prompt.indexOf('## Documents');
    const fieldsPos = prompt.indexOf('## Fields to extract');
    const rulesPos = prompt.indexOf('## entity_key rules');
    const outputPos = prompt.indexOf('## Output format');
    expect(protocolPos).toBeGreaterThan(-1);
    expect(documentsPos).toBeGreaterThan(-1);
    expect(fieldsPos).toBeGreaterThan(-1);
    expect(rulesPos).toBeGreaterThan(-1);
    expect(outputPos).toBeGreaterThan(-1);
    expect(protocolPos).toBeLessThan(documentsPos);
    expect(documentsPos).toBeLessThan(fieldsPos);
    expect(fieldsPos).toBeLessThan(rulesPos);
    expect(rulesPos).toBeLessThan(outputPos);
  });

  it('protocolContext が無いバッチでも documents → fields → entity_key rules → 出力形式 の順は保たれる', () => {
    const prompt = buildExtractDataUserPrompt({ fields: [STUDY_FIELD], documents: DOCS });
    const documentsPos = prompt.indexOf('## Documents');
    const fieldsPos = prompt.indexOf('## Fields to extract');
    const rulesPos = prompt.indexOf('## entity_key rules');
    const outputPos = prompt.indexOf('## Output format');
    expect(documentsPos).toBeLessThan(fieldsPos);
    expect(fieldsPos).toBeLessThan(rulesPos);
    expect(rulesPos).toBeLessThan(outputPos);
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
    // 共通 fixture に fieldIndex だけ上書きして並び替えを検証する
    const outcomeField = { ...OUTCOME_FIELD, fieldIndex: 2 };
    const armField = { ...ARM_FIELD, fieldIndex: 1 };
    const robField = { ...ROB_FIELD, fieldIndex: 3 };
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

  it('arm レベル項目を含むバッチは suffix 末尾に completeness 強調セクションを追記する（issue #97: flash-lite の arm omission 対策）', () => {
    const prompt = buildExtractDataUserPrompt({ fields: [ARM_FIELD], documents: DOCS });
    const outputPos = prompt.indexOf('## Output format');
    const completenessPos = prompt.indexOf('## Completeness check (arm-level fields)');
    expect(outputPos).toBeGreaterThan(-1);
    expect(completenessPos).toBeGreaterThan(-1);
    // Output format セクションより後ろ = プロンプトの末尾に来る
    expect(completenessPos).toBeGreaterThan(outputPos);
    expect(prompt.trimEnd().endsWith('arms 2, 3, ... require the same complete set of items as arm 1.')).toBe(
      true,
    );
    expect(prompt).toContain('"arm:1", "arm:2"');
  });

  it('study / outcome_result / rob_domain のみのバッチには completeness セクションを追記しない（arm 項目が無いバッチへのノイズ回避）', () => {
    const prompt = buildExtractDataUserPrompt({
      fields: [STUDY_FIELD, OUTCOME_FIELD, ROB_FIELD],
      documents: DOCS,
    });
    expect(prompt).not.toContain('## Completeness check');
  });

  it('prefix（Protocol context + Documents）は arm レベル項目の有無に関わらず 1 文字も変わらない（issue #97: suffix 末尾追記が prefix キャッシュに影響しないことの確認）', () => {
    const prefixOf = (prompt: string) => prompt.slice(0, prompt.indexOf('## Fields to extract'));
    const withStudyOnly = buildExtractDataUserPrompt({ fields: [STUDY_FIELD], documents: DOCS });
    const withArm = buildExtractDataUserPrompt({ fields: [ARM_FIELD], documents: DOCS });
    expect(prefixOf(withArm)).toBe(prefixOf(withStudyOnly));
  });
});

describe('buildExtractDataUserContent（pdf_native）', () => {
  it('画像文書が 1 件も無ければ buildExtractDataUserPrompt の文字列と完全一致する（既存テスト保護）', () => {
    const input = { fields: [STUDY_FIELD], documents: DOCS };
    expect(buildExtractDataUserContent(input)).toBe(buildExtractDataUserPrompt(input));
  });

  it('画像文書があれば [prefix 本文, ラベル, 画像, ラベル, 画像, ..., suffix 本文] の配列を返す（issue #89: 画像は Documents 直後 = fields より前）', () => {
    const input = { fields: [STUDY_FIELD], documents: [makeDoc(), makeImageDoc()] };
    const content = buildExtractDataUserContent(input);
    expect(Array.isArray(content)).toBe(true);
    const parts = content as ChatContentPart[];

    // 先頭は prefix（Documents までを含む text パート）
    expect(parts[0]).toMatchObject({ type: 'text' });
    const prefixText = (parts[0] as { text: string }).text;
    expect(prefixText).toContain('## Documents');
    expect(prefixText).not.toContain('## Fields to extract');

    // 画像は文書順 → ページ順。各画像の直前にラベル（実際の document_index / total / page 番号）
    expect(parts.slice(1, -1)).toEqual([
      { type: 'text', text: '[Document 2/2 page 1]' },
      { type: 'image', mimeType: 'image/png', dataBase64: 'QUJD' },
      { type: 'text', text: '[Document 2/2 page 2]' },
      { type: 'image', mimeType: 'image/png', dataBase64: 'REVG' },
    ]);

    // 末尾は suffix（Fields to extract 以降を含む text パート）
    const suffixPart = parts[parts.length - 1];
    expect(suffixPart).toMatchObject({ type: 'text' });
    const suffixText = (suffixPart as { text: string }).text;
    expect(suffixText).toContain('## Fields to extract');
    expect(suffixText).toContain('## Output format');
    expect(suffixText).not.toContain('## Documents');

    // 不変条件: prefix + '\n\n' + suffix は buildExtractDataUserPrompt の全文と一致する
    expect(`${prefixText}\n\n${suffixText}`).toBe(buildExtractDataUserPrompt(input));
  });

  it('text_with_images 文書（issue #176・高精度読み取りモード）: 本文込みの prefix の直後に画像パートを添付する', () => {
    const input = { fields: [STUDY_FIELD], documents: [makeTextWithImagesDoc()] };
    const content = buildExtractDataUserContent(input);
    expect(Array.isArray(content)).toBe(true);
    const parts = content as ChatContentPart[];

    // 先頭の prefix テキストに本文（[PAGE n]）が含まれる（image モードと違い本文を省略しない）
    const prefixText = (parts[0] as { text: string }).text;
    expect(prefixText).toContain('[PAGE 1]\nA randomized controlled trial of 120 patients.');
    expect(prefixText).toContain('ALSO attached as images');

    expect(parts.slice(1, -1)).toEqual([
      { type: 'text', text: '[Document 1/1 page 1]' },
      { type: 'image', mimeType: 'image/png', dataBase64: 'QUJD' },
      { type: 'text', text: '[Document 1/1 page 2]' },
      { type: 'image', mimeType: 'image/png', dataBase64: 'REVG' },
    ]);

    const suffixText = (parts[parts.length - 1] as { text: string }).text;
    expect(suffixText).toContain('## Fields to extract');

    // 不変条件は text_with_images でも成り立つ
    expect(`${prefixText}\n\n${suffixText}`).toBe(buildExtractDataUserPrompt(input));
  });

  it('text_with_images 文書 + 通常の text 文書が混在する場合、text 文書には画像を添付しない', () => {
    const input = { fields: [STUDY_FIELD], documents: [makeDoc(), makeTextWithImagesDoc()] };
    const content = buildExtractDataUserContent(input);
    const parts = content as ChatContentPart[];
    // 画像は 2 番目（text_with_images）の文書ぶんだけ
    expect(parts.slice(1, -1)).toEqual([
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
    const input = { fields: [STUDY_FIELD], documents: [makeImageDoc(), secondImageDoc] };
    const content = buildExtractDataUserContent(input);
    const parts = content as ChatContentPart[];
    // 1 番目の text パートは prefix（Documents までの本文）、最後は suffix（Fields 以降の本文）。
    // 間は 1 番目の画像文書のページ → 2 番目の画像文書のページ
    expect(parts.slice(1, -1)).toEqual([
      { type: 'text', text: '[Document 1/2 page 1]' },
      { type: 'image', mimeType: 'image/png', dataBase64: 'QUJD' },
      { type: 'text', text: '[Document 1/2 page 2]' },
      { type: 'image', mimeType: 'image/png', dataBase64: 'REVG' },
      { type: 'text', text: '[Document 2/2 page 1]' },
      { type: 'image', mimeType: 'image/png', dataBase64: 'WFla' },
    ]);
    // 不変条件は複数画像文書でも成り立つ
    const prefixText = (parts[0] as { text: string }).text;
    const suffixText = (parts[parts.length - 1] as { text: string }).text;
    expect(`${prefixText}\n\n${suffixText}`).toBe(buildExtractDataUserPrompt(input));
  });

  it('画像文書 + arm レベル項目のバッチでは末尾の suffix text パートに completeness セクションを含む（issue #97）', () => {
    const input = { fields: [ARM_FIELD], documents: [makeDoc(), makeImageDoc()] };
    const content = buildExtractDataUserContent(input) as ChatContentPart[];
    const suffixPart = content[content.length - 1] as { type: string; text: string };
    expect(suffixPart.type).toBe('text');
    expect(suffixPart.text).toContain('## Completeness check (arm-level fields)');
    expect(suffixPart.text.trimEnd().endsWith('arms 2, 3, ... require the same complete set of items as arm 1.')).toBe(
      true,
    );
    // prefix（画像より前の text パート）には現れない
    const prefixText = (content[0] as { text: string }).text;
    expect(prefixText).not.toContain('## Completeness check');
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
