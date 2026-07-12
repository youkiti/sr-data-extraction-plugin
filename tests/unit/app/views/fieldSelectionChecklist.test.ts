import {
  fieldSelectionSummaryText,
  hasZeroFieldsSelected,
  renderFieldSelectionChecklist,
  type FieldSelectionChecklistProps,
} from '../../../../src/app/views/fieldSelectionChecklist';
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

const FIELDS: SchemaField[] = [
  makeField({ fieldId: 'f-1', section: 'methods', fieldLabel: '総サンプルサイズ', fieldName: 'sample_size_total' }),
  makeField({ fieldId: 'f-2', section: 'methods', fieldLabel: '対象年齢', fieldName: 'age' }),
  makeField({ fieldId: 'f-3', section: 'results', fieldLabel: '死亡率', fieldName: 'mortality_pct' }),
];

function makeProps(overrides: Partial<FieldSelectionChecklistProps> = {}): FieldSelectionChecklistProps {
  return {
    idPrefix: 'extract',
    fields: FIELDS,
    selection: null,
    collapsedSections: [],
    onToggleField: jest.fn(),
    onToggleSection: jest.fn(),
    onToggleCollapse: jest.fn(),
    ...overrides,
  };
}

describe('hasZeroFieldsSelected / fieldSelectionSummaryText', () => {
  test('全選択（null）は 0 件ではなく「全項目（m）」を返す', () => {
    expect(hasZeroFieldsSelected(null, FIELDS)).toBe(false);
    expect(fieldSelectionSummaryText(null, FIELDS)).toBe('全項目（3）');
  });

  test('サブセット選択は選択数を返す', () => {
    expect(hasZeroFieldsSelected(['f-1'], FIELDS)).toBe(false);
    expect(fieldSelectionSummaryText(['f-1'], FIELDS)).toBe('1 / 3');
  });

  test('選択 0 件は true', () => {
    expect(hasZeroFieldsSelected([], FIELDS)).toBe(true);
    expect(fieldSelectionSummaryText([], FIELDS)).toBe('0 / 3');
  });
});

describe('renderFieldSelectionChecklist', () => {
  test('section ごとにグルーピングし、既定（全選択）は各チェックボックスが checked', () => {
    const props = makeProps();
    const root = renderFieldSelectionChecklist(props);
    document.body.replaceChildren(root);

    const sections = root.querySelectorAll('.extract__field-section');
    expect(sections).toHaveLength(2); // methods / results
    const checkboxes = root.querySelectorAll<HTMLInputElement>('.extract__field-checkbox');
    expect(checkboxes).toHaveLength(3);
    checkboxes.forEach((box) => expect(box.checked).toBe(true));

    // field ラベル + field_name の表示
    expect(root.querySelector('.extract__field-label')?.textContent).toBe('総サンプルサイズ');
    expect(root.querySelector('.extract__field-name')?.textContent).toBe('sample_size_total');

    // 全体サマリ（全選択時は「全項目（m）」）
    expect(root.querySelector('#extract-field-summary')?.textContent).toBe('対象項目: 全項目（3）');
    // 選択 0 件でなければエラーは出さない
    expect(root.querySelector('#extract-field-error')).toBeNull();
  });

  test('チェックボックスの切替で onToggleField を呼ぶ', () => {
    const onToggleField = jest.fn();
    const root = renderFieldSelectionChecklist(makeProps({ onToggleField }));
    document.body.replaceChildren(root);
    const checkbox = root.querySelector<HTMLInputElement>('.extract__field-checkbox');
    checkbox!.checked = false;
    checkbox!.dispatchEvent(new Event('change'));
    expect(onToggleField).toHaveBeenCalledWith('f-1', false);
  });

  test('section 見出しの「全選択/全解除」トグル: 未充足は全選択・充足済みは全解除', () => {
    const onToggleSection = jest.fn();
    // methods section は f-1 のみ選択（部分選択）
    const root = renderFieldSelectionChecklist(
      makeProps({ selection: ['f-1'], onToggleSection }),
    );
    document.body.replaceChildren(root);
    const toggles = root.querySelectorAll<HTMLButtonElement>('.extract__field-section-toggle');
    // methods（部分選択） → 「全選択」
    expect(toggles[0]?.textContent).toBe('全選択');
    // results（f-3 は未選択） → 「全選択」
    expect(toggles[1]?.textContent).toBe('全選択');
    toggles[0]!.click();
    expect(onToggleSection).toHaveBeenCalledWith(['f-1', 'f-2'], true);

    // section 内が全選択済みなら「全解除」を出す
    const fullRoot = renderFieldSelectionChecklist(
      makeProps({ selection: ['f-1', 'f-2'], onToggleSection }),
    );
    document.body.replaceChildren(fullRoot);
    const fullToggle = fullRoot.querySelector<HTMLButtonElement>('.extract__field-section-toggle');
    expect(fullToggle?.textContent).toBe('全解除');
    fullToggle!.click();
    expect(onToggleSection).toHaveBeenCalledWith(['f-1', 'f-2'], false);
  });

  test('section 見出しの選択数カウント表示', () => {
    const root = renderFieldSelectionChecklist(makeProps({ selection: ['f-1'] }));
    document.body.replaceChildren(root);
    const counts = root.querySelectorAll('.extract__field-section-count');
    expect(counts[0]?.textContent).toBe('選択 1 / 全 2'); // methods: f-1 のみ
    expect(counts[1]?.textContent).toBe('選択 0 / 全 1'); // results: 0 件
  });

  test('折りたたみ: 既定は展開（aria-expanded=true）、折りたたみ中は一覧を hidden にする', () => {
    const onToggleCollapse = jest.fn();
    const root = renderFieldSelectionChecklist(
      makeProps({ collapsedSections: ['methods'], onToggleCollapse }),
    );
    document.body.replaceChildren(root);
    const collapseButtons = root.querySelectorAll<HTMLButtonElement>('.extract__field-collapse');
    expect(collapseButtons[0]?.getAttribute('aria-expanded')).toBe('false');
    expect(collapseButtons[0]?.textContent).toContain('▸');
    expect(collapseButtons[1]?.getAttribute('aria-expanded')).toBe('true');
    expect(collapseButtons[1]?.textContent).toContain('▾');

    const lists = root.querySelectorAll<HTMLUListElement>('.extract__field-list');
    expect(lists[0]?.hidden).toBe(true);
    expect(lists[1]?.hidden).toBe(false);

    collapseButtons[0]!.click();
    expect(onToggleCollapse).toHaveBeenCalledWith('methods');
  });

  test('選択 0 件は対象項目の下にエラーメッセージを role=alert で出す', () => {
    const root = renderFieldSelectionChecklist(makeProps({ selection: [] }));
    document.body.replaceChildren(root);
    const error = root.querySelector('#extract-field-error');
    expect(error?.getAttribute('role')).toBe('alert');
    expect(error?.textContent).toBe('抽出対象の項目を 1 つ以上選択してください');
    expect(root.querySelector('#extract-field-summary')?.textContent).toBe('対象項目: 0 / 3');
  });

  test('idPrefix が pilot のときは pilot__ クラスと pilot- id を使う', () => {
    const root = renderFieldSelectionChecklist(makeProps({ idPrefix: 'pilot' }));
    document.body.replaceChildren(root);
    expect(root.id).toBe('pilot-fields');
    expect(root.querySelector('.pilot__field-section')).not.toBeNull();
    expect(root.querySelector('#pilot-field-summary')).not.toBeNull();
  });
});
