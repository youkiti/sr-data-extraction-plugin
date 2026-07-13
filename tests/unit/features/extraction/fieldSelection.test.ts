import {
  filterFieldsBySelection,
  groupFieldsBySection,
  isFieldSelected,
  isSectionFullySelected,
  resolveFieldIdsForRun,
  selectedFieldCount,
  toggleCollapsedSection,
  toggleFieldSection,
  toggleFieldSelection,
} from '../../../../src/features/extraction/fieldSelection';
import type { SchemaField } from '../../../../src/domain/schemaField';

function makeField(overrides: Partial<SchemaField> = {}): SchemaField {
  return {
    schemaVersion: 1,
    fieldId: 'f-1',
    fieldIndex: 1,
    section: 'methods',
    fieldName: 'sample_size_total',
    fieldLabel: '総サンプルサイズ',
    entityLevel: 'study',
    dataType: 'integer',
    unit: null,
    allowedValues: null,
    required: true,
    extractionInstruction: '総 N を抽出',
    example: null,
    aiGenerated: false,
    note: null,
    ...overrides,
  };
}

const ALL_IDS = ['f-1', 'f-2', 'f-3'];

describe('isFieldSelected / selectedFieldCount', () => {
  test('null（全選択）は常に true・件数は全件', () => {
    expect(isFieldSelected(null, 'f-1')).toBe(true);
    expect(selectedFieldCount(null, ALL_IDS)).toBe(3);
  });

  test('非 null は含むかどうか・件数は配列長', () => {
    expect(isFieldSelected(['f-1'], 'f-1')).toBe(true);
    expect(isFieldSelected(['f-1'], 'f-2')).toBe(false);
    expect(selectedFieldCount(['f-1', 'f-2'], ALL_IDS)).toBe(2);
    expect(selectedFieldCount([], ALL_IDS)).toBe(0);
  });
});

describe('isSectionFullySelected', () => {
  test('全選択（null）は常に true', () => {
    expect(isSectionFullySelected(null, ['f-1', 'f-2'])).toBe(true);
  });

  test('section 内の全 field が選択済みなら true、一部でも欠ければ false', () => {
    expect(isSectionFullySelected(['f-1', 'f-2', 'f-3'], ['f-1', 'f-2'])).toBe(true);
    expect(isSectionFullySelected(['f-1'], ['f-1', 'f-2'])).toBe(false);
    expect(isSectionFullySelected([], ['f-1'])).toBe(false);
  });
});

describe('toggleFieldSelection', () => {
  test('null（全選択）から 1 件解除すると残り全件の配列になる', () => {
    const result = toggleFieldSelection(null, ALL_IDS, 'f-2', false);
    expect(result).not.toBeNull();
    expect([...(result ?? [])].sort()).toEqual(['f-1', 'f-3']);
  });

  test('配列から選択追加し、全件そろったら null（全選択）へ正規化する', () => {
    const result = toggleFieldSelection(['f-1', 'f-2'], ALL_IDS, 'f-3', true);
    expect(result).toBeNull();
  });

  test('配列から選択追加（未充足）はそのまま配列を返す', () => {
    const result = toggleFieldSelection(['f-1'], ALL_IDS, 'f-2', true);
    expect([...(result ?? [])].sort()).toEqual(['f-1', 'f-2']);
  });

  test('配列から選択解除（既に含まれない field）は変化しない', () => {
    const result = toggleFieldSelection(['f-1'], ALL_IDS, 'f-2', false);
    expect(result).toEqual(['f-1']);
  });
});

describe('toggleFieldSection', () => {
  test('section 全選択: null（全選択）から一部解除した状態へ section 全解除すると残りだけになる', () => {
    const afterDeselectOne = toggleFieldSelection(null, ALL_IDS, 'f-3', false); // ['f-1', 'f-2']
    const result = toggleFieldSection(afterDeselectOne, ALL_IDS, ['f-1', 'f-2'], false);
    expect(result).toEqual([]);
  });

  test('section 全選択で全 field がそろえば null へ正規化する', () => {
    const result = toggleFieldSection([], ALL_IDS, ALL_IDS, true);
    expect(result).toBeNull();
  });

  test('section 単位の部分選択', () => {
    const result = toggleFieldSection(null, ALL_IDS, ['f-1', 'f-2'], false);
    expect(result).toEqual(['f-3']);
  });
});

describe('toggleCollapsedSection', () => {
  test('未折りたたみの section を追加し、既に折りたたみ中なら解除する', () => {
    const collapsed = toggleCollapsedSection([], 'methods');
    expect(collapsed).toEqual(['methods']);
    const expanded = toggleCollapsedSection(collapsed, 'methods');
    expect(expanded).toEqual([]);
  });

  test('他の section は維持したまま対象だけ切替える', () => {
    const result = toggleCollapsedSection(['methods'], 'results');
    expect(result).toEqual(['methods', 'results']);
  });
});

describe('resolveFieldIdsForRun', () => {
  test('null（全選択）は null をそのまま返す', () => {
    expect(resolveFieldIdsForRun(null)).toBeNull();
  });

  test('非 null は配列のコピーを返す', () => {
    const selection = ['f-1', 'f-2'];
    const result = resolveFieldIdsForRun(selection);
    expect(result).toEqual(['f-1', 'f-2']);
    expect(result).not.toBe(selection);
  });
});

describe('filterFieldsBySelection', () => {
  const fields = [makeField({ fieldId: 'f-1' }), makeField({ fieldId: 'f-2' }), makeField({ fieldId: 'f-3' })];

  test('null（全選択）は全件のコピーを返す', () => {
    const result = filterFieldsBySelection(fields, null);
    expect(result).toEqual(fields);
    expect(result).not.toBe(fields);
  });

  test('非 null は該当 field_id だけへ絞り込み、fields の並び順を維持する', () => {
    const result = filterFieldsBySelection(fields, ['f-3', 'f-1']);
    expect(result.map((field) => field.fieldId)).toEqual(['f-1', 'f-3']);
  });
});

describe('groupFieldsBySection', () => {
  test('section の初出順にグルーピングし、field の並び順は維持する', () => {
    const fields = [
      makeField({ fieldId: 'f-1', section: 'methods' }),
      makeField({ fieldId: 'f-2', section: 'results' }),
      makeField({ fieldId: 'f-3', section: 'methods' }),
    ];
    const groups = groupFieldsBySection(fields);
    expect(groups.map((group) => group.section)).toEqual(['methods', 'results']);
    expect(groups[0]?.fields.map((field) => field.fieldId)).toEqual(['f-1', 'f-3']);
    expect(groups[1]?.fields.map((field) => field.fieldId)).toEqual(['f-2']);
  });

  test('空配列は空配列を返す', () => {
    expect(groupFieldsBySection([])).toEqual([]);
  });
});
