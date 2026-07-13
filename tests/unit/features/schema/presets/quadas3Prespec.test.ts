// QUADAS-3 プリセットの事前設定（issue #103 PR3）のテスト。
// ダイアログ状態の生成・確定値への正規化・note JSON の往復・Review context /
// 狙い撃ち注入（適用可能性判定行 + SQ 4.3）・行生成（回帰なし）を検証する
import {
  buildQuadas3ReviewContext,
  buildQuadas3Rows,
  createQuadas3PrespecDialogState,
  findQuadas3PrespecInRows,
  parseQuadas3PrespecNote,
  quadas3DialogToPrespec,
  serializeQuadas3PrespecNote,
  type Quadas3Prespec,
} from '../../../../../src/features/schema/presets/quadas3Prespec';
import { ROB_TEMPLATE_QUADAS3 } from '../../../../../src/features/schema/presets/robTemplates';
import type { SchemaEditorRow } from '../../../../../src/features/schema/types';

function emptyPrespec(): Quadas3Prespec {
  return {
    population: null,
    indexTest: null,
    targetCondition: null,
    intendedUsePopulation: null,
    testRole: null,
    referenceStandard: null,
    analysisUnit: null,
  };
}

function makeRow(patch: Partial<SchemaEditorRow>): SchemaEditorRow {
  return {
    fieldId: null,
    section: 'risk_of_bias_quadas3',
    fieldName: 'x',
    fieldLabel: 'X',
    entityLevel: 'rob_domain',
    dataType: 'text',
    unit: null,
    allowedValues: null,
    required: false,
    extractionInstruction: 'inst',
    example: null,
    aiGenerated: false,
    note: null,
    ...patch,
  };
}

const instructionOf = (rows: readonly SchemaEditorRow[], fieldName: string): string =>
  rows.find((row) => row.fieldName === fieldName)?.extractionInstruction ?? '';

describe('quadas3Prespec', () => {
  test('createQuadas3PrespecDialogState: 初期値なしは全項目空・初期値ありは復元する', () => {
    expect(createQuadas3PrespecDialogState(null)).toEqual({
      kind: 'quadas3',
      population: '',
      indexTest: '',
      targetCondition: '',
      intendedUsePopulation: '',
      testRole: '',
      referenceStandard: '',
      analysisUnit: '',
      error: null,
    });
    const initial: Quadas3Prespec = {
      population: 'adults with suspected DVT',
      indexTest: 'D-dimer',
      targetCondition: 'DVT',
      intendedUsePopulation: 'primary care attendees',
      testRole: 'triage before ultrasound',
      referenceStandard: 'ultrasonography',
      analysisUnit: 'per patient',
    };
    expect(createQuadas3PrespecDialogState(initial)).toMatchObject({
      kind: 'quadas3',
      population: 'adults with suspected DVT',
      analysisUnit: 'per patient',
    });
  });

  test('quadas3DialogToPrespec: トリム + 空 → null', () => {
    const prespec = quadas3DialogToPrespec({
      ...createQuadas3PrespecDialogState(null),
      population: '  adults ',
      indexTest: '   ',
      analysisUnit: 'per patient',
    });
    expect(prespec.population).toBe('adults');
    expect(prespec.indexTest).toBeNull();
    expect(prespec.targetCondition).toBeNull();
    expect(prespec.analysisUnit).toBe('per patient');
  });

  test('note JSON の往復と防御的パース', () => {
    const prespec: Quadas3Prespec = {
      ...emptyPrespec(),
      population: 'adults',
      indexTest: 'D-dimer',
      analysisUnit: 'per patient',
    };
    const note = serializeQuadas3PrespecNote(prespec);
    expect(JSON.parse(note)).toMatchObject({ type: 'quadas3_prespec', version: 1 });
    expect(parseQuadas3PrespecNote(note)).toEqual(prespec);
    expect(parseQuadas3PrespecNote(null)).toBeNull();
    expect(parseQuadas3PrespecNote('自由記述')).toBeNull();
    expect(parseQuadas3PrespecNote('42')).toBeNull();
    expect(parseQuadas3PrespecNote('null')).toBeNull();
    expect(parseQuadas3PrespecNote(JSON.stringify({ type: 'quips_prespec' }))).toBeNull();
    expect(
      parseQuadas3PrespecNote(
        JSON.stringify({ type: 'quadas3_prespec', version: 1, population: 123, index_test: '' }),
      ),
    ).toEqual(emptyPrespec());
  });

  test('findQuadas3PrespecInRows: quadas3_rob_judgement 行の有効な note から復元する', () => {
    const valid = serializeQuadas3PrespecNote({ ...emptyPrespec(), population: 'adults' });
    const rows = [
      makeRow({ fieldName: 'quadas3_applicability_judgement', note: valid }), // 対象外
      makeRow({ fieldName: 'quadas3_rob_judgement', note: '自由記述' }),
      makeRow({ fieldName: 'quadas3_rob_judgement', note: valid }),
    ];
    expect(findQuadas3PrespecInRows(rows)?.population).toBe('adults');
    expect(findQuadas3PrespecInRows([])).toBeNull();
  });

  test('buildQuadas3ReviewContext: 全項目未入力なら null、入力があった項目だけを英文列挙する', () => {
    expect(buildQuadas3ReviewContext(emptyPrespec())).toBeNull();
    const context = buildQuadas3ReviewContext({
      population: 'adults',
      indexTest: 'D-dimer',
      targetCondition: 'DVT',
      intendedUsePopulation: 'primary care attendees',
      testRole: 'triage before ultrasound',
      referenceStandard: 'ultrasonography',
      analysisUnit: 'per patient',
    });
    expect(context).toContain('Synthesis question population: adults.');
    expect(context).toContain('Synthesis question index test(s): D-dimer.');
    expect(context).toContain('Synthesis question target condition: DVT.');
    expect(context).toContain('Intended-use population of the ideal test accuracy trial: primary care attendees.');
    expect(context).toContain(
      'Proposed role and position of the index test in the clinical pathway: triage before ultrasound.',
    );
    expect(context).toContain('Reference standard of the ideal test accuracy trial: ultrasonography.');
    expect(context).toContain('Unit of analysis of the ideal test accuracy trial: per patient.');
  });

  test('buildQuadas3Rows: 事前設定が空なら現行テンプレートと同一の行を返す（回帰なし）', () => {
    expect(buildQuadas3Rows(emptyPrespec())).toEqual([...ROB_TEMPLATE_QUADAS3]);
  });

  test('buildQuadas3Rows: synthesis question の定義は適用可能性判定行だけに注入される', () => {
    const rows = buildQuadas3Rows({
      ...emptyPrespec(),
      population: 'adults',
      indexTest: 'D-dimer',
      targetCondition: 'DVT',
    });
    const definition =
      'In this review, the systematic review synthesis question is defined as — population: adults; index test(s): D-dimer; target condition: DVT.';
    expect(instructionOf(rows, 'quadas3_applicability_judgement')).toContain(definition);
    expect(instructionOf(rows, 'quadas3_rob_judgement')).not.toContain('is defined as —');
    expect(instructionOf(rows, 'quadas3_sq1_1')).not.toContain('is defined as —');
    // Review context は全行へ注入される
    for (const row of rows) {
      expect(row.extractionInstruction.startsWith('Review context')).toBe(true);
    }
    // note は quadas3_rob_judgement 行のみ
    expect(rows.find((row) => row.fieldName === 'quadas3_rob_judgement')?.note).toContain(
      'quadas3_prespec',
    );
    expect(rows.find((row) => row.fieldName === 'quadas3_applicability_judgement')?.note).toBeNull();
  });

  test('buildQuadas3Rows: ideal trial の Analysis / unit は SQ 4.3 だけに注入される', () => {
    const rows = buildQuadas3Rows({ ...emptyPrespec(), analysisUnit: 'per patient' });
    expect(instructionOf(rows, 'quadas3_sq4_3')).toContain(
      'In this review, the unit of analysis of the ideal test accuracy trial is: per patient.',
    );
    expect(instructionOf(rows, 'quadas3_sq4_2')).not.toContain('unit of analysis of the ideal');
    // Phase 1 未入力なら適用可能性判定行への定義注入は無い
    expect(instructionOf(rows, 'quadas3_applicability_judgement')).not.toContain('is defined as —');
  });
});
