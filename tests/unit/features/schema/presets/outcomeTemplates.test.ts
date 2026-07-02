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

  test('連続: mean / sd / n の 3 項目', () => {
    expect(OUTCOME_TEMPLATE_CONTINUOUS.map((row) => row.fieldName)).toEqual([
      'outcome_mean',
      'outcome_sd',
      'outcome_n',
    ]);
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
