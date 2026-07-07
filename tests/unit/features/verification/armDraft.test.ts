import type { Evidence } from '../../../../src/domain/evidence';
import type { SchemaField } from '../../../../src/domain/schemaField';
import {
  armNameField,
  draftArms,
  isArmDependentLevel,
  needsArmConfirmation,
} from '../../../../src/features/verification/armDraft';

function makeField(overrides: Partial<SchemaField> = {}): SchemaField {
  return {
    schemaVersion: 1,
    fieldId: 'f-1',
    fieldIndex: 1,
    section: 'population',
    fieldName: 'sample_size_total',
    fieldLabel: '総サンプルサイズ',
    entityLevel: 'study',
    dataType: 'integer',
    unit: null,
    allowedValues: null,
    required: true,
    extractionInstruction: '抽出する',
    example: null,
    aiGenerated: false,
    note: null,
    ...overrides,
  };
}

function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    evidenceId: 'ev-1',
    runId: 'run-1',
    documentId: 'doc-1',
    fieldId: 'f-1',
    entityKey: '-',
    value: '120',
    notReported: false,
    quote: null,
    page: null,
    confidence: null,
    anchorStatus: null,
    ...overrides,
  };
}

describe('isArmDependentLevel', () => {
  test('arm / outcome_result のみ群構成の確定に依存する（study / rob_domain は非依存）', () => {
    expect(isArmDependentLevel('arm')).toBe(true);
    expect(isArmDependentLevel('outcome_result')).toBe(true);
    expect(isArmDependentLevel('study')).toBe(false);
    expect(isArmDependentLevel('rob_domain')).toBe(false);
  });
});

describe('needsArmConfirmation', () => {
  test('arm または outcome_result レベル項目があれば true', () => {
    expect(needsArmConfirmation([makeField({ entityLevel: 'arm' })])).toBe(true);
    expect(needsArmConfirmation([makeField({ entityLevel: 'outcome_result' })])).toBe(true);
    expect(needsArmConfirmation([makeField(), makeField({ entityLevel: 'rob_domain' })])).toBe(
      false,
    );
    expect(needsArmConfirmation([])).toBe(false);
  });
});

describe('armNameField', () => {
  test('field_name に name / label を含む arm レベル項目を fieldIndex 順で選ぶ', () => {
    const nName = makeField({ fieldId: 'f-n', fieldIndex: 3, fieldName: 'arm_name', entityLevel: 'arm' });
    const label = makeField({ fieldId: 'f-l', fieldIndex: 2, fieldName: 'group_label', entityLevel: 'arm' });
    const armN = makeField({ fieldId: 'f-size', fieldIndex: 1, fieldName: 'arm_n', entityLevel: 'arm' });
    expect(armNameField([nName, label, armN])?.fieldId).toBe('f-l');
  });

  test('name / label に一致する項目が無ければ null（群別 N 等を名称に誤用しない）', () => {
    const armN = makeField({ fieldId: 'f-size', fieldName: 'arm_n', entityLevel: 'arm' });
    expect(armNameField([armN, makeField()])).toBeNull();
    // study レベルの name 項目は対象外
    expect(armNameField([makeField({ fieldName: 'first_author_name' })])).toBeNull();
  });
});

describe('draftArms', () => {
  const nameField = makeField({
    fieldId: 'f-name',
    fieldIndex: 1,
    fieldName: 'arm_name',
    entityLevel: 'arm',
  });

  test('arm レベル entity_key と outcome キーの arm 参照からキーを集め、名称は arm 名フィールドの値', () => {
    const arms = draftArms(
      [nameField],
      [
        makeEvidence({ fieldId: 'f-name', entityKey: 'arm:1', value: 'アスピリン群' }),
        makeEvidence({ evidenceId: 'ev-2', entityKey: 'outcome:mortality|arm:2|time:30d' }),
        makeEvidence({ evidenceId: 'ev-3', entityKey: '-' }), // study は無視
        makeEvidence({ evidenceId: 'ev-4', entityKey: 'broken key' }), // 不正キーは無視
      ],
    );
    expect(arms).toEqual([
      { armKey: 'arm:1', armName: 'アスピリン群' },
      { armKey: 'arm:2', armName: '群 2' }, // 名称の Evidence なし → 表示ラベル
    ]);
  });

  test('arm 名フィールドが無いスキーマは表示ラベルで埋める', () => {
    const arms = draftArms(
      [makeField({ fieldId: 'f-size', fieldName: 'arm_n', entityLevel: 'arm' })],
      [makeEvidence({ fieldId: 'f-size', entityKey: 'arm:1', value: '50' })],
    );
    expect(arms).toEqual([{ armKey: 'arm:1', armName: '群 1' }]);
  });

  test('arm 名フィールドの値が null の出現は初期値に使わない', () => {
    const arms = draftArms(
      [nameField],
      [makeEvidence({ fieldId: 'f-name', entityKey: 'arm:1', value: null })],
    );
    expect(arms).toEqual([{ armKey: 'arm:1', armName: '群 1' }]);
  });

  test('arm 参照のない outcome キーだけなら空', () => {
    expect(
      draftArms([nameField], [makeEvidence({ entityKey: 'outcome:mortality|time:30d' })]),
    ).toEqual([]);
  });
});
