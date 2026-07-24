// AI 再ドラフト差分ロジック（issue #197 Chunk A）のテスト
import {
  applyRedraftDiff,
  buildRedraftDiff,
  defaultRedraftSelection,
  isRedraftSelectionPristine,
  type RedraftDiff,
  type RedraftSelection,
} from '../../../../src/features/schema/redraftDiff';
import type { SchemaField } from '../../../../src/domain/schemaField';
import type { SchemaEditorRow } from '../../../../src/features/schema/types';

function makeField(overrides: Partial<SchemaField> = {}): SchemaField {
  return {
    schemaVersion: 1,
    fieldId: 'f-1',
    fieldIndex: 1,
    section: 'methods',
    fieldName: 'study_design',
    fieldLabel: '研究デザイン',
    entityLevel: 'study',
    dataType: 'text',
    unit: null,
    allowedValues: null,
    required: true,
    extractionInstruction: 'Report the design.',
    example: null,
    aiGenerated: true,
    note: null,
    ...overrides,
  };
}

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
    extractionInstruction: 'Report the design.',
    example: null,
    aiGenerated: true,
    note: null,
    ...overrides,
  };
}

describe('buildRedraftDiff', () => {
  test('current にのみ存在する項目は removed、drafted にのみ存在する項目は added', () => {
    const current = [makeField({ fieldName: 'sample_size', fieldId: 'f-1' })];
    const drafted = [makeRow({ fieldName: 'country' })];
    const diff = buildRedraftDiff(current, drafted);
    expect(diff.removed).toEqual([{ current: current[0] }]);
    expect(diff.added).toEqual([{ row: drafted[0] }]);
    expect(diff.changed).toEqual([]);
    expect(diff.unchanged).toEqual([]);
    expect(diff.protectedFields).toEqual([]);
  });

  test('両方に同名で全属性一致 → unchanged', () => {
    const field = makeField({ fieldName: 'sample_size' });
    const row = makeRow({ fieldName: 'sample_size', fieldId: null, aiGenerated: false, note: 'メモ' });
    const diff = buildRedraftDiff([field], [row]);
    expect(diff.unchanged).toEqual([field]);
    expect(diff.changed).toEqual([]);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
  });

  test('比較対象の 9 属性すべての差分を検出し、宣言順で changes に入れる', () => {
    const field = makeField({
      fieldId: 'f-9',
      section: 'population',
      fieldLabel: 'ラベル旧',
      entityLevel: 'study',
      dataType: 'text',
      unit: null,
      allowedValues: null,
      required: false,
      extractionInstruction: '旧指示',
      example: null,
    });
    const row = makeRow({
      fieldName: field.fieldName,
      section: 'outcomes',
      fieldLabel: 'ラベル新',
      entityLevel: 'arm',
      dataType: 'enum',
      unit: 'mg',
      allowedValues: 'a|b',
      required: true,
      extractionInstruction: '新指示',
      example: '例1',
    });
    const diff = buildRedraftDiff([field], [row]);
    expect(diff.changed).toHaveLength(1);
    const item = diff.changed[0];
    expect(item?.current).toBe(field);
    expect(item?.proposed).toBe(row);
    expect(item?.changes.map((c) => c.key)).toEqual([
      'section',
      'fieldLabel',
      'entityLevel',
      'dataType',
      'unit',
      'allowedValues',
      'required',
      'extractionInstruction',
      'example',
    ]);
    expect(item?.changes[0]).toEqual({ key: 'section', before: 'population', after: 'outcomes' });
    expect(item?.changes[6]).toEqual({ key: 'required', before: 'false', after: 'true' });
  });

  test('required だけが異なる場合は required の 1 件だけ changes に入る', () => {
    const field = makeField({ required: false });
    const row = makeRow({ required: true });
    const diff = buildRedraftDiff([field], [row]);
    expect(diff.changed[0]?.changes).toEqual([{ key: 'required', before: 'false', after: 'true' }]);
  });

  test('entityLevel が rob_domain の現行項目は保護行として除外する', () => {
    const protectedField = makeField({ fieldName: 'rob2_judgement', entityLevel: 'rob_domain', section: 'risk_of_bias' });
    const normalField = makeField({ fieldName: 'sample_size' });
    const diff = buildRedraftDiff([protectedField, normalField], [makeRow({ fieldName: 'country' })]);
    expect(diff.protectedFields).toEqual([protectedField]);
    expect(diff.removed).toEqual([{ current: normalField }]);
  });

  test('section が risk_of_bias で始まる現行項目は entityLevel を問わず保護行として除外する（QUADAS-3 Phase 3〜4 想定）', () => {
    const protectedField = makeField({
      fieldName: 'quadas3_phase3_note',
      entityLevel: 'study',
      section: 'risk_of_bias_quadas3',
    });
    const diff = buildRedraftDiff([protectedField], []);
    expect(diff.protectedFields).toEqual([protectedField]);
    expect(diff.removed).toEqual([]);
  });

  test('保護行と同名の AI 提案は捨てられ、added にも changed にも現れない', () => {
    const protectedField = makeField({ fieldName: 'rob2_judgement', entityLevel: 'rob_domain', section: 'risk_of_bias' });
    const proposalSameName = makeRow({ fieldName: 'rob2_judgement', fieldLabel: 'AI 提案版' });
    const diff = buildRedraftDiff([protectedField], [proposalSameName]);
    expect(diff.added).toEqual([]);
    expect(diff.changed).toEqual([]);
    expect(diff.protectedFields).toEqual([protectedField]);
  });

  test('drafted 内の同名重複は先頭の 1 件を採用する', () => {
    const first = makeRow({ fieldName: 'country', fieldLabel: '1件目' });
    const second = makeRow({ fieldName: 'country', fieldLabel: '2件目' });
    const diff = buildRedraftDiff([], [first, second]);
    expect(diff.added).toEqual([{ row: first }]);
  });

  test('field_name の前後空白は trim して突き合わせる', () => {
    const field = makeField({ fieldName: 'sample_size' });
    const row = makeRow({ fieldName: '  sample_size  ' });
    const diff = buildRedraftDiff([field], [row]);
    expect(diff.unchanged).toEqual([field]);
    expect(diff.changed).toEqual([]);
    expect(diff.removed).toEqual([]);
  });

  test('added / changed / removed / unchanged は入力順を保つ', () => {
    const fieldA = makeField({ fieldId: 'a', fieldName: 'a_field', fieldIndex: 1 });
    const fieldB = makeField({ fieldId: 'b', fieldName: 'b_field', fieldIndex: 2, required: true });
    const fieldC = makeField({ fieldId: 'c', fieldName: 'c_field', fieldIndex: 3 });
    const rowB = makeRow({ fieldName: 'b_field', required: false });
    const rowD = makeRow({ fieldName: 'd_field' });
    const rowE = makeRow({ fieldName: 'e_field' });
    const diff = buildRedraftDiff([fieldA, fieldB, fieldC], [rowD, rowB, rowE]);
    expect(diff.removed.map((r) => r.current.fieldName)).toEqual(['a_field', 'c_field']);
    expect(diff.changed.map((c) => c.current.fieldName)).toEqual(['b_field']);
    expect(diff.added.map((a) => a.row.fieldName)).toEqual(['d_field', 'e_field']);
  });

  test('current・drafted がともに空なら全フィールドが空配列', () => {
    const diff = buildRedraftDiff([], []);
    expect(diff).toMatchObject({
      added: [],
      changed: [],
      removed: [],
      unchanged: [],
      protectedFields: [],
    });
    expect(diff.currentEntries).toEqual([]);
  });

  test('section / fieldLabel / extractionInstruction は trim してから比較する（前後空白だけの差は unchanged。レビュー指摘 1-a）', () => {
    const field = makeField({
      fieldName: 'sample_size',
      section: 'methods',
      fieldLabel: 'ラベル',
      extractionInstruction: '指示文',
    });
    const row = makeRow({
      fieldName: 'sample_size',
      section: '  methods  ',
      fieldLabel: '  ラベル  ',
      extractionInstruction: '  指示文  ',
    });
    const diff = buildRedraftDiff([field], [row]);
    expect(diff.unchanged).toEqual([field]);
    expect(diff.changed).toEqual([]);
  });

  test('非 enum の allowedValues は保存時に破棄される規約に合わせ、AI 提案が allowed_values を返しても差分にしない（レビュー指摘 1-b）', () => {
    const field = makeField({
      fieldName: 'sample_size',
      dataType: 'text',
      allowedValues: null,
    });
    const row = makeRow({
      fieldName: 'sample_size',
      dataType: 'text',
      allowedValues: 'a|b',
    });
    const diff = buildRedraftDiff([field], [row]);
    expect(diff.unchanged).toEqual([field]);
    expect(diff.changed).toEqual([]);
  });

  test('enum どうしの allowedValues の実差分は引き続き検出する', () => {
    const field = makeField({ fieldName: 'severity', dataType: 'enum', allowedValues: 'low|high' });
    const row = makeRow({ fieldName: 'severity', dataType: 'enum', allowedValues: 'low|mid|high' });
    const diff = buildRedraftDiff([field], [row]);
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0]?.changes).toEqual([
      { key: 'allowedValues', before: 'low|high', after: 'low|mid|high' },
    ]);
  });

  test('current に同名 field_name が複数あっても取りこぼさない（レビュー指摘 1-c）', () => {
    const first = makeField({ fieldId: 'f-1', fieldName: 'dup_field', fieldIndex: 1, required: false });
    const second = makeField({ fieldId: 'f-2', fieldName: 'dup_field', fieldIndex: 2, required: false });
    const row = makeRow({ fieldName: 'dup_field', required: true });
    const diff = buildRedraftDiff([first, second], [row]);
    // 先着 1 件（first）だけが drafted の提案を消費して changed になり、
    // 2 件目（second）は提案が残っていないため removed になる（重複耐性の仕様）
    expect(diff.changed).toEqual([{ current: first, proposed: row, changes: [{ key: 'required', before: 'false', after: 'true' }] }]);
    expect(diff.removed).toEqual([{ current: second }]);
    expect(diff.added).toEqual([]);
    expect(diff.currentEntries).toEqual([
      { kind: 'changed', item: diff.changed[0] },
      { kind: 'removed', item: diff.removed[0] },
    ]);
  });
});

describe('defaultRedraftSelection', () => {
  test('added / changed は true、removed は false を既定にする', () => {
    const diff: RedraftDiff = buildRedraftDiff(
      [
        makeField({ fieldName: 'removed_field' }),
        makeField({ fieldName: 'changed_field', required: false }),
      ],
      [makeRow({ fieldName: 'changed_field', required: true }), makeRow({ fieldName: 'added_field' })],
    );
    const selection = defaultRedraftSelection(diff);
    expect(selection).toEqual({
      added: { added_field: true },
      changed: { changed_field: true },
      removed: { removed_field: false },
    });
  });

  test('空の diff なら全カテゴリが空オブジェクト', () => {
    const diff = buildRedraftDiff([], []);
    expect(defaultRedraftSelection(diff)).toEqual({ added: {}, changed: {}, removed: {} });
  });
});

describe('applyRedraftDiff', () => {
  test('protectedFields と unchanged は現行値のまま、現行版の並び順を維持する', () => {
    const protectedField = makeField({ fieldName: 'rob2_judgement', entityLevel: 'rob_domain', section: 'risk_of_bias', fieldIndex: 1 });
    const unchangedField = makeField({ fieldName: 'sample_size', fieldId: 'f-unchanged', fieldIndex: 2 });
    const current = [protectedField, unchangedField];
    const drafted = [makeRow({ fieldName: 'sample_size' })];
    const diff = buildRedraftDiff(current, drafted);
    const selection = defaultRedraftSelection(diff);
    const rows = applyRedraftDiff(diff, selection);
    expect(rows.map((r) => r.fieldName)).toEqual(['rob2_judgement', 'sample_size']);
    expect(rows[0]?.fieldId).toBe(protectedField.fieldId);
    expect(rows[1]?.fieldId).toBe('f-unchanged');
  });

  test('changed で承認(true)すると AI 提案の属性を採用しつつ fieldId / note は現行値を維持し aiGenerated は true になる', () => {
    const field = makeField({
      fieldId: 'f-changed',
      fieldName: 'sample_size',
      fieldLabel: '旧ラベル',
      required: false,
      note: '既存メモ',
      aiGenerated: false,
    });
    const row = makeRow({ fieldName: 'sample_size', fieldLabel: '新ラベル', required: true, note: null });
    const diff = buildRedraftDiff([field], [row]);
    const selection: RedraftSelection = { added: {}, changed: { sample_size: true }, removed: {} };
    const rows = applyRedraftDiff(diff, selection);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      ...row,
      fieldId: 'f-changed',
      note: '既存メモ',
      aiGenerated: true,
    });
  });

  test('changed で非承認(false)なら現行値のまま(aiGenerated も現行値)残る', () => {
    const field = makeField({ fieldId: 'f-changed', fieldName: 'sample_size', fieldLabel: '旧ラベル', aiGenerated: false });
    const row = makeRow({ fieldName: 'sample_size', fieldLabel: '新ラベル' });
    const diff = buildRedraftDiff([field], [row]);
    const selection: RedraftSelection = { added: {}, changed: { sample_size: false }, removed: {} };
    const rows = applyRedraftDiff(diff, selection);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.fieldLabel).toBe('旧ラベル');
    expect(rows[0]?.aiGenerated).toBe(false);
    expect(rows[0]?.fieldId).toBe('f-changed');
  });

  test('removed で承認(true)すると出力から消え、非承認(false)なら現行値のまま残る', () => {
    const removedApproved = makeField({ fieldId: 'f-1', fieldName: 'to_remove' });
    const removedKept = makeField({ fieldId: 'f-2', fieldName: 'to_keep' });
    const diff = buildRedraftDiff([removedApproved, removedKept], []);
    const selection: RedraftSelection = {
      added: {},
      changed: {},
      removed: { to_remove: true, to_keep: false },
    };
    const rows = applyRedraftDiff(diff, selection);
    expect(rows.map((r) => r.fieldName)).toEqual(['to_keep']);
    expect(rows[0]?.fieldId).toBe('f-2');
  });

  test('added で承認(true)の行だけを末尾に追記し、fieldId は null のまま', () => {
    const current = [makeField({ fieldName: 'kept', fieldId: 'f-kept' })];
    const acceptedRow = makeRow({ fieldName: 'new_accepted', fieldLabel: '採用' });
    const rejectedRow = makeRow({ fieldName: 'new_rejected', fieldLabel: '不採用' });
    const diff = buildRedraftDiff(current, [acceptedRow, rejectedRow]);
    const selection: RedraftSelection = {
      added: { new_accepted: true, new_rejected: false },
      changed: {},
      removed: {},
    };
    const rows = applyRedraftDiff(diff, selection);
    expect(rows.map((r) => r.fieldName)).toEqual(['kept', 'new_accepted']);
    expect(rows[1]?.fieldId).toBeNull();
  });

  test('selection に対応キーが無い場合は既定値(changed=false扱い/removed=false扱い/added=false扱い)にフォールバックする', () => {
    const changedField = makeField({ fieldName: 'changed_field', fieldLabel: '旧' });
    const removedField = makeField({ fieldName: 'removed_field' });
    const current = [changedField, removedField];
    const changedRow = makeRow({ fieldName: 'changed_field', fieldLabel: '新' });
    const addedRow = makeRow({ fieldName: 'added_field' });
    const diff = buildRedraftDiff(current, [changedRow, addedRow]);
    // 意図的に全カテゴリを空オブジェクトにして ?? false のフォールバック経路を通す
    const emptySelection: RedraftSelection = { added: {}, changed: {}, removed: {} };
    const rows = applyRedraftDiff(diff, emptySelection);
    // changed 未承認 → 現行値のまま、removed 未承認 → 残る、added 未承認 → 出力されない
    expect(rows.map((r) => r.fieldName)).toEqual(['changed_field', 'removed_field']);
    expect(rows[0]?.fieldLabel).toBe('旧');
  });

  test('空の diff に空の selection を適用すると空配列を返す', () => {
    const diff = buildRedraftDiff([], []);
    const selection = defaultRedraftSelection(diff);
    expect(applyRedraftDiff(diff, selection)).toEqual([]);
  });

  test('current に同名 field_name が複数あっても両方が出力に反映される（レビュー指摘 1-c。重複で片方が消えない）', () => {
    const first = makeField({ fieldId: 'f-1', fieldName: 'dup_field', fieldIndex: 1, required: false });
    const second = makeField({ fieldId: 'f-2', fieldName: 'dup_field', fieldIndex: 2, required: false });
    const row = makeRow({ fieldName: 'dup_field', required: true });
    const diff = buildRedraftDiff([first, second], [row]);
    // changed（1 件目）を承認、removed（2 件目）は非承認のまま → 両方とも出力に残る
    const selection: RedraftSelection = { added: {}, changed: { dup_field: true }, removed: { dup_field: false } };
    const rows = applyRedraftDiff(diff, selection);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.fieldId).toBe('f-1');
    expect(rows[0]?.required).toBe(true); // changed 承認で AI 提案を採用
    expect(rows[1]?.fieldId).toBe('f-2');
    expect(rows[1]?.required).toBe(false); // removed 非承認で現行値のまま残る
  });
});

describe('isRedraftSelectionPristine', () => {
  function buildSampleDiff(): RedraftDiff {
    return buildRedraftDiff(
      [
        makeField({ fieldName: 'changed_field', required: false }),
        makeField({ fieldName: 'removed_field' }),
      ],
      [makeRow({ fieldName: 'changed_field', required: true }), makeRow({ fieldName: 'added_field' })],
    );
  }

  test('既定選択のままなら true', () => {
    const diff = buildSampleDiff();
    expect(isRedraftSelectionPristine(diff, defaultRedraftSelection(diff))).toBe(true);
  });

  test('added を既定から変更すると false', () => {
    const diff = buildSampleDiff();
    const selection = defaultRedraftSelection(diff);
    selection.added.added_field = false;
    expect(isRedraftSelectionPristine(diff, selection)).toBe(false);
  });

  test('changed を既定から変更すると false', () => {
    const diff = buildSampleDiff();
    const selection = defaultRedraftSelection(diff);
    selection.changed.changed_field = false;
    expect(isRedraftSelectionPristine(diff, selection)).toBe(false);
  });

  test('removed を既定から変更すると false', () => {
    const diff = buildSampleDiff();
    const selection = defaultRedraftSelection(diff);
    selection.removed.removed_field = true;
    expect(isRedraftSelectionPristine(diff, selection)).toBe(false);
  });

  test('空の diff では既定選択(空オブジェクト同士)が pristine と判定される', () => {
    const diff = buildRedraftDiff([], []);
    expect(isRedraftSelectionPristine(diff, { added: {}, changed: {}, removed: {} })).toBe(true);
  });
});
