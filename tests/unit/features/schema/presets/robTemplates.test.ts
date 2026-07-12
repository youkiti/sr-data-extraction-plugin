import {
  QUADAS3_APPLICABILITY_DOMAINS,
  QUADAS3_DOMAINS,
  QUADAS3_SQ_FIELD_NAMES,
  QUIPS_DOMAINS,
  QUIPS_ITEM_FIELD_NAMES,
  ROB2_DOMAINS,
  ROB2_SQ_FIELD_NAMES,
  ROBINS_I_DOMAINS,
  ROBINS_I_SQ_FIELD_NAMES,
  ROB_TEMPLATE_QUADAS3,
  ROB_TEMPLATE_QUIPS,
  ROB_TEMPLATE_ROB2,
  ROB_TEMPLATE_ROB2_SQ,
  ROB_TEMPLATE_ROBINS_I,
  ROB_TEMPLATE_ROBINS_I_SQ,
  ROB_TEMPLATES,
} from '../../../../../src/features/schema/presets/robTemplates';
import { SCHEMA_PRESETS } from '../../../../../src/features/schema/presets';
import { OUTCOME_TEMPLATES } from '../../../../../src/features/schema/presets/outcomeTemplates';
import { validateEditorRows } from '../../../../../src/features/schema/validateField';
import { parseEntityKey } from '../../../../../src/utils/entityKey';

describe('robTemplates', () => {
  test('RoB 2: 判定 / 根拠の 2 項目（rob_domain・risk_of_bias セクション）', () => {
    expect(ROB_TEMPLATE_ROB2.map((row) => row.fieldName)).toEqual([
      'rob2_judgement',
      'rob2_support',
    ]);
    for (const row of ROB_TEMPLATE_ROB2) {
      expect(row).toMatchObject({
        fieldId: null,
        section: 'risk_of_bias',
        entityLevel: 'rob_domain',
        aiGenerated: false,
      });
    }
    expect(ROB_TEMPLATE_ROB2[0]).toMatchObject({
      dataType: 'enum',
      allowedValues: 'low|some_concerns|high',
      required: true,
    });
    expect(ROB_TEMPLATE_ROB2[1]).toMatchObject({
      dataType: 'text',
      allowedValues: null,
      required: false,
    });
  });

  test('ROBINS-I: 判定 / 根拠の 2 項目（判定は 5 段階 enum）', () => {
    expect(ROB_TEMPLATE_ROBINS_I.map((row) => row.fieldName)).toEqual([
      'robins_i_judgement',
      'robins_i_support',
    ]);
    expect(ROB_TEMPLATE_ROBINS_I[0]).toMatchObject({
      dataType: 'enum',
      allowedValues: 'low|moderate|serious|critical|no_information',
      required: true,
    });
    expect(ROB_TEMPLATE_ROBINS_I[1]).toMatchObject({ dataType: 'text', required: false });
  });

  test('ドメイン定義: RoB 2 = D1〜D5 + overall / ROBINS-I = D1〜D7 + overall', () => {
    expect(ROB2_DOMAINS.map((domain) => domain.id)).toEqual([
      'd1_randomization',
      'd2_deviations',
      'd3_missing_data',
      'd4_measurement',
      'd5_reporting',
      'overall',
    ]);
    expect(ROBINS_I_DOMAINS.map((domain) => domain.id)).toEqual([
      'd1_confounding',
      'd2_selection',
      'd3_classification',
      'd4_deviations',
      'd5_missing_data',
      'd6_measurement',
      'd7_reporting',
      'overall',
    ]);
  });

  test.each([
    ['rob2', ROB_TEMPLATE_ROB2, ROB2_DOMAINS],
    ['robins_i', ROB_TEMPLATE_ROBINS_I, ROBINS_I_DOMAINS],
  ] as const)(
    '%s: 全ドメインの entity_key が抽出指示に明示され、parseEntityKey で rob_domain に解決できる',
    (_kind, template, domains) => {
      const instruction = template[0]?.extractionInstruction ?? '';
      for (const domain of domains) {
        const entityKey = `rob:${domain.id}`;
        expect(instruction).toContain(`"${entityKey}"`);
        expect(parseEntityKey(entityKey)).toEqual({ level: 'rob_domain', domain: domain.id });
      }
    },
  );

  test('プリセット単体はエディタ検証を通る（挿入後の重複はエディタ側で検出）', () => {
    expect(validateEditorRows(ROB_TEMPLATE_ROB2)).toEqual([]);
    expect(validateEditorRows(ROB_TEMPLATE_ROBINS_I)).toEqual([]);
    // 両テンプレートを同時に挿入しても field_name は衝突しない（混在デザインの SR）
    expect(validateEditorRows([...ROB_TEMPLATE_ROB2, ...ROB_TEMPLATE_ROBINS_I])).toEqual([]);
  });

  test('UI のボタンと 1:1 のマップを公開する（SCHEMA_PRESETS はアウトカム系と束ねる）', () => {
    expect(ROB_TEMPLATES.rob2).toBe(ROB_TEMPLATE_ROB2);
    expect(ROB_TEMPLATES.robins_i).toBe(ROB_TEMPLATE_ROBINS_I);
    expect(ROB_TEMPLATES.rob2_sq).toBe(ROB_TEMPLATE_ROB2_SQ);
    expect(ROB_TEMPLATES.robins_i_sq).toBe(ROB_TEMPLATE_ROBINS_I_SQ);
    expect(ROB_TEMPLATES.quadas3).toBe(ROB_TEMPLATE_QUADAS3);
    expect(ROB_TEMPLATES.quips).toBe(ROB_TEMPLATE_QUIPS);
    expect(SCHEMA_PRESETS).toEqual({ ...OUTCOME_TEMPLATES, ...ROB_TEMPLATES });
  });

  describe('RoB 2（SQ 完全版。issue #61 PR1）', () => {
    test('判定 + 根拠 + SQ 22 問の計 24 項目を挿入する', () => {
      expect(ROB_TEMPLATE_ROB2_SQ).toHaveLength(24);
      expect(ROB_TEMPLATE_ROB2_SQ[0]?.fieldName).toBe('rob2_judgement');
      expect(ROB_TEMPLATE_ROB2_SQ[1]?.fieldName).toBe('rob2_support');
      const sqFieldNames = ROB_TEMPLATE_ROB2_SQ.slice(2).map((row) => row.fieldName);
      expect(sqFieldNames).toEqual([
        'rob2_sq1_1',
        'rob2_sq1_2',
        'rob2_sq1_3',
        'rob2_sq2_1',
        'rob2_sq2_2',
        'rob2_sq2_3',
        'rob2_sq2_4',
        'rob2_sq2_5',
        'rob2_sq2_6',
        'rob2_sq2_7',
        'rob2_sq3_1',
        'rob2_sq3_2',
        'rob2_sq3_3',
        'rob2_sq3_4',
        'rob2_sq4_1',
        'rob2_sq4_2',
        'rob2_sq4_3',
        'rob2_sq4_4',
        'rob2_sq4_5',
        'rob2_sq5_1',
        'rob2_sq5_2',
        'rob2_sq5_3',
      ]);
    });

    test('全項目が rob_domain レベル・専用セクション risk_of_bias_rob2 に属する（judgement/support も同一セクション = 1 バッチで完結させるため）', () => {
      for (const row of ROB_TEMPLATE_ROB2_SQ) {
        expect(row.entityLevel).toBe('rob_domain');
        expect(row.section).toBe('risk_of_bias_rob2');
        expect(row.fieldId).toBeNull();
        expect(row.aiGenerated).toBe(false);
      }
    });

    test('SQ 項目は enum・y|py|pn|n|ni|na・required=false', () => {
      for (const row of ROB_TEMPLATE_ROB2_SQ.slice(2)) {
        expect(row.dataType).toBe('enum');
        expect(row.allowedValues).toBe('y|py|pn|n|ni|na');
        expect(row.required).toBe(false);
      }
    });

    test('SQ の抽出指示に entity_key・回答コード・報告ベース限定の指示を含む', () => {
      const sq1_1 = ROB_TEMPLATE_ROB2_SQ.find((row) => row.fieldName === 'rob2_sq1_1');
      expect(sq1_1?.extractionInstruction).toContain('rob:d1_randomization');
      expect(sq1_1?.extractionInstruction).toContain('Was the allocation sequence random?');
      expect(sq1_1?.extractionInstruction).toContain('y (Yes)');
      expect(sq1_1?.extractionInstruction).toContain('推測やドメイン知識での補完は禁止');
      // 無条件設問なので na の案内は含まない
      expect(sq1_1?.extractionInstruction).not.toContain('条件付きです');
    });

    test('条件付き SQ の抽出指示は条件と na 回答の案内を含む', () => {
      const sq2_3 = ROB_TEMPLATE_ROB2_SQ.find((row) => row.fieldName === 'rob2_sq2_3');
      expect(sq2_3?.extractionInstruction).toContain('条件付きです');
      expect(sq2_3?.extractionInstruction).toContain('na（not applicable）と明示的に回答');
      expect(sq2_3?.extractionInstruction).toContain('2.1 または 2.2 が y / py / ni');
    });

    test('ROB2_SQ_FIELD_NAMES はドメイン別の field_name 一覧を公開し、プリセットの実際の field_name と一致する（robAlgorithm.ts と共有する契約）', () => {
      expect(ROB2_SQ_FIELD_NAMES).toEqual({
        d1_randomization: ['rob2_sq1_1', 'rob2_sq1_2', 'rob2_sq1_3'],
        d2_deviations: [
          'rob2_sq2_1',
          'rob2_sq2_2',
          'rob2_sq2_3',
          'rob2_sq2_4',
          'rob2_sq2_5',
          'rob2_sq2_6',
          'rob2_sq2_7',
        ],
        d3_missing_data: ['rob2_sq3_1', 'rob2_sq3_2', 'rob2_sq3_3', 'rob2_sq3_4'],
        d4_measurement: ['rob2_sq4_1', 'rob2_sq4_2', 'rob2_sq4_3', 'rob2_sq4_4', 'rob2_sq4_5'],
        d5_reporting: ['rob2_sq5_1', 'rob2_sq5_2', 'rob2_sq5_3'],
      });
    });

    test('プリセット単体はエディタ検証を通る', () => {
      expect(validateEditorRows(ROB_TEMPLATE_ROB2_SQ)).toEqual([]);
    });

    test('ROBINS-I と同時挿入しても field_name は衝突しない', () => {
      expect(validateEditorRows([...ROB_TEMPLATE_ROB2_SQ, ...ROB_TEMPLATE_ROBINS_I])).toEqual([]);
    });

    test('軽量版 rob2 と同時挿入すると judgement/support の field_name が衝突する（意図的な排他利用の確認）', () => {
      const errors = validateEditorRows([...ROB_TEMPLATE_ROB2, ...ROB_TEMPLATE_ROB2_SQ]);
      const duplicateNames = errors
        .filter((error) => error.message.includes('重複'))
        .map((error) => error.message);
      expect(duplicateNames).toEqual(
        expect.arrayContaining([
          expect.stringContaining('rob2_judgement'),
          expect.stringContaining('rob2_support'),
        ]),
      );
    });
  });

  describe('ROBINS-I（SQ 完全版。issue #61 PR2 = issue #87）', () => {
    test('判定 + 根拠 + SQ 34 問の計 36 項目を挿入する', () => {
      expect(ROB_TEMPLATE_ROBINS_I_SQ).toHaveLength(36);
      expect(ROB_TEMPLATE_ROBINS_I_SQ[0]?.fieldName).toBe('robins_i_judgement');
      expect(ROB_TEMPLATE_ROBINS_I_SQ[1]?.fieldName).toBe('robins_i_support');
      const sqFieldNames = ROB_TEMPLATE_ROBINS_I_SQ.slice(2).map((row) => row.fieldName);
      expect(sqFieldNames).toEqual([
        'robins_i_sq1_1',
        'robins_i_sq1_2',
        'robins_i_sq1_3',
        'robins_i_sq1_4',
        'robins_i_sq1_5',
        'robins_i_sq1_6',
        'robins_i_sq1_7',
        'robins_i_sq1_8',
        'robins_i_sq2_1',
        'robins_i_sq2_2',
        'robins_i_sq2_3',
        'robins_i_sq2_4',
        'robins_i_sq2_5',
        'robins_i_sq3_1',
        'robins_i_sq3_2',
        'robins_i_sq3_3',
        'robins_i_sq4_1',
        'robins_i_sq4_2',
        'robins_i_sq4_3',
        'robins_i_sq4_4',
        'robins_i_sq4_5',
        'robins_i_sq4_6',
        'robins_i_sq5_1',
        'robins_i_sq5_2',
        'robins_i_sq5_3',
        'robins_i_sq5_4',
        'robins_i_sq5_5',
        'robins_i_sq6_1',
        'robins_i_sq6_2',
        'robins_i_sq6_3',
        'robins_i_sq6_4',
        'robins_i_sq7_1',
        'robins_i_sq7_2',
        'robins_i_sq7_3',
      ]);
    });

    test('全項目が rob_domain レベル・専用セクション risk_of_bias_robins_i_sq に属する（judgement/support も同一セクション = 1 バッチで完結させるため）', () => {
      for (const row of ROB_TEMPLATE_ROBINS_I_SQ) {
        expect(row.entityLevel).toBe('rob_domain');
        expect(row.section).toBe('risk_of_bias_robins_i_sq');
        expect(row.fieldId).toBeNull();
        expect(row.aiGenerated).toBe(false);
      }
    });

    test('SQ 項目は enum・y|py|pn|n|ni|na・required=false', () => {
      for (const row of ROB_TEMPLATE_ROBINS_I_SQ.slice(2)) {
        expect(row.dataType).toBe('enum');
        expect(row.allowedValues).toBe('y|py|pn|n|ni|na');
        expect(row.required).toBe(false);
      }
    });

    test('判定行は 5 段階 enum（low|moderate|serious|critical|no_information）', () => {
      expect(ROB_TEMPLATE_ROBINS_I_SQ[0]).toMatchObject({
        dataType: 'enum',
        allowedValues: 'low|moderate|serious|critical|no_information',
        required: true,
      });
      expect(ROB_TEMPLATE_ROBINS_I_SQ[1]).toMatchObject({ dataType: 'text', required: false });
    });

    test('SQ の抽出指示に entity_key・回答コード・報告ベース限定の指示を含む', () => {
      const sq1_1 = ROB_TEMPLATE_ROBINS_I_SQ.find((row) => row.fieldName === 'robins_i_sq1_1');
      expect(sq1_1?.extractionInstruction).toContain('rob:d1_confounding');
      expect(sq1_1?.extractionInstruction).toContain(
        'Is there potential for confounding of the effect of intervention in this study?',
      );
      expect(sq1_1?.extractionInstruction).toContain('y (Yes)');
      expect(sq1_1?.extractionInstruction).toContain('推測やドメイン知識での補完は禁止');
      // 無条件設問なので na の案内は含まない
      expect(sq1_1?.extractionInstruction).not.toContain('条件付きです');
    });

    test('条件付き SQ の抽出指示は条件と na 回答の案内を含む', () => {
      const sq1_2 = ROB_TEMPLATE_ROBINS_I_SQ.find((row) => row.fieldName === 'robins_i_sq1_2');
      expect(sq1_2?.extractionInstruction).toContain('条件付きです');
      expect(sq1_2?.extractionInstruction).toContain('na（not applicable）と明示的に回答');
      expect(sq1_2?.extractionInstruction).toContain('1.1 が y / py');
    });

    test('ROBINS_I_SQ_FIELD_NAMES はドメイン別の field_name 一覧を公開し、プリセットの実際の field_name と一致する（robAlgorithm.ts と共有する契約）', () => {
      expect(ROBINS_I_SQ_FIELD_NAMES).toEqual({
        d1_confounding: [
          'robins_i_sq1_1',
          'robins_i_sq1_2',
          'robins_i_sq1_3',
          'robins_i_sq1_4',
          'robins_i_sq1_5',
          'robins_i_sq1_6',
          'robins_i_sq1_7',
          'robins_i_sq1_8',
        ],
        d2_selection: [
          'robins_i_sq2_1',
          'robins_i_sq2_2',
          'robins_i_sq2_3',
          'robins_i_sq2_4',
          'robins_i_sq2_5',
        ],
        d3_classification: ['robins_i_sq3_1', 'robins_i_sq3_2', 'robins_i_sq3_3'],
        d4_deviations: [
          'robins_i_sq4_1',
          'robins_i_sq4_2',
          'robins_i_sq4_3',
          'robins_i_sq4_4',
          'robins_i_sq4_5',
          'robins_i_sq4_6',
        ],
        d5_missing_data: [
          'robins_i_sq5_1',
          'robins_i_sq5_2',
          'robins_i_sq5_3',
          'robins_i_sq5_4',
          'robins_i_sq5_5',
        ],
        d6_measurement: ['robins_i_sq6_1', 'robins_i_sq6_2', 'robins_i_sq6_3', 'robins_i_sq6_4'],
        d7_reporting: ['robins_i_sq7_1', 'robins_i_sq7_2', 'robins_i_sq7_3'],
      });
    });

    test('プリセット単体はエディタ検証を通る', () => {
      expect(validateEditorRows(ROB_TEMPLATE_ROBINS_I_SQ)).toEqual([]);
    });

    test('RoB 2（軽量版）と同時挿入しても field_name は衝突しない', () => {
      expect(validateEditorRows([...ROB_TEMPLATE_ROBINS_I_SQ, ...ROB_TEMPLATE_ROB2])).toEqual([]);
    });

    test('RoB 2（SQ 完全版）と同時挿入しても field_name は衝突しない', () => {
      expect(validateEditorRows([...ROB_TEMPLATE_ROBINS_I_SQ, ...ROB_TEMPLATE_ROB2_SQ])).toEqual([]);
    });

    test('軽量版 robins_i と同時挿入すると judgement/support の field_name が衝突する（意図的な排他利用の確認）', () => {
      const errors = validateEditorRows([...ROB_TEMPLATE_ROBINS_I, ...ROB_TEMPLATE_ROBINS_I_SQ]);
      const duplicateNames = errors
        .filter((error) => error.message.includes('重複'))
        .map((error) => error.message);
      expect(duplicateNames).toEqual(
        expect.arrayContaining([
          expect.stringContaining('robins_i_judgement'),
          expect.stringContaining('robins_i_support'),
        ]),
      );
    });
  });

  describe('QUADAS-3（issue #61 PR3 = issue #88）', () => {
    test('risk-of-bias 判定 + 根拠 + 適用可能性判定 + 根拠 + SQ 20 問の計 24 項目を挿入する', () => {
      expect(ROB_TEMPLATE_QUADAS3).toHaveLength(24);
      expect(ROB_TEMPLATE_QUADAS3[0]?.fieldName).toBe('quadas3_rob_judgement');
      expect(ROB_TEMPLATE_QUADAS3[1]?.fieldName).toBe('quadas3_rob_support');
      expect(ROB_TEMPLATE_QUADAS3[2]?.fieldName).toBe('quadas3_applicability_judgement');
      expect(ROB_TEMPLATE_QUADAS3[3]?.fieldName).toBe('quadas3_applicability_support');
      const sqFieldNames = ROB_TEMPLATE_QUADAS3.slice(4).map((row) => row.fieldName);
      expect(sqFieldNames).toEqual([
        'quadas3_sq1_1',
        'quadas3_sq1_2',
        'quadas3_sq1_3',
        'quadas3_sq1_4',
        'quadas3_sq2_1',
        'quadas3_sq2_2',
        'quadas3_sq2_3',
        'quadas3_sq2_4',
        'quadas3_sq3_1',
        'quadas3_sq3_2',
        'quadas3_sq3_3',
        'quadas3_sq3_4',
        'quadas3_sq3_5',
        'quadas3_sq3_6',
        'quadas3_sq3_7',
        'quadas3_sq3_8',
        'quadas3_sq4_1',
        'quadas3_sq4_2',
        'quadas3_sq4_3',
        'quadas3_sq4_4',
      ]);
    });

    test('ドメイン定義: risk-of-bias は D1〜D4 + overall / 適用可能性は D1〜D3 + overall（Analysis を除く）', () => {
      expect(QUADAS3_DOMAINS.map((domain) => domain.id)).toEqual([
        'quadas3_d1_participants',
        'quadas3_d2_index_test',
        'quadas3_d3_target_condition',
        'quadas3_d4_analysis',
        'quadas3_overall',
      ]);
      expect(QUADAS3_APPLICABILITY_DOMAINS.map((domain) => domain.id)).toEqual([
        'quadas3_d1_participants',
        'quadas3_d2_index_test',
        'quadas3_d3_target_condition',
        'quadas3_overall',
      ]);
    });

    test('全項目が rob_domain レベル・専用セクション risk_of_bias_quadas3 に属する', () => {
      for (const row of ROB_TEMPLATE_QUADAS3) {
        expect(row.entityLevel).toBe('rob_domain');
        expect(row.section).toBe('risk_of_bias_quadas3');
        expect(row.fieldId).toBeNull();
        expect(row.aiGenerated).toBe(false);
      }
    });

    test('SQ 項目は enum・y|py|pn|n|ni|na・required=false', () => {
      for (const row of ROB_TEMPLATE_QUADAS3.slice(4)) {
        expect(row.dataType).toBe('enum');
        expect(row.allowedValues).toBe('y|py|pn|n|ni|na');
        expect(row.required).toBe(false);
      }
    });

    test('risk-of-bias 判定行は low|high|insufficient_information の 3 段階 enum・必須', () => {
      expect(ROB_TEMPLATE_QUADAS3[0]).toMatchObject({
        dataType: 'enum',
        allowedValues: 'low|high|insufficient_information',
        required: true,
      });
      expect(ROB_TEMPLATE_QUADAS3[1]).toMatchObject({ dataType: 'text', required: false });
    });

    test('適用可能性判定行は low|high|insufficient_information の 3 段階 enum・任意', () => {
      expect(ROB_TEMPLATE_QUADAS3[2]).toMatchObject({
        dataType: 'enum',
        allowedValues: 'low|high|insufficient_information',
        required: false,
      });
      expect(ROB_TEMPLATE_QUADAS3[3]).toMatchObject({ dataType: 'text', required: false });
    });

    test('SQ の抽出指示に entity_key・回答コード・報告ベース限定の指示を含む', () => {
      const sq1_1 = ROB_TEMPLATE_QUADAS3.find((row) => row.fieldName === 'quadas3_sq1_1');
      expect(sq1_1?.extractionInstruction).toContain('rob:quadas3_d1_participants');
      expect(sq1_1?.extractionInstruction).toContain('Was a single-gate design used?');
      expect(sq1_1?.extractionInstruction).toContain('y (Yes)');
      expect(sq1_1?.extractionInstruction).toContain('推測やドメイン知識での補完は禁止');
      expect(sq1_1?.extractionInstruction).not.toContain('条件付きです');
    });

    test('条件付き SQ（しきい値を用いた場合のみ）の抽出指示は条件と na 回答の案内を含む', () => {
      const sq2_4 = ROB_TEMPLATE_QUADAS3.find((row) => row.fieldName === 'quadas3_sq2_4');
      expect(sq2_4?.extractionInstruction).toContain('条件付きです');
      expect(sq2_4?.extractionInstruction).toContain('na（not applicable）と明示的に回答');
      expect(sq2_4?.extractionInstruction).toContain('しきい値を用いた場合のみ');
    });

    test('QUADAS3_SQ_FIELD_NAMES はドメイン別の field_name 一覧を公開し、プリセットの実際の field_name と一致する', () => {
      expect(QUADAS3_SQ_FIELD_NAMES).toEqual({
        quadas3_d1_participants: ['quadas3_sq1_1', 'quadas3_sq1_2', 'quadas3_sq1_3', 'quadas3_sq1_4'],
        quadas3_d2_index_test: ['quadas3_sq2_1', 'quadas3_sq2_2', 'quadas3_sq2_3', 'quadas3_sq2_4'],
        quadas3_d3_target_condition: [
          'quadas3_sq3_1',
          'quadas3_sq3_2',
          'quadas3_sq3_3',
          'quadas3_sq3_4',
          'quadas3_sq3_5',
          'quadas3_sq3_6',
          'quadas3_sq3_7',
          'quadas3_sq3_8',
        ],
        quadas3_d4_analysis: ['quadas3_sq4_1', 'quadas3_sq4_2', 'quadas3_sq4_3', 'quadas3_sq4_4'],
      });
    });

    test('全ドメインの entity_key が抽出指示に明示され、parseEntityKey で rob_domain に解決できる', () => {
      const robInstruction = ROB_TEMPLATE_QUADAS3[0]?.extractionInstruction ?? '';
      for (const domain of QUADAS3_DOMAINS) {
        const entityKey = `rob:${domain.id}`;
        expect(robInstruction).toContain(`"${entityKey}"`);
        expect(parseEntityKey(entityKey)).toEqual({ level: 'rob_domain', domain: domain.id });
      }
      const applicabilityInstruction = ROB_TEMPLATE_QUADAS3[2]?.extractionInstruction ?? '';
      for (const domain of QUADAS3_APPLICABILITY_DOMAINS) {
        expect(applicabilityInstruction).toContain(`"rob:${domain.id}"`);
      }
    });

    test('プリセット単体はエディタ検証を通る', () => {
      expect(validateEditorRows(ROB_TEMPLATE_QUADAS3)).toEqual([]);
    });

    test('RoB 2 / ROBINS-I / QUIPS と同時挿入しても field_name は衝突しない', () => {
      expect(
        validateEditorRows([
          ...ROB_TEMPLATE_QUADAS3,
          ...ROB_TEMPLATE_ROB2,
          ...ROB_TEMPLATE_ROBINS_I,
          ...ROB_TEMPLATE_QUIPS,
        ]),
      ).toEqual([]);
    });
  });

  describe('QUIPS（issue #61 PR3 = issue #88）', () => {
    test('判定 + 根拠 + prompting item 12 問の計 14 項目を挿入する（overall は無い）', () => {
      expect(ROB_TEMPLATE_QUIPS).toHaveLength(14);
      expect(ROB_TEMPLATE_QUIPS[0]?.fieldName).toBe('quips_judgement');
      expect(ROB_TEMPLATE_QUIPS[1]?.fieldName).toBe('quips_support');
      const itemFieldNames = ROB_TEMPLATE_QUIPS.slice(2).map((row) => row.fieldName);
      expect(itemFieldNames).toEqual([
        'quips_pi1_1',
        'quips_pi1_2',
        'quips_pi2_1',
        'quips_pi2_2',
        'quips_pi3_1',
        'quips_pi3_2',
        'quips_pi4_1',
        'quips_pi4_2',
        'quips_pi5_1',
        'quips_pi5_2',
        'quips_pi6_1',
        'quips_pi6_2',
      ]);
    });

    test('ドメイン定義: 6 ドメイン（overall は無い）', () => {
      expect(QUIPS_DOMAINS.map((domain) => domain.id)).toEqual([
        'quips_d1_participation',
        'quips_d2_attrition',
        'quips_d3_pf_measurement',
        'quips_d4_outcome_measurement',
        'quips_d5_confounding',
        'quips_d6_analysis_reporting',
      ]);
    });

    test('全項目が rob_domain レベル・専用セクション risk_of_bias_quips に属する', () => {
      for (const row of ROB_TEMPLATE_QUIPS) {
        expect(row.entityLevel).toBe('rob_domain');
        expect(row.section).toBe('risk_of_bias_quips');
        expect(row.fieldId).toBeNull();
        expect(row.aiGenerated).toBe(false);
      }
    });

    test('prompting item は enum・yes|partial|no|unsure・required=false', () => {
      for (const row of ROB_TEMPLATE_QUIPS.slice(2)) {
        expect(row.dataType).toBe('enum');
        expect(row.allowedValues).toBe('yes|partial|no|unsure');
        expect(row.required).toBe(false);
      }
    });

    test('判定行は high|moderate|low の 3 段階 enum・必須', () => {
      expect(ROB_TEMPLATE_QUIPS[0]).toMatchObject({
        dataType: 'enum',
        allowedValues: 'high|moderate|low',
        required: true,
      });
      expect(ROB_TEMPLATE_QUIPS[1]).toMatchObject({ dataType: 'text', required: false });
    });

    test('prompting item の抽出指示に entity_key・回答コード・報告ベース限定の指示を含む', () => {
      const item1_1 = ROB_TEMPLATE_QUIPS.find((row) => row.fieldName === 'quips_pi1_1');
      expect(item1_1?.extractionInstruction).toContain('rob:quips_d1_participation');
      expect(item1_1?.extractionInstruction).toContain(
        'There is adequate participation in the study by eligible individuals.',
      );
      expect(item1_1?.extractionInstruction).toContain('yes / partial / no / unsure');
      expect(item1_1?.extractionInstruction).toContain('do not guess');
    });

    test('QUIPS_ITEM_FIELD_NAMES はドメイン別の field_name 一覧を公開し、プリセットの実際の field_name と一致する', () => {
      expect(QUIPS_ITEM_FIELD_NAMES).toEqual({
        quips_d1_participation: ['quips_pi1_1', 'quips_pi1_2'],
        quips_d2_attrition: ['quips_pi2_1', 'quips_pi2_2'],
        quips_d3_pf_measurement: ['quips_pi3_1', 'quips_pi3_2'],
        quips_d4_outcome_measurement: ['quips_pi4_1', 'quips_pi4_2'],
        quips_d5_confounding: ['quips_pi5_1', 'quips_pi5_2'],
        quips_d6_analysis_reporting: ['quips_pi6_1', 'quips_pi6_2'],
      });
    });

    test('全ドメインの entity_key が抽出指示に明示され、parseEntityKey で rob_domain に解決できる', () => {
      const instruction = ROB_TEMPLATE_QUIPS[0]?.extractionInstruction ?? '';
      for (const domain of QUIPS_DOMAINS) {
        const entityKey = `rob:${domain.id}`;
        expect(instruction).toContain(`"${entityKey}"`);
        expect(parseEntityKey(entityKey)).toEqual({ level: 'rob_domain', domain: domain.id });
      }
    });

    test('プリセット単体はエディタ検証を通る', () => {
      expect(validateEditorRows(ROB_TEMPLATE_QUIPS)).toEqual([]);
    });

    test('RoB 2 / ROBINS-I / QUADAS-3 と同時挿入しても field_name は衝突しない', () => {
      expect(
        validateEditorRows([
          ...ROB_TEMPLATE_QUIPS,
          ...ROB_TEMPLATE_ROB2,
          ...ROB_TEMPLATE_ROBINS_I,
          ...ROB_TEMPLATE_QUADAS3,
        ]),
      ).toEqual([]);
    });
  });
});
