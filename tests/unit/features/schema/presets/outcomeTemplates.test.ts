import {
  OUTCOME_TEMPLATE_BINARY,
  OUTCOME_TEMPLATE_CONTINUOUS,
  OUTCOME_TEMPLATES,
} from '../../../../../src/features/schema/presets/outcomeTemplates';
import { validateEditorRows } from '../../../../../src/features/schema/validateField';

describe('outcomeTemplates', () => {
  test('二値: events / total の 2 項目（outcome_result・integer・必須）', () => {
    expect(OUTCOME_TEMPLATE_BINARY.map((row) => row.fieldName)).toEqual([
      'outcome_events',
      'outcome_total',
    ]);
    for (const row of OUTCOME_TEMPLATE_BINARY) {
      expect(row).toMatchObject({
        fieldId: null,
        section: 'outcomes',
        entityLevel: 'outcome_result',
        dataType: 'integer',
        required: true,
        aiGenerated: false,
      });
    }
  });

  test('連続: mean / 報告単位 / sd / se / ci 3 種 / median + IQR / range / n の 13 項目（issue #43: SD 未報告時の代替統計量の構造化・issue #76: 報告単位の捕捉）', () => {
    expect(OUTCOME_TEMPLATE_CONTINUOUS.map((row) => row.fieldName)).toEqual([
      'outcome_mean',
      'outcome_unit_reported',
      'outcome_sd',
      'outcome_se',
      'outcome_ci_lower',
      'outcome_ci_upper',
      'outcome_ci_level',
      'outcome_median',
      'outcome_q1',
      'outcome_q3',
      'outcome_min',
      'outcome_max',
      'outcome_n',
    ]);
  });

  test('連続: 代替統計量 9 項目は float・required=false（該当報告時のみ）', () => {
    const optionalFloatNames = [
      'outcome_se',
      'outcome_ci_lower',
      'outcome_ci_upper',
      'outcome_ci_level',
      'outcome_median',
      'outcome_q1',
      'outcome_q3',
      'outcome_min',
      'outcome_max',
    ];
    // outcome_unit_reported は required=false だが text 型（issue #76）のため別枠で扱う
    const requiredFalseNonFloatNames = ['outcome_unit_reported'];
    for (const row of OUTCOME_TEMPLATE_CONTINUOUS) {
      if (optionalFloatNames.includes(row.fieldName)) {
        expect(row).toMatchObject({ dataType: 'float', required: false });
      } else if (requiredFalseNonFloatNames.includes(row.fieldName)) {
        expect(row.required).toBe(false);
      } else {
        expect(row.required).toBe(true);
      }
    }
  });

  test('連続: outcome_unit_reported は text・required=false で報告単位をそのまま記録する指示を持つ（issue #76）', () => {
    const unitRow = OUTCOME_TEMPLATE_CONTINUOUS.find((row) => row.fieldName === 'outcome_unit_reported');
    expect(unitRow).toMatchObject({
      section: 'outcomes',
      entityLevel: 'outcome_result',
      dataType: 'text',
      required: false,
      aiGenerated: false,
    });
    expect(unitRow?.extractionInstruction).toContain('not_reported');
    expect(unitRow?.example).toBe('mmHg');
  });

  test('連続: outcome_sd は SD 換算を禁じ代替項目へ誘導する指示を持つ', () => {
    const sdRow = OUTCOME_TEMPLATE_CONTINUOUS.find((row) => row.fieldName === 'outcome_sd');
    expect(sdRow?.extractionInstruction).toContain('Never compute SD from SE, CI, IQR or range');
    expect(sdRow?.extractionInstruction).toContain('outcome_ci_lower');
    expect(sdRow?.extractionInstruction).toContain('outcome_q1');
  });

  test('連続: outcome_mean は median のみ報告時に outcome_median へ誘導する指示を持つ', () => {
    const meanRow = OUTCOME_TEMPLATE_CONTINUOUS.find((row) => row.fieldName === 'outcome_mean');
    expect(meanRow?.extractionInstruction).toContain('outcome_median');
  });

  test('プリセット単体はエディタ検証を通る（挿入後の重複はエディタ側で検出）', () => {
    expect(validateEditorRows(OUTCOME_TEMPLATE_BINARY)).toEqual([]);
    expect(validateEditorRows(OUTCOME_TEMPLATE_CONTINUOUS)).toEqual([]);
  });

  test('UI のボタンと 1:1 のマップを公開する', () => {
    expect(OUTCOME_TEMPLATES.binary).toBe(OUTCOME_TEMPLATE_BINARY);
    expect(OUTCOME_TEMPLATES.continuous).toBe(OUTCOME_TEMPLATE_CONTINUOUS);
  });
});
