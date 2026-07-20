import type { SchemaField } from '../../../../src/domain/schemaField';
import {
  robDomainOptions,
  robOverrideFieldNames,
} from '../../../../src/features/verification/robEstimateFields';
import {
  QUADAS3_DOMAINS,
  QUIPS_DOMAINS,
  ROB2_DOMAINS,
  ROBINS_I_DOMAINS,
} from '../../../../src/features/schema/presets/robTemplates';

function makeField(overrides: Partial<SchemaField> = {}): SchemaField {
  return {
    schemaVersion: 1,
    fieldId: 'f-1',
    fieldIndex: 1,
    section: 'risk_of_bias',
    fieldName: 'rob2_judgement',
    fieldLabel: 'RoB 2 判定',
    entityLevel: 'rob_domain',
    dataType: 'enum',
    unit: null,
    allowedValues: 'low|some_concerns|high',
    required: true,
    extractionInstruction: '判定を抽出',
    example: null,
    aiGenerated: false,
    note: null,
    ...overrides,
  };
}

/** 判定行だけでツールが「挿入済み」と判定される（robFields.activeRobToolFieldSets と同じ規約） */
const ROB2_FIELDS = [makeField()];
const ROBINS_I_FIELDS = [makeField({ fieldId: 'f-2', fieldName: 'robins_i_judgement' })];
const QUADAS3_FIELDS = [
  makeField({ fieldId: 'f-3', fieldName: 'quadas3_rob_judgement' }),
  makeField({ fieldId: 'f-4', fieldName: 'quadas3_applicability_judgement', required: false }),
];
const QUIPS_FIELDS = [makeField({ fieldId: 'f-5', fieldName: 'quips_judgement' })];

describe('robDomainOptions', () => {
  test('挿入済みツールのテンプレート定義から全ドメインを列挙する（rob2）', () => {
    expect(robDomainOptions(ROB2_FIELDS)).toEqual(ROB2_DOMAINS);
  });

  test('QUADAS-3 は risk-of-bias / applicability が同一 id を共有するため初出だけ残す', () => {
    // applicability のドメインは全て risk-of-bias 側（QUADAS3_DOMAINS）の部分集合
    expect(robDomainOptions(QUADAS3_FIELDS)).toEqual(QUADAS3_DOMAINS);
  });

  test('複数ツール挿入時は各ツールのドメインを連結する', () => {
    expect(robDomainOptions([...ROB2_FIELDS, ...QUIPS_FIELDS])).toEqual([
      ...ROB2_DOMAINS,
      ...QUIPS_DOMAINS,
    ]);
  });

  test('テンプレート由来の判定行が無いスキーマは空（カスタム RoB 項目のみ等）', () => {
    expect(robDomainOptions([makeField({ fieldName: 'custom_judgement' })])).toEqual([]);
    expect(robDomainOptions([])).toEqual([]);
  });
});

describe('robOverrideFieldNames', () => {
  test('rob2 のドメイン: 判定 + 根拠 + そのドメインの SQ だけを返す', () => {
    const names = robOverrideFieldNames('d1_randomization', ROB2_FIELDS);
    expect(names).not.toBeNull();
    expect([...(names as ReadonlySet<string>)].sort()).toEqual([
      'rob2_judgement',
      'rob2_sq1_1',
      'rob2_sq1_2',
      'rob2_sq1_3',
      'rob2_support',
    ]);
  });

  test('SQ を持たないドメイン（overall）は判定 + 根拠のみ', () => {
    expect(robOverrideFieldNames('overall', ROB2_FIELDS)).toEqual(
      new Set(['rob2_judgement', 'rob2_support']),
    );
  });

  test('QUADAS-3 の共有ドメインは risk-of-bias / applicability 両判定 + SQ の和集合', () => {
    const names = robOverrideFieldNames('quadas3_d1_participants', QUADAS3_FIELDS);
    expect([...(names as ReadonlySet<string>)].sort()).toEqual([
      'quadas3_applicability_judgement',
      'quadas3_applicability_support',
      'quadas3_rob_judgement',
      'quadas3_rob_support',
      'quadas3_sq1_1',
      'quadas3_sq1_2',
      'quadas3_sq1_3',
      'quadas3_sq1_4',
    ]);
  });

  test('applicability に含まれないドメイン（analysis）は risk-of-bias 側だけになる', () => {
    const names = robOverrideFieldNames('quadas3_d4_analysis', QUADAS3_FIELDS);
    expect([...(names as ReadonlySet<string>)].sort()).toEqual([
      'quadas3_rob_judgement',
      'quadas3_rob_support',
      'quadas3_sq4_1',
      'quadas3_sq4_2',
      'quadas3_sq4_3',
      'quadas3_sq4_4',
    ]);
  });

  test('QUIPS は prompting item を SQ 相当として含める', () => {
    expect(robOverrideFieldNames('quips_d5_confounding', QUIPS_FIELDS)).toEqual(
      new Set(['quips_judgement', 'quips_support', 'quips_pi5_1', 'quips_pi5_2']),
    );
  });

  test('ROBINS-I のドメインも同じ規約で解決する', () => {
    const names = robOverrideFieldNames('d1_confounding', ROBINS_I_FIELDS);
    expect((names as ReadonlySet<string>).has('robins_i_judgement')).toBe(true);
    expect((names as ReadonlySet<string>).has('robins_i_support')).toBe(true);
    // ROBINS-I D1 の SQ（1.1〜1.3 系）が含まれ、他ドメインの SQ は含まれない
    expect([...(names as ReadonlySet<string>)].some((name) => name.startsWith('robins_i_sq1_'))).toBe(
      true,
    );
    expect([...(names as ReadonlySet<string>)].some((name) => name.startsWith('robins_i_sq2_'))).toBe(
      false,
    );
    expect(ROBINS_I_DOMAINS.some((domain) => domain.id === 'd1_confounding')).toBe(true);
  });

  test('どの挿入済みツールにも属さないドメイン id は null（base と同じ全 field 展開へ）', () => {
    expect(robOverrideFieldNames('unknown_domain', ROB2_FIELDS)).toBeNull();
    expect(robOverrideFieldNames('d1_randomization', [])).toBeNull();
  });
});
