import {
  buildDraftSchemaUserPrompt,
  DRAFT_SCHEMA_PROMPT_VERSION,
  DRAFT_SCHEMA_RESPONSE_SCHEMA,
  DRAFT_SCHEMA_SYSTEM_PROMPT,
  DraftSchemaFormatError,
  parseDraftSchemaResponse,
} from '../../../../../src/features/schema/skills/draftSchema';

const DRAFTED_ITEM = {
  section: 'population',
  field_name: 'sample_size_total',
  field_label: '総サンプルサイズ',
  entity_level: 'study',
  data_type: 'integer',
  unit: null,
  allowed_values: null,
  required: true,
  extraction_instruction: 'Report the total number of randomised participants.',
  example: '120',
};

describe('buildDraftSchemaUserPrompt', () => {
  const samples = [
    { label: 'Smith 2020', pages: [{ page: 1, text: 'Abstract...' }, { page: 2, text: 'Methods...' }] },
  ];

  test('プロトコル・サンプル論文（[PAGE n] 区切り）・出力形式を組み立てる', () => {
    const prompt = buildDraftSchemaUserPrompt({ protocolText: ' P: 成人肺炎 ', samples });
    expect(prompt).toContain('## Review protocol\n\nP: 成人肺炎');
    expect(prompt).toContain('## Sample article: Smith 2020');
    expect(prompt).toContain('[PAGE 1]\nAbstract...');
    expect(prompt).toContain('[PAGE 2]\nMethods...');
    expect(prompt).toContain('## Output format');
    expect(prompt).toContain('"entity_level": "study" | "arm" | "outcome_result"');
  });

  test('プロトコル本文が空なら throw する', () => {
    expect(() => buildDraftSchemaUserPrompt({ protocolText: '  ', samples })).toThrow(
      'プロトコル本文が渡されていません',
    );
  });

  test('サンプル論文が 0 本 / 4 本なら throw する', () => {
    expect(() => buildDraftSchemaUserPrompt({ protocolText: 'P', samples: [] })).toThrow(
      '1〜3 本です（指定: 0 本）',
    );
    const four = Array.from({ length: 4 }, (_, i) => ({
      label: `S${i}`,
      pages: [{ page: 1, text: 't' }],
    }));
    expect(() => buildDraftSchemaUserPrompt({ protocolText: 'P', samples: four })).toThrow(
      '1〜3 本です（指定: 4 本）',
    );
  });
});

describe('parseDraftSchemaResponse', () => {
  test('妥当な JSON 配列をエディタ行へ変換する（fieldId null / aiGenerated true）', () => {
    const rows = parseDraftSchemaResponse(JSON.stringify([DRAFTED_ITEM]));
    expect(rows).toEqual([
      {
        maxQuotes: null,
        multiSelect: false,
    exclusiveValues: null,
    freeTextValues: null,
        fieldId: null,
        section: 'population',
        fieldName: 'sample_size_total',
        fieldLabel: '総サンプルサイズ',
        entityLevel: 'study',
        dataType: 'integer',
        unit: null,
        allowedValues: null,
        required: true,
        extractionInstruction: 'Report the total number of randomised participants.',
        example: '120',
        aiGenerated: true,
        note: null,
      },
    ]);
  });

  test('markdown フェンスで包まれた応答も剥がしてパースする', () => {
    const rows = parseDraftSchemaResponse('```json\n' + JSON.stringify([DRAFTED_ITEM]) + '\n```');
    expect(rows).toHaveLength(1);
  });

  test('JSON でない応答は DraftSchemaFormatError', () => {
    expect(() => parseDraftSchemaResponse('not json')).toThrow(DraftSchemaFormatError);
    expect(() => parseDraftSchemaResponse('not json')).toThrow('JSON としてパースできません');
  });

  test('形式違反（enum 外の entity_level・空配列）は DraftSchemaFormatError', () => {
    const bad = [{ ...DRAFTED_ITEM, entity_level: 'rob_domain' }];
    expect(() => parseDraftSchemaResponse(JSON.stringify(bad))).toThrow(
      '表のデザインドラフトの形式に合いません',
    );
    expect(() => parseDraftSchemaResponse('[]')).toThrow(DraftSchemaFormatError);
  });

  // issue #48: AI が StudyData の固定列名（study_id 等）をそのまま field_name に
  // 提案してしまい、保存時のバリデーションで手戻りが発生する事象への対処
  test('StudyData 固定列名と衝突しない field_name は変更しない', () => {
    const rows = parseDraftSchemaResponse(JSON.stringify([DRAFTED_ITEM]));
    expect(rows[0]?.fieldName).toBe('sample_size_total');
  });

  test('StudyData 固定列名（study_id）と衝突する field_name は "_reported" を付けて自動リネームする', () => {
    const items = [{ ...DRAFTED_ITEM, field_name: 'study_id' }];
    const rows = parseDraftSchemaResponse(JSON.stringify(items));
    expect(rows[0]?.fieldName).toBe('study_id_reported');
  });

  test('リネーム先が他の行の field_name と重複する場合は連番を振って一意にする', () => {
    const items = [
      { ...DRAFTED_ITEM, field_name: 'study_id' },
      { ...DRAFTED_ITEM, field_name: 'study_id' },
      { ...DRAFTED_ITEM, field_name: 'study_id' },
    ];
    const rows = parseDraftSchemaResponse(JSON.stringify(items));
    expect(rows.map((row) => row.fieldName)).toEqual([
      'study_id_reported',
      'study_id_reported_2',
      'study_id_reported_3',
    ]);
  });

  test('リネーム先が既存の field_name（AI が既に提案済み）と重複する場合も連番を振る', () => {
    const items = [
      { ...DRAFTED_ITEM, field_name: 'study_id' },
      { ...DRAFTED_ITEM, field_name: 'study_id_reported' },
    ];
    const rows = parseDraftSchemaResponse(JSON.stringify(items));
    expect(rows.map((row) => row.fieldName)).toEqual(['study_id_reported_2', 'study_id_reported']);
  });
});

describe('定数', () => {
  test('プロンプト版数とシステムプロンプト・応答スキーマが定義されている', () => {
    expect(DRAFT_SCHEMA_PROMPT_VERSION).toBe(4);
    expect(DRAFT_SCHEMA_SYSTEM_PROMPT).toContain('snake_case');
    expect(DRAFT_SCHEMA_RESPONSE_SCHEMA['type']).toBe('array');
  });

  // 版数 2: レビュータイプ適応。scoping / DTA / 予後のプロトコルに PICO・比較研究の
  // entity_level 構成を強制しないことがこの版の眼目のため、タイプ別の指示があることを固定する
  test('システムプロンプトがレビュータイプ別の指示を含む（版数 2）', () => {
    expect(DRAFT_SCHEMA_SYSTEM_PROMPT).toContain('First infer the review type');
    expect(DRAFT_SCHEMA_SYSTEM_PROMPT).toContain('Intervention (comparative) reviews');
    expect(DRAFT_SCHEMA_SYSTEM_PROMPT).toContain('Diagnostic test accuracy reviews');
    expect(DRAFT_SCHEMA_SYSTEM_PROMPT).toContain('Prognosis reviews');
    expect(DRAFT_SCHEMA_SYSTEM_PROMPT).toContain('Scoping or mapping reviews');
  });

  test('群比較も群別・結果別の数値もなければレビュー名によらず study のみを提案する', () => {
    expect(DRAFT_SCHEMA_SYSTEM_PROMPT).toContain('using both the protocol and the full text of the sample articles');
    expect(DRAFT_SCHEMA_SYSTEM_PROMPT).toContain("regardless of the review type's name");
    expect(DRAFT_SCHEMA_SYSTEM_PROMPT).toContain('neither between-group comparisons nor per-group or per-result numeric data');
    expect(DRAFT_SCHEMA_SYSTEM_PROMPT).toContain('do not create any "arm" or "outcome_result" fields; propose all fields at the "study" level');
    expect(DRAFT_SCHEMA_SYSTEM_PROMPT).toContain('qualitative studies, cross-sectional surveys and concept synthesis');
    expect(DRAFT_SCHEMA_SYSTEM_PROMPT).toContain('study-level enum fields for categories or text fields for descriptions');
    expect(DRAFT_SCHEMA_SYSTEM_PROMPT).toContain('A study-level total N alone does not require "arm" or "outcome_result" fields');
  });

  test('比較・DTA・予後の数値結果とカテゴリ項目の既存規則を保持する', () => {
    expect(DRAFT_SCHEMA_SYSTEM_PROMPT).toContain('arm-level intervention fields, and outcome_result fields');
    expect(DRAFT_SCHEMA_SYSTEM_PROMPT).toContain('outcome_result fields repeated per index test for TP, FP, FN, TN');
    expect(DRAFT_SCHEMA_SYSTEM_PROMPT).toContain('outcome_result fields repeated per prognostic factor and outcome');
    expect(DRAFT_SCHEMA_SYSTEM_PROMPT).toContain('Use "enum" for fields that will be counted or classified by category');
    expect(DRAFT_SCHEMA_SYSTEM_PROMPT).toContain('Every enum must include "unclear"; also include "other"');
    expect(DRAFT_SCHEMA_SYSTEM_PROMPT).toContain('Use "text" only for fields where quotations or descriptions should be preserved as written');
  });
});
