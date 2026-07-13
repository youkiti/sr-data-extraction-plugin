// ROBINS-I プリセットの事前設定（issue #103 PR2）のテスト。
// ダイアログ状態の生成・検証（メッセージキー契約）・確定値への正規化（リストの行分割）・
// note JSON の往復・Review context / リスト狙い撃ち注入・行生成
// （軽量版の回帰なし / SQ 完全版の D4 排他切替）を検証する
import {
  buildRobinsILiteRows,
  buildRobinsIReviewContext,
  buildRobinsISqRows,
  createRobinsIPrespecDialogState,
  findRobinsIPrespecInRows,
  parseListInput,
  parseRobinsIPrespecNote,
  robinsIDialogToPrespec,
  serializeRobinsIPrespecNote,
  validateRobinsIPrespecDialog,
  type RobinsIPrespec,
  type RobinsIPrespecDialogState,
} from '../../../../../src/features/schema/presets/robinsIPrespec';
import { ROB_TEMPLATE_ROBINS_I } from '../../../../../src/features/schema/presets/robTemplates';
import type { SchemaEditorRow } from '../../../../../src/features/schema/types';

/** 全項目空の確定値（スキップ・未入力と等価） */
function emptyPrespec(): RobinsIPrespec {
  return {
    design: null,
    participants: null,
    experimental: null,
    comparator: null,
    outcome: null,
    benefitHarm: null,
    effect: null,
    confoundingDomains: [],
    coInterventions: [],
  };
}

function makeDialog(patch: Partial<RobinsIPrespecDialogState> = {}): RobinsIPrespecDialogState {
  return { ...createRobinsIPrespecDialogState('robins_i', null), ...patch };
}

function makeRow(patch: Partial<SchemaEditorRow>): SchemaEditorRow {
  return {
    fieldId: null,
    section: 'risk_of_bias',
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

describe('robinsIPrespec', () => {
  describe('createRobinsIPrespecDialogState', () => {
    test('初期値なし: 全項目空・effect / benefitHarm 未選択・エラーなし', () => {
      expect(createRobinsIPrespecDialogState('robins_i', null)).toEqual({
        kind: 'robins_i',
        design: '',
        participants: '',
        experimental: '',
        comparator: '',
        outcome: '',
        benefitHarm: null,
        effect: null,
        confoundingDomains: '',
        coInterventions: '',
        error: null,
      });
    });

    test('初期値あり（再挿入）: リストは 1 行 1 項目の textarea 生値へ戻す', () => {
      const initial: RobinsIPrespec = {
        design: 'individually randomized',
        participants: 'adults with sepsis',
        experimental: 'early vasopressin',
        comparator: 'norepinephrine alone',
        outcome: '28-day mortality',
        benefitHarm: 'benefit',
        effect: 'starting_adhering',
        confoundingDomains: ['baseline severity', 'age'],
        coInterventions: ['renal replacement therapy'],
      };
      expect(createRobinsIPrespecDialogState('robins_i_sq', initial)).toEqual({
        kind: 'robins_i_sq',
        design: 'individually randomized',
        participants: 'adults with sepsis',
        experimental: 'early vasopressin',
        comparator: 'norepinephrine alone',
        outcome: '28-day mortality',
        benefitHarm: 'benefit',
        effect: 'starting_adhering',
        confoundingDomains: 'baseline severity\nage',
        coInterventions: 'renal replacement therapy',
        error: null,
      });
    });
  });

  describe('parseListInput', () => {
    test('1 行 1 項目でトリムし、空行は除去する', () => {
      expect(parseListInput('  age \n\n baseline severity\n')).toEqual([
        'age',
        'baseline severity',
      ]);
      expect(parseListInput('')).toEqual([]);
    });
  });

  describe('validateRobinsIPrespecDialog', () => {
    test('robins_i_sq は effect 未選択でエラー（表示用メッセージキーを返す）', () => {
      expect(validateRobinsIPrespecDialog(makeDialog({ kind: 'robins_i_sq' }))).toBe(
        'schema.prespecErrRobinsIEffectRequired',
      );
    });

    test('通過: robins_i は全項目未入力でも可 / robins_i_sq は effect 選択で可', () => {
      expect(validateRobinsIPrespecDialog(makeDialog())).toBeNull();
      expect(
        validateRobinsIPrespecDialog(makeDialog({ kind: 'robins_i_sq', effect: 'assignment' })),
      ).toBeNull();
      expect(
        validateRobinsIPrespecDialog(
          makeDialog({ kind: 'robins_i_sq', effect: 'starting_adhering' }),
        ),
      ).toBeNull();
    });
  });

  describe('robinsIDialogToPrespec', () => {
    test('テキストはトリムし空は null、リストは行分割で正規化する', () => {
      const prespec = robinsIDialogToPrespec(
        makeDialog({
          design: '  individually randomized ',
          participants: '   ',
          outcome: '28-day mortality',
          benefitHarm: 'harm',
          effect: 'assignment',
          confoundingDomains: ' age \n\nseverity ',
          coInterventions: '',
        }),
      );
      expect(prespec.design).toBe('individually randomized');
      expect(prespec.participants).toBeNull();
      expect(prespec.experimental).toBeNull();
      expect(prespec.outcome).toBe('28-day mortality');
      expect(prespec.benefitHarm).toBe('harm');
      expect(prespec.effect).toBe('assignment');
      expect(prespec.confoundingDomains).toEqual(['age', 'severity']);
      expect(prespec.coInterventions).toEqual([]);
    });
  });

  describe('note JSON の往復', () => {
    test('serialize → parse で確定値が復元できる', () => {
      const prespec: RobinsIPrespec = {
        design: 'individually randomized',
        participants: 'adults',
        experimental: 'drug A',
        comparator: 'usual care',
        outcome: 'mortality',
        benefitHarm: 'harm',
        effect: 'assignment',
        confoundingDomains: ['age', 'severity'],
        coInterventions: ['co-drug B'],
      };
      const note = serializeRobinsIPrespecNote(prespec);
      expect(JSON.parse(note)).toMatchObject({ type: 'robins_i_prespec', version: 1 });
      expect(parseRobinsIPrespecNote(note)).toEqual(prespec);
    });

    test('parse は不正な note を防御的に読む（null / 非 JSON / 非オブジェクト / 型識別子違い）', () => {
      expect(parseRobinsIPrespecNote(null)).toBeNull();
      expect(parseRobinsIPrespecNote('自由記述のメモ')).toBeNull();
      expect(parseRobinsIPrespecNote('42')).toBeNull();
      expect(parseRobinsIPrespecNote('null')).toBeNull();
      expect(parseRobinsIPrespecNote(JSON.stringify({ type: 'rob2_prespec' }))).toBeNull();
    });

    test('parse は個別フィールドの型崩れも防御する（不正 effect / benefit_harm / 非配列・非文字列要素）', () => {
      const parsed = parseRobinsIPrespecNote(
        JSON.stringify({
          type: 'robins_i_prespec',
          version: 1,
          design: 123,
          participants: '',
          outcome: 'ok',
          benefit_harm: 'both',
          effect: 'per_protocol',
          confounding_domains: 'not-an-array',
          co_interventions: ['ok', 42, '  '],
        }),
      );
      expect(parsed).toEqual({
        design: null,
        participants: null,
        experimental: null,
        comparator: null,
        outcome: 'ok',
        benefitHarm: null,
        effect: null,
        confoundingDomains: [],
        coInterventions: ['ok'],
      });
    });
  });

  describe('findRobinsIPrespecInRows', () => {
    test('robins_i_judgement 行の有効な note から復元する（無効な note の行はスキップ）', () => {
      const valid = serializeRobinsIPrespecNote({ ...emptyPrespec(), outcome: 'pain' });
      const rows = [
        makeRow({ fieldName: 'rob2_judgement', note: valid }), // field_name が違うので対象外
        makeRow({ fieldName: 'robins_i_judgement', note: '自由記述' }),
        makeRow({ fieldName: 'robins_i_judgement', note: valid }),
      ];
      expect(findRobinsIPrespecInRows(rows)?.outcome).toBe('pain');
    });

    test('見つからなければ null', () => {
      expect(findRobinsIPrespecInRows([makeRow({ fieldName: 'other' })])).toBeNull();
      expect(findRobinsIPrespecInRows([])).toBeNull();
    });
  });

  describe('buildRobinsIReviewContext', () => {
    test('全項目未入力なら null（軽量版のスキップと等価）', () => {
      expect(buildRobinsIReviewContext(emptyPrespec(), { includeLists: true })).toBeNull();
      expect(buildRobinsIReviewContext(emptyPrespec(), { includeLists: false })).toBeNull();
    });

    test('入力があった項目だけを tool template の文言で英文列挙する', () => {
      const context = buildRobinsIReviewContext(
        {
          ...emptyPrespec(),
          design: 'individually randomized',
          participants: 'adults',
          experimental: 'drug A',
          comparator: 'usual care',
          outcome: 'mortality',
          benefitHarm: 'benefit',
          effect: 'starting_adhering',
        },
        { includeLists: false },
      );
      expect(context).toContain('Target trial design: individually randomized.');
      expect(context).toContain('Target trial participants: adults.');
      expect(context).toContain('Target trial experimental intervention: drug A.');
      expect(context).toContain('Target trial comparator: usual care.');
      expect(context).toContain('Outcome being assessed for risk of bias: mortality.');
      expect(context).toContain('This outcome is a proposed benefit of intervention.');
      expect(context).toContain('to assess the effect of starting and adhering to intervention');
      expect(context).toContain('pre-specified by the review team');
    });

    test('includeLists = true のときだけ confounding domains / co-interventions を含める', () => {
      const prespec: RobinsIPrespec = {
        ...emptyPrespec(),
        confoundingDomains: ['age', 'severity'],
        coInterventions: ['co-drug B'],
      };
      const withLists = buildRobinsIReviewContext(prespec, { includeLists: true });
      expect(withLists).toContain('Important confounding domains pre-specified by the review team: age; severity.');
      expect(withLists).toContain('co-drug B');
      const withoutLists = buildRobinsIReviewContext(prespec, { includeLists: false });
      expect(withoutLists).toBeNull(); // リスト以外の入力が無ければ SQ 版の共通 context は空
    });
  });

  describe('buildRobinsILiteRows', () => {
    test('事前設定が空なら現行テンプレートと同一の行を返す（回帰なし）', () => {
      expect(buildRobinsILiteRows(emptyPrespec())).toEqual([...ROB_TEMPLATE_ROBINS_I]);
    });

    test('入力があれば全行へ Review context（リスト込み）を注入し、判定行の note に JSON を保存する', () => {
      const prespec: RobinsIPrespec = {
        ...emptyPrespec(),
        outcome: 'mortality',
        confoundingDomains: ['age'],
      };
      const rows = buildRobinsILiteRows(prespec);
      expect(rows).toHaveLength(ROB_TEMPLATE_ROBINS_I.length);
      for (const row of rows) {
        expect(row.extractionInstruction.startsWith('Review context')).toBe(true);
        expect(row.extractionInstruction).toContain('mortality');
        expect(row.extractionInstruction).toContain('age');
      }
      const judgement = rows.find((row) => row.fieldName === 'robins_i_judgement');
      const support = rows.find((row) => row.fieldName === 'robins_i_support');
      expect(parseRobinsIPrespecNote(judgement?.note ?? null)).toEqual(prespec);
      expect(support?.note).toBeNull();
    });
  });

  describe('buildRobinsISqRows', () => {
    test('effect 未選択は例外（確定前に validateRobinsIPrespecDialog で弾かれる契約）', () => {
      expect(() => buildRobinsISqRows(emptyPrespec())).toThrow('effect of interest');
    });

    test('assignment: D4 は 4.1〜4.2 のみ（計 32 行）+ 全行に Review context + 判定行に note', () => {
      const prespec: RobinsIPrespec = { ...emptyPrespec(), effect: 'assignment' };
      const rows = buildRobinsISqRows(prespec);
      expect(rows).toHaveLength(32);
      const names = rows.map((row) => row.fieldName);
      expect(names).toContain('robins_i_sq4_1');
      expect(names).toContain('robins_i_sq4_2');
      expect(names).not.toContain('robins_i_sq4_3');
      expect(names).not.toContain('robins_i_sq4_6');
      for (const row of rows) {
        expect(row.extractionInstruction.startsWith('Review context')).toBe(true);
      }
      const judgement = rows.find((row) => row.fieldName === 'robins_i_judgement');
      expect(parseRobinsIPrespecNote(judgement?.note ?? null)).toEqual(prespec);
    });

    test('starting_adhering: D4 は 4.3〜4.6 のみ（計 34 行）', () => {
      const rows = buildRobinsISqRows({ ...emptyPrespec(), effect: 'starting_adhering' });
      expect(rows).toHaveLength(34);
      const names = rows.map((row) => row.fieldName);
      expect(names).not.toContain('robins_i_sq4_1');
      expect(names).not.toContain('robins_i_sq4_2');
      expect(names).toContain('robins_i_sq4_3');
      expect(names).toContain('robins_i_sq4_6');
    });

    test('confounding domains リストは SQ 1.4 / 1.7 だけに定義文として注入される', () => {
      const rows = buildRobinsISqRows({
        ...emptyPrespec(),
        effect: 'assignment',
        confoundingDomains: ['age', 'severity'],
      });
      const definition = '"all the important confounding domains" refers to: age; severity.';
      expect(instructionOf(rows, 'robins_i_sq1_4')).toContain(definition);
      expect(instructionOf(rows, 'robins_i_sq1_7')).toContain(definition);
      // 他の SQ・判定行には注入されない（共通 Review context にもリストは含めない）
      expect(instructionOf(rows, 'robins_i_sq1_5')).not.toContain('age; severity');
      expect(instructionOf(rows, 'robins_i_judgement')).not.toContain('age; severity');
    });

    test('co-interventions リストは SQ 4.3（starting_adhering のみ存在）だけに注入される', () => {
      const rows = buildRobinsISqRows({
        ...emptyPrespec(),
        effect: 'starting_adhering',
        coInterventions: ['co-drug B'],
      });
      expect(instructionOf(rows, 'robins_i_sq4_3')).toContain(
        'the important co-interventions to consider are: co-drug B.',
      );
      expect(instructionOf(rows, 'robins_i_sq4_4')).not.toContain('co-drug B');
      // assignment 選択時は 4.3 自体が生成されないため注入先が無い（リスト入力は note には残る）
      const assignmentRows = buildRobinsISqRows({
        ...emptyPrespec(),
        effect: 'assignment',
        coInterventions: ['co-drug B'],
      });
      expect(assignmentRows.map((row) => row.fieldName)).not.toContain('robins_i_sq4_3');
      const judgement = assignmentRows.find((row) => row.fieldName === 'robins_i_judgement');
      expect(parseRobinsIPrespecNote(judgement?.note ?? null)?.coInterventions).toEqual([
        'co-drug B',
      ]);
    });
  });
});
