import {
  ROB2_DOMAINS,
  ROBINS_I_DOMAINS,
  ROB_TEMPLATE_ROB2,
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
    expect(SCHEMA_PRESETS).toEqual({ ...OUTCOME_TEMPLATES, ...ROB_TEMPLATES });
  });
});
