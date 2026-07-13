// RoB 2 プリセットの事前設定（issue #103 PR1）のテスト。
// ダイアログ状態の生成・検証・確定値への正規化・note JSON の往復・
// Review context の注入・行生成（軽量版の回帰なし / SQ 完全版の effect 切替）を検証する
import {
  buildRob2LiteRows,
  buildRob2ReviewContext,
  buildRob2SqRows,
  createRobPrespecDialogState,
  dialogToPrespec,
  findRob2PrespecInRows,
  parseRob2PrespecNote,
  serializeRob2PrespecNote,
  toggleDeviationType,
  validateRobPrespecDialog,
  type Rob2Prespec,
  type RobPrespecDialogState,
} from '../../../../../src/features/schema/presets/robPrespec';
import { ROB_TEMPLATE_ROB2 } from '../../../../../src/features/schema/presets/robTemplates';
import type { SchemaEditorRow } from '../../../../../src/features/schema/types';

/** 全項目空の確定値（スキップ・未入力と等価） */
function emptyPrespec(): Rob2Prespec {
  return {
    design: 'individually_randomized_parallel_group',
    experimental: null,
    comparator: null,
    outcome: null,
    numericalResult: null,
    effect: null,
    deviationTypes: [],
  };
}

function makeDialog(patch: Partial<RobPrespecDialogState> = {}): RobPrespecDialogState {
  return { ...createRobPrespecDialogState('rob2', null), ...patch };
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

describe('robPrespec', () => {
  describe('createRobPrespecDialogState', () => {
    test('初期値なし: 全項目空・effect 未選択・エラーなし', () => {
      expect(createRobPrespecDialogState('rob2', null)).toEqual({
        kind: 'rob2',
        experimental: '',
        comparator: '',
        outcome: '',
        numericalResult: '',
        effect: null,
        deviationTypes: [],
        error: null,
      });
    });

    test('初期値あり（再挿入）: note から復元した事前設定を初期値へ展開する', () => {
      const initial: Rob2Prespec = {
        design: 'individually_randomized_parallel_group',
        experimental: 'CBT-I',
        comparator: 'waitlist',
        outcome: 'sleep onset latency',
        numericalResult: 'MD at 8 weeks (Table 2)',
        effect: 'adhering',
        deviationTypes: ['non_adherence'],
      };
      expect(createRobPrespecDialogState('rob2_sq', initial)).toEqual({
        kind: 'rob2_sq',
        experimental: 'CBT-I',
        comparator: 'waitlist',
        outcome: 'sleep onset latency',
        numericalResult: 'MD at 8 weeks (Table 2)',
        effect: 'adhering',
        deviationTypes: ['non_adherence'],
        error: null,
      });
    });
  });

  describe('toggleDeviationType', () => {
    test('チェックで追加・正準順（公式 template の列挙順）を維持する', () => {
      const once = toggleDeviationType([], 'non_adherence', true);
      expect(once).toEqual(['non_adherence']);
      expect(toggleDeviationType(once, 'non_protocol_interventions', true)).toEqual([
        'non_protocol_interventions',
        'non_adherence',
      ]);
    });

    test('チェック解除で取り除く（既に無ければ変化なし）', () => {
      expect(
        toggleDeviationType(['non_protocol_interventions', 'non_adherence'], 'non_adherence', false),
      ).toEqual(['non_protocol_interventions']);
      expect(toggleDeviationType([], 'implementation_failures', false)).toEqual([]);
    });
  });

  describe('validateRobPrespecDialog', () => {
    test('rob2_sq は effect 未選択でエラー（表示用メッセージキーを返す。issue #103 PR2 で共通化した契約）', () => {
      expect(validateRobPrespecDialog(makeDialog({ kind: 'rob2_sq' }))).toBe(
        'schema.prespecErrEffectRequired',
      );
    });

    test('adhering 選択 + deviation 種別 0 個はエラー（rob2 / rob2_sq 共通）', () => {
      expect(validateRobPrespecDialog(makeDialog({ effect: 'adhering' }))).toBe(
        'schema.prespecErrDeviationRequired',
      );
      expect(
        validateRobPrespecDialog(makeDialog({ kind: 'rob2_sq', effect: 'adhering' })),
      ).toBe('schema.prespecErrDeviationRequired');
    });

    test('通過: rob2 は全項目未入力でも可 / rob2_sq は assignment 選択で可 / adhering は種別 1 つ以上で可', () => {
      expect(validateRobPrespecDialog(makeDialog())).toBeNull();
      expect(
        validateRobPrespecDialog(makeDialog({ kind: 'rob2_sq', effect: 'assignment' })),
      ).toBeNull();
      expect(
        validateRobPrespecDialog(
          makeDialog({ effect: 'adhering', deviationTypes: ['non_adherence'] }),
        ),
      ).toBeNull();
    });
  });

  describe('dialogToPrespec', () => {
    test('テキストはトリムし、空は null に正規化する', () => {
      const prespec = dialogToPrespec(
        makeDialog({ experimental: '  CBT-I  ', comparator: '   ', outcome: '', numericalResult: 'RR' }),
      );
      expect(prespec.experimental).toBe('CBT-I');
      expect(prespec.comparator).toBeNull();
      expect(prespec.outcome).toBeNull();
      expect(prespec.numericalResult).toBe('RR');
      expect(prespec.design).toBe('individually_randomized_parallel_group');
    });

    test('deviation 種別は adhering のときだけ保持する（assignment へ切り替えたら捨てる）', () => {
      expect(
        dialogToPrespec(
          makeDialog({ effect: 'adhering', deviationTypes: ['implementation_failures'] }),
        ).deviationTypes,
      ).toEqual(['implementation_failures']);
      expect(
        dialogToPrespec(
          makeDialog({ effect: 'assignment', deviationTypes: ['implementation_failures'] }),
        ).deviationTypes,
      ).toEqual([]);
    });
  });

  describe('note JSON の往復', () => {
    test('serialize → parse で確定値が復元できる', () => {
      const prespec: Rob2Prespec = {
        design: 'individually_randomized_parallel_group',
        experimental: 'CBT-I',
        comparator: 'waitlist',
        outcome: 'sleep onset latency',
        numericalResult: 'MD -10 min (95% CI -15 to -5)',
        effect: 'adhering',
        deviationTypes: ['non_protocol_interventions', 'non_adherence'],
      };
      const note = serializeRob2PrespecNote(prespec);
      expect(JSON.parse(note)).toMatchObject({ type: 'rob2_prespec', version: 1 });
      expect(parseRob2PrespecNote(note)).toEqual(prespec);
    });

    test('parse は不正な note を防御的に読む（null / 非 JSON / 非オブジェクト / 型識別子違い）', () => {
      expect(parseRob2PrespecNote(null)).toBeNull();
      expect(parseRob2PrespecNote('自由記述のメモ')).toBeNull();
      expect(parseRob2PrespecNote('42')).toBeNull();
      expect(parseRob2PrespecNote('null')).toBeNull();
      expect(parseRob2PrespecNote(JSON.stringify({ type: 'other' }))).toBeNull();
    });

    test('parse は個別フィールドの型崩れも防御する（不正 effect / 非配列 deviation_types / 非文字列・空文字列）', () => {
      const parsed = parseRob2PrespecNote(
        JSON.stringify({
          type: 'rob2_prespec',
          version: 1,
          experimental: 123,
          comparator: '',
          outcome: 'ok',
          numerical_result: null,
          effect: 'unknown',
          deviation_types: 'not-an-array',
        }),
      );
      expect(parsed).toEqual({
        design: 'individually_randomized_parallel_group',
        experimental: null,
        comparator: null,
        outcome: 'ok',
        numericalResult: null,
        effect: null,
        deviationTypes: [],
      });
    });

    test('parse は deviation_types 配列から既知の値だけを正準順で拾う', () => {
      const parsed = parseRob2PrespecNote(
        JSON.stringify({
          type: 'rob2_prespec',
          version: 1,
          effect: 'adhering',
          deviation_types: ['non_adherence', 'bogus', 'non_protocol_interventions'],
        }),
      );
      expect(parsed?.deviationTypes).toEqual(['non_protocol_interventions', 'non_adherence']);
    });
  });

  describe('findRob2PrespecInRows', () => {
    test('rob2_judgement 行の有効な note から復元する（無効な note の行はスキップ）', () => {
      const valid = serializeRob2PrespecNote({ ...emptyPrespec(), outcome: 'pain' });
      const rows = [
        makeRow({ fieldName: 'rob2_support', note: valid }), // field_name が違うので対象外
        makeRow({ fieldName: 'rob2_judgement', note: '自由記述' }),
        makeRow({ fieldName: 'rob2_judgement', note: valid }),
      ];
      expect(findRob2PrespecInRows(rows)?.outcome).toBe('pain');
    });

    test('見つからなければ null', () => {
      expect(findRob2PrespecInRows([makeRow({ fieldName: 'other' })])).toBeNull();
      expect(findRob2PrespecInRows([])).toBeNull();
    });
  });

  describe('buildRob2ReviewContext', () => {
    test('全項目未入力 + design 非注入なら null（軽量版のスキップと等価）', () => {
      expect(buildRob2ReviewContext(emptyPrespec(), { includeDesign: false })).toBeNull();
    });

    test('includeDesign = true なら固定の design 文を先頭に含む', () => {
      const context = buildRob2ReviewContext(emptyPrespec(), { includeDesign: true });
      expect(context).toContain('Study design: individually-randomized parallel-group trial.');
      expect(context).toContain('pre-specified by the review team');
    });

    test('入力があった項目だけを英文で列挙する', () => {
      const context = buildRob2ReviewContext(
        { ...emptyPrespec(), experimental: 'CBT-I', comparator: 'waitlist', outcome: 'SOL', numericalResult: 'Table 2' },
        { includeDesign: false },
      );
      expect(context).toContain('Experimental intervention: CBT-I.');
      expect(context).toContain('Comparator: waitlist.');
      expect(context).toContain('Outcome being assessed for risk of bias: SOL.');
      expect(context).toContain('Numerical result being assessed: Table 2.');
      expect(context).not.toContain('Study design');
      expect(context).not.toContain('aim for this result');
    });

    test('effect は公式 template の文言で表現する（assignment / adhering + deviation 種別）', () => {
      const assignment = buildRob2ReviewContext(
        { ...emptyPrespec(), effect: 'assignment' },
        { includeDesign: false },
      );
      expect(assignment).toContain(
        "to assess the effect of assignment to intervention (the 'intention-to-treat' effect)",
      );
      const adhering = buildRob2ReviewContext(
        { ...emptyPrespec(), effect: 'adhering', deviationTypes: ['implementation_failures'] },
        { includeDesign: false },
      );
      expect(adhering).toContain(
        "to assess the effect of adhering to intervention (the 'per-protocol' effect)",
      );
      expect(adhering).toContain(
        'failures in implementing the intervention that could have affected the outcome',
      );
      // deviation 種別が空の adhering（検証で弾かれる入力だが純関数としては防御的に動く）
      const adheringNoTypes = buildRob2ReviewContext(
        { ...emptyPrespec(), effect: 'adhering' },
        { includeDesign: false },
      );
      expect(adheringNoTypes).not.toContain('Deviations from intended intervention addressed');
    });
  });

  describe('buildRob2LiteRows', () => {
    test('事前設定が空なら現行テンプレートと同一の行を返す（回帰なし）', () => {
      expect(buildRob2LiteRows(emptyPrespec())).toEqual([...ROB_TEMPLATE_ROB2]);
    });

    test('入力があれば全行の抽出指示冒頭に Review context を注入し、判定行の note に JSON を保存する', () => {
      const prespec: Rob2Prespec = { ...emptyPrespec(), outcome: 'mortality' };
      const rows = buildRob2LiteRows(prespec);
      expect(rows).toHaveLength(ROB_TEMPLATE_ROB2.length);
      for (const row of rows) {
        expect(row.extractionInstruction.startsWith('Review context')).toBe(true);
        expect(row.extractionInstruction).toContain('Outcome being assessed for risk of bias: mortality.');
      }
      const judgement = rows.find((row) => row.fieldName === 'rob2_judgement');
      const support = rows.find((row) => row.fieldName === 'rob2_support');
      expect(parseRob2PrespecNote(judgement?.note ?? null)).toEqual(prespec);
      expect(support?.note).toBeNull();
      // 元の指示文は改行の後に保たれる
      expect(judgement?.extractionInstruction).toContain(
        '\nCochrane RoB 2 risk-of-bias judgement for this randomized trial.',
      );
    });
  });

  describe('buildRob2SqRows', () => {
    test('effect 未選択は例外（確定前に validateRobPrespecDialog で弾かれる契約）', () => {
      expect(() => buildRob2SqRows(emptyPrespec())).toThrow('effect of interest');
    });

    test('assignment: 24 行（SQ 22 問 = 2.7 あり）+ 全行に design 込みの Review context + 判定行に note', () => {
      const prespec: Rob2Prespec = { ...emptyPrespec(), effect: 'assignment' };
      const rows = buildRob2SqRows(prespec);
      expect(rows).toHaveLength(24);
      expect(rows.map((row) => row.fieldName)).toContain('rob2_sq2_7');
      for (const row of rows) {
        expect(row.extractionInstruction.startsWith('Review context')).toBe(true);
        expect(row.extractionInstruction).toContain(
          'Study design: individually-randomized parallel-group trial.',
        );
      }
      const judgement = rows.find((row) => row.fieldName === 'rob2_judgement');
      expect(parseRob2PrespecNote(judgement?.note ?? null)).toEqual(prespec);
    });

    test('adhering: 23 行（D2 = 2.1〜2.6・2.7 なし）+ Review context に per-protocol 効果と deviation 種別', () => {
      const prespec: Rob2Prespec = {
        ...emptyPrespec(),
        effect: 'adhering',
        deviationTypes: ['non_protocol_interventions'],
      };
      const rows = buildRob2SqRows(prespec);
      expect(rows).toHaveLength(23);
      expect(rows.map((row) => row.fieldName)).not.toContain('rob2_sq2_7');
      const sq2_3 = rows.find((row) => row.fieldName === 'rob2_sq2_3');
      expect(sq2_3?.extractionInstruction).toContain(
        'Were important non-protocol interventions balanced across intervention groups?',
      );
      expect(sq2_3?.extractionInstruction).toContain("the 'per-protocol' effect");
      expect(sq2_3?.extractionInstruction).toContain('occurrence of non-protocol interventions');
      const judgement = rows.find((row) => row.fieldName === 'rob2_judgement');
      expect(parseRob2PrespecNote(judgement?.note ?? null)).toEqual(prespec);
    });
  });
});
