// QUIPS プリセットの事前設定（issue #103 PR3）のテスト。
// ダイアログ状態の生成・確定値への正規化（リストの行分割）・note JSON の往復・
// Review context / LIST・定義の狙い撃ち注入・行生成（回帰なし）を検証する
import {
  buildQuipsReviewContext,
  buildQuipsRows,
  createQuipsPrespecDialogState,
  findQuipsPrespecInRows,
  parseQuipsPrespecNote,
  quipsDialogToPrespec,
  serializeQuipsPrespecNote,
  type QuipsPrespec,
} from '../../../../../src/features/schema/presets/quipsPrespec';
import { ROB_TEMPLATE_QUIPS } from '../../../../../src/features/schema/presets/robTemplates';
import type { SchemaEditorRow } from '../../../../../src/features/schema/types';

function emptyPrespec(): QuipsPrespec {
  return {
    population: null,
    prognosticFactor: null,
    outcome: null,
    keyCharacteristics: [],
    importantConfounders: [],
  };
}

function makeRow(patch: Partial<SchemaEditorRow>): SchemaEditorRow {
  return {
    fieldId: null,
    section: 'risk_of_bias_quips',
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

describe('quipsPrespec', () => {
  test('createQuipsPrespecDialogState: 初期値なしは全項目空・初期値ありはリストを textarea 生値へ戻す', () => {
    expect(createQuipsPrespecDialogState(null)).toEqual({
      kind: 'quips',
      population: '',
      prognosticFactor: '',
      outcome: '',
      keyCharacteristics: '',
      importantConfounders: '',
      error: null,
    });
    expect(
      createQuipsPrespecDialogState({
        population: 'adults with low back pain',
        prognosticFactor: 'fear-avoidance beliefs',
        outcome: 'disability at 12 months',
        keyCharacteristics: ['age', 'sex'],
        importantConfounders: ['baseline severity'],
      }),
    ).toMatchObject({
      population: 'adults with low back pain',
      keyCharacteristics: 'age\nsex',
      importantConfounders: 'baseline severity',
    });
  });

  test('quipsDialogToPrespec: トリム + 空 → null、リストは行分割で正規化', () => {
    const prespec = quipsDialogToPrespec({
      ...createQuipsPrespecDialogState(null),
      population: '  adults ',
      prognosticFactor: '   ',
      outcome: 'disability',
      keyCharacteristics: ' age \n\n sex ',
      importantConfounders: '',
    });
    expect(prespec.population).toBe('adults');
    expect(prespec.prognosticFactor).toBeNull();
    expect(prespec.outcome).toBe('disability');
    expect(prespec.keyCharacteristics).toEqual(['age', 'sex']);
    expect(prespec.importantConfounders).toEqual([]);
  });

  test('note JSON の往復と防御的パース', () => {
    const prespec: QuipsPrespec = {
      population: 'adults',
      prognosticFactor: 'FAB',
      outcome: 'disability at 12 months',
      keyCharacteristics: ['age', 'sex'],
      importantConfounders: ['baseline severity'],
    };
    const note = serializeQuipsPrespecNote(prespec);
    expect(JSON.parse(note)).toMatchObject({ type: 'quips_prespec', version: 1 });
    expect(parseQuipsPrespecNote(note)).toEqual(prespec);
    expect(parseQuipsPrespecNote(null)).toBeNull();
    expect(parseQuipsPrespecNote('自由記述')).toBeNull();
    expect(parseQuipsPrespecNote('42')).toBeNull();
    expect(parseQuipsPrespecNote('null')).toBeNull();
    expect(parseQuipsPrespecNote(JSON.stringify({ type: 'quadas3_prespec' }))).toBeNull();
    expect(
      parseQuipsPrespecNote(
        JSON.stringify({
          type: 'quips_prespec',
          version: 1,
          population: 123,
          prognostic_factor: '',
          key_characteristics: 'not-an-array',
          important_confounders: ['ok', 42, ' '],
        }),
      ),
    ).toEqual({ ...emptyPrespec(), importantConfounders: ['ok'] });
  });

  test('findQuipsPrespecInRows: quips_judgement 行の有効な note から復元する', () => {
    const valid = serializeQuipsPrespecNote({ ...emptyPrespec(), population: 'adults' });
    const rows = [
      makeRow({ fieldName: 'quips_support', note: valid }), // 対象外
      makeRow({ fieldName: 'quips_judgement', note: '自由記述' }),
      makeRow({ fieldName: 'quips_judgement', note: valid }),
    ];
    expect(findQuipsPrespecInRows(rows)?.population).toBe('adults');
    expect(findQuipsPrespecInRows([])).toBeNull();
  });

  test('buildQuipsReviewContext: 全項目未入力なら null、テキスト項目だけを英文列挙する（LIST は含めない）', () => {
    expect(buildQuipsReviewContext(emptyPrespec())).toBeNull();
    expect(
      buildQuipsReviewContext({ ...emptyPrespec(), keyCharacteristics: ['age'] }),
    ).toBeNull();
    const context = buildQuipsReviewContext({
      ...emptyPrespec(),
      population: 'adults',
      prognosticFactor: 'FAB',
      outcome: 'disability at 12 months',
    });
    expect(context).toContain('Population of interest: adults.');
    expect(context).toContain('Prognostic factor: FAB.');
    expect(context).toContain('Outcome (including duration of follow-up): disability at 12 months.');
  });

  test('buildQuipsRows: 事前設定が空なら現行テンプレートと同一の行を返す（回帰なし）', () => {
    expect(buildQuipsRows(emptyPrespec())).toEqual([...ROB_TEMPLATE_QUIPS]);
  });

  test('buildQuipsRows: LIST は対象 item（1.2 / 5.1 / 5.2）だけに注入される（LIST 単独入力でも有効）', () => {
    const rows = buildQuipsRows({
      ...emptyPrespec(),
      keyCharacteristics: ['age', 'sex'],
      importantConfounders: ['baseline severity'],
    });
    expect(instructionOf(rows, 'quips_pi1_2')).toContain(
      'In this review, the key characteristics (LIST) are: age; sex.',
    );
    expect(instructionOf(rows, 'quips_pi5_1')).toContain(
      'the important confounders (key variables in the conceptual model) are: baseline severity.',
    );
    expect(instructionOf(rows, 'quips_pi5_2')).toContain('baseline severity');
    // 対象外の item・判定行には注入されない（テキスト項目未入力のため Review context も無い）
    expect(instructionOf(rows, 'quips_pi1_1')).toBe(
      ROB_TEMPLATE_QUIPS.find((row) => row.fieldName === 'quips_pi1_1')?.extractionInstruction ?? '',
    );
    expect(instructionOf(rows, 'quips_judgement')).not.toContain('age; sex');
    // note は quips_judgement 行のみ
    expect(rows.find((row) => row.fieldName === 'quips_judgement')?.note).toContain('quips_prespec');
    expect(rows.find((row) => row.fieldName === 'quips_support')?.note).toBeNull();
  });

  test('buildQuipsRows: PF 定義は D3（3.1 / 3.2）、outcome 定義は D4（4.1 / 4.2）に注入される', () => {
    const rows = buildQuipsRows({
      ...emptyPrespec(),
      prognosticFactor: 'FAB',
      outcome: 'disability at 12 months',
    });
    expect(instructionOf(rows, 'quips_pi3_1')).toContain(
      'In this review, the prognostic factor is defined as: FAB.',
    );
    expect(instructionOf(rows, 'quips_pi3_2')).toContain('the prognostic factor is defined as: FAB');
    expect(instructionOf(rows, 'quips_pi4_1')).toContain(
      'In this review, the outcome (including duration of follow-up) is defined as: disability at 12 months.',
    );
    expect(instructionOf(rows, 'quips_pi4_2')).toContain('disability at 12 months');
    // テキスト入力があるため全行に Review context が付く
    for (const row of rows) {
      expect(row.extractionInstruction.startsWith('Review context')).toBe(true);
    }
  });
});
