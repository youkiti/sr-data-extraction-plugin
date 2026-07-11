import type { SchemaEditorRow } from '../../../../src/features/schema/types';
import { validateEditorRows } from '../../../../src/features/schema/validateField';

function makeRow(overrides: Partial<SchemaEditorRow> = {}): SchemaEditorRow {
  return {
    fieldId: null,
    section: 'methods',
    fieldName: 'study_design',
    fieldLabel: '研究デザイン',
    entityLevel: 'study',
    dataType: 'text',
    unit: null,
    allowedValues: null,
    required: true,
    extractionInstruction: 'Report the study design as stated.',
    example: null,
    aiGenerated: true,
    note: null,
    ...overrides,
  };
}

describe('validateEditorRows', () => {
  test('妥当な行はエラーなし', () => {
    expect(validateEditorRows([makeRow()])).toEqual([]);
  });

  test('field_name: 空・snake_case 違反・予約語（StudyData 固定列）を検出する', () => {
    const errors = validateEditorRows([
      makeRow({ fieldName: '' }),
      makeRow({ fieldName: 'SampleSize' }),
      makeRow({ fieldName: '1st_outcome' }),
      makeRow({ fieldName: 'study_id' }),
    ]);
    expect(errors.map((e) => [e.index, e.column])).toEqual([
      [0, 'fieldName'],
      [1, 'fieldName'],
      [2, 'fieldName'],
      [3, 'fieldName'],
    ]);
    expect(errors[0]?.message).toBe('field_name は必須です');
    expect(errors[1]?.message).toContain('snake_case');
    expect(errors[3]?.message).toBe(
      '"study_id" はシステムが使う StudyData の固定列名のため項目名に使えません。' +
        '別名（例: "study_id_reported"）へ変更してください',
    );
  });

  test('field_name の行間重複を両方の行で検出する', () => {
    const errors = validateEditorRows([
      makeRow({ fieldName: 'total_n' }),
      makeRow({ fieldName: 'total_n' }),
    ]);
    expect(errors).toHaveLength(2);
    expect(errors.every((e) => e.column === 'fieldName')).toBe(true);
    expect(errors[0]?.message).toContain('重複');
  });

  test('field_label / section / extraction_instruction の必須を検出する', () => {
    const errors = validateEditorRows([
      makeRow({ fieldLabel: ' ', section: '', extractionInstruction: '\n' }),
    ]);
    expect(errors.map((e) => e.column).sort()).toEqual([
      'extractionInstruction',
      'fieldLabel',
      'section',
    ]);
  });

  test('enum: 許容値なし・1 値のみ・空要素をエラーにする', () => {
    const cases: (string | null)[] = [null, 'only_one', 'a||b'];
    for (const allowedValues of cases) {
      const errors = validateEditorRows([makeRow({ dataType: 'enum', allowedValues })]);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.column).toBe('allowedValues');
    }
    expect(
      validateEditorRows([makeRow({ dataType: 'enum', allowedValues: 'rct|observational' })]),
    ).toEqual([]);
  });

  test('enum 以外で許容値を指定するとエラー（空白のみは許容）', () => {
    expect(validateEditorRows([makeRow({ dataType: 'text', allowedValues: 'a|b' })])).toHaveLength(
      1,
    );
    expect(validateEditorRows([makeRow({ dataType: 'text', allowedValues: '  ' })])).toEqual([]);
  });
});
