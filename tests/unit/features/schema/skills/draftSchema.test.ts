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
    expect(DRAFT_SCHEMA_PROMPT_VERSION).toBe(1);
    expect(DRAFT_SCHEMA_SYSTEM_PROMPT).toContain('snake_case');
    expect(DRAFT_SCHEMA_RESPONSE_SCHEMA['type']).toBe('array');
  });
});
