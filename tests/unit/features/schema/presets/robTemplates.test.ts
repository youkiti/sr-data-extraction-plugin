import {
  ROB2_DOMAINS,
  ROB2_SQ_FIELD_NAMES,
  ROBINS_I_DOMAINS,
  ROB_TEMPLATE_ROB2,
  ROB_TEMPLATE_ROB2_SQ,
  ROB_TEMPLATE_ROBINS_I,
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
});
