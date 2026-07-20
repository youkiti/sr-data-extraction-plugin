import type { Decision } from '../../../../src/domain/decision';
import type { Evidence } from '../../../../src/domain/evidence';
import type { SchemaField } from '../../../../src/domain/schemaField';
import { NOT_REPORTED_TOKEN } from '../../../../src/domain/annotation';
import { buildTabModel, type CellGroup, type TabModel, type VerificationCell } from '../../../../src/features/verification/cells';
import { cellKeyOf, emptyCellState } from '../../../../src/features/verification/cellState';
import {
  buildFocusUnits,
  nextPendingCellInUnit,
  nextPendingUnit,
  unitOfCell,
  unitProgress,
  type FocusUnit,
} from '../../../../src/features/verification/focusUnits';

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

function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    evidenceId: 'ev-1',
    runId: 'run-1',
    studyId: 'study-1',
    documentId: 'doc-1',
    fieldId: 'f-1',
    entityKey: '-',
    value: '120',
    notReported: false,
    quote: 'a total of 120',
    page: 1,
    confidence: 'high',
    anchorStatus: 'exact',
    bboxPage: null,
    bbox: null,
    relocatedFrom: null,
    ...overrides,
  };
}

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    decidedAt: 't1',
    decidedBy: 'me@example.com',
    studyId: 'study-1',
    fieldId: 'f-1',
    entityKey: '-',
    annotator: 'me@example.com',
    annotatorType: 'human_with_ai',
    schemaVersion: 1,
    action: 'accept',
    value: '120',
    note: null,
    ...overrides,
  };
}

/** 手組みの VerificationCell（buildTabModel を経由しない防御系テスト用） */
function makeCell(field: SchemaField, entityKey: string, overrides: Partial<VerificationCell> = {}): VerificationCell {
  return {
    cellKey: cellKeyOf(field.fieldId, entityKey),
    field,
    entityKey,
    evidence: null,
    state: emptyCellState(),
    ...overrides,
  };
}

describe('buildFocusUnits: study タブ', () => {
  test('section ごとに 1 ユニット（列は固定 1 つ、summary は常に null）', () => {
    const fields = [
      makeField({ fieldId: 'f-1', fieldIndex: 1, section: 'methods' }),
      makeField({ fieldId: 'f-2', fieldIndex: 2, section: 'methods', fieldName: 'country' }),
      makeField({ fieldId: 'f-3', fieldIndex: 3, section: 'results', fieldName: 'n_events' }),
    ];
    const evidence = [makeEvidence({ fieldId: 'f-1' })];
    const model = buildTabModel('study', fields, evidence, []);
    const units = buildFocusUnits('study', model);

    expect(units).toHaveLength(2);
    expect(units[0]).toMatchObject({
      unitKey: 'study|methods',
      heading: 'methods',
      columns: [{ entityKey: '-', label: 'Study' }],
      summary: null,
    });
    expect(units[0]?.rows.map((row) => row.field.fieldId)).toEqual(['f-1', 'f-2']);
    expect(units[0]?.rows[0]?.cells).toHaveLength(1);
    expect(units[0]?.rows[0]?.cells[0]?.evidence?.evidenceId).toBe('ev-1');
    expect(units[1]).toMatchObject({ unitKey: 'study|results', heading: 'results' });
  });

  test('セクションが無いタブは空配列になる', () => {
    const model = buildTabModel('study', [], [], []);
    expect(buildFocusUnits('study', model)).toEqual([]);
  });
});

describe('buildFocusUnits: arm タブ', () => {
  const fields = [
    makeField({ fieldId: 'f-name', fieldIndex: 1, section: 'arm_info', entityLevel: 'arm', fieldName: 'arm_name' }),
    makeField({ fieldId: 'f-n', fieldIndex: 2, section: 'arm_info', entityLevel: 'arm', fieldName: 'arm_n' }),
    makeField({ fieldId: 'f-dose', fieldIndex: 3, section: 'intervention', entityLevel: 'arm', fieldName: 'dose' }),
  ];

  test('section ごとに 1 ユニット・列 = 群インスタンス。armStructure の確定名を列ラベルに使う', () => {
    const evidence = [
      makeEvidence({ fieldId: 'f-name', entityKey: 'arm:1' }),
      makeEvidence({ fieldId: 'f-name', entityKey: 'arm:2' }),
    ];
    const armStructure = {
      version: 1,
      arms: [{ armKey: 'arm:1', armName: '介入群' }],
    };
    const model = buildTabModel('arm', fields, evidence, [], { armStructure });
    const units = buildFocusUnits('arm', model, { armStructure });

    expect(units.map((u) => u.unitKey)).toEqual(['arm|arm_info', 'arm|intervention']);
    // arm:1 は確定名、arm:2 は未確定（armStructure に無い）ため group.heading（entityKeyLabel）へフォールバック
    expect(units[0]?.columns).toEqual([
      { entityKey: 'arm:1', label: '介入群' },
      { entityKey: 'arm:2', label: '群 2' },
    ]);
    expect(units[0]?.rows.map((row) => row.field.fieldId)).toEqual(['f-name', 'f-n']);
    expect(units[1]?.rows.map((row) => row.field.fieldId)).toEqual(['f-dose']);
    // 各セルは対応する群の Evidence を持つ
    expect(units[0]?.rows[0]?.cells.map((cell) => cell?.entityKey)).toEqual(['arm:1', 'arm:2']);
    expect(units.every((u) => u.summary === null)).toBe(true);
  });

  test('armStructure 未指定なら常に entityKeyLabel（群 X）へフォールバック', () => {
    const evidence = [makeEvidence({ fieldId: 'f-name', entityKey: 'arm:1' })];
    const model = buildTabModel('arm', fields, evidence, []);
    const units = buildFocusUnits('arm', model);
    expect(units[0]?.columns).toEqual([{ entityKey: 'arm:1', label: '群 1' }]);
  });

  test('群インスタンスが無いタブは空配列になる', () => {
    const model = buildTabModel('arm', fields, [], []);
    expect(buildFocusUnits('arm', model)).toEqual([]);
  });

  test('群構成は確定済みだが arm レベルフィールドが 0 件のスキーマではユニットを作らない', () => {
    const armStructure = { version: 1, arms: [{ armKey: 'arm:1', armName: '介入群' }] };
    // fields を渡さない = arm レベル項目 0 件。group 自体は armStructure から作られるが cells は空になる
    const model = buildTabModel('arm', [], [], [], { armStructure });
    expect(model.groups).toHaveLength(1);
    expect(model.groups[0]?.cells).toEqual([]);
    expect(buildFocusUnits('arm', model, { armStructure })).toEqual([]);
  });

  test('group 間でセル欠落があっても存在しないセルは null として行に埋める（防御）', () => {
    const fieldA = makeField({ fieldId: 'f-a', entityLevel: 'arm', section: 'arm_info', fieldName: 'arm_name' });
    const fieldB = makeField({ fieldId: 'f-b', entityLevel: 'arm', section: 'arm_info', fieldName: 'arm_n' });
    const cellA1 = makeCell(fieldA, 'arm:1');
    const cellB1 = makeCell(fieldB, 'arm:1');
    const cellA2 = makeCell(fieldA, 'arm:2');
    // group2（arm:2）は f-b のセルを持たない不整合な TabModel（手組み）
    const model: TabModel = {
      groups: [
        { heading: '群 1', cells: [cellA1, cellB1] },
        { heading: '群 2', cells: [cellA2] },
      ],
      cells: [cellA1, cellB1, cellA2],
    };
    const units = buildFocusUnits('arm', model);
    expect(units).toHaveLength(1);
    const row = units[0]?.rows.find((r) => r.field.fieldId === 'f-b');
    expect(row?.cells).toEqual([cellB1, null]);
  });
});

describe('buildFocusUnits: outcome_result タブ', () => {
  const continuousFields: SchemaField[] = [
    makeField({ fieldId: 'f-mean', entityLevel: 'outcome_result', fieldName: 'outcome_mean', fieldIndex: 1 }),
    makeField({ fieldId: 'f-sd', entityLevel: 'outcome_result', fieldName: 'outcome_sd', fieldIndex: 2 }),
    makeField({ fieldId: 'f-n', entityLevel: 'outcome_result', fieldName: 'outcome_n', fieldIndex: 3 }),
  ];

  test('outcome × time の組ごとに 1 ユニットへ横結合し、arm セグメント無しは「群なし」列になる', () => {
    const evidence = [
      makeEvidence({ fieldId: 'f-mean', entityKey: 'outcome:pain|arm:1|time:8w', value: '5.2' }),
      makeEvidence({ fieldId: 'f-mean', entityKey: 'outcome:pain|time:8w', value: '4.0' }),
    ];
    const model = buildTabModel('outcome_result', continuousFields, evidence, []);
    const units = buildFocusUnits('outcome_result', model);

    expect(units).toHaveLength(1);
    expect(units[0]?.unitKey).toBe('outcome:pain|time:8w');
    expect(units[0]?.heading).toBe('pain ／ 時点: 8w');
    expect(units[0]?.columns).toEqual([
      { entityKey: 'outcome:pain|arm:1|time:8w', label: '群 1' },
      { entityKey: 'outcome:pain|time:8w', label: '群なし' },
    ]);
  });

  test('time を持たないキーは見出しに時点表記を付けない', () => {
    const evidence = [makeEvidence({ fieldId: 'f-mean', entityKey: 'outcome:mortality|arm:1' })];
    const model = buildTabModel('outcome_result', continuousFields, evidence, []);
    const units = buildFocusUnits('outcome_result', model);
    expect(units[0]?.heading).toBe('mortality');
    expect(units[0]?.unitKey).toBe('outcome:mortality');
  });

  test('ユニット順は entity_key 昇順から導出した (outcome, time) の初出順', () => {
    const evidence = [
      makeEvidence({ fieldId: 'f-mean', entityKey: 'outcome:mortality|time:30d' }),
      makeEvidence({ fieldId: 'f-mean', entityKey: 'outcome:mortality|time:8w' }),
      makeEvidence({ fieldId: 'f-mean', entityKey: 'outcome:pain' }),
    ];
    const model = buildTabModel('outcome_result', continuousFields, evidence, []);
    const units = buildFocusUnits('outcome_result', model);
    expect(units.map((u) => u.unitKey)).toEqual([
      'outcome:mortality|time:30d',
      'outcome:mortality|time:8w',
      'outcome:pain',
    ]);
  });

  test('フィールドが 0 件のスキーマでは outcome インスタンスがあってもユニットを作らない', () => {
    const decisions = [makeDecision({ fieldId: 'x', entityKey: 'outcome:pain|arm:1' })];
    const model = buildTabModel('outcome_result', [], [], decisions);
    expect(buildFocusUnits('outcome_result', model)).toEqual([]);
  });

  test('entity_key を復元できない group（不正キー・レベル不一致）は無視する（防御）', () => {
    const validField = continuousFields[0] as SchemaField;
    const validCell = makeCell(validField, 'outcome:pain|arm:1');
    const brokenCell = makeCell(validField, 'not-a-valid-key');
    const wrongLevelCell = makeCell(validField, 'arm:1');
    const model: TabModel = {
      groups: [
        { heading: 'valid', cells: [validCell] },
        { heading: 'broken', cells: [brokenCell] },
        { heading: 'wrong-level', cells: [wrongLevelCell] },
      ],
      cells: [validCell, brokenCell, wrongLevelCell],
    };
    const units = buildFocusUnits('outcome_result', model);
    expect(units).toHaveLength(1);
    expect(units[0]?.unitKey).toBe('outcome:pain');
  });

  describe('列順: armStructure の並び → それ以外は entity_key 昇順', () => {
    test('両方 armStructure に登録済みならその並び順', () => {
      const armStructure = {
        version: 1,
        arms: [
          { armKey: 'arm:2', armName: '対照群' },
          { armKey: 'arm:1', armName: '介入群' },
        ],
      };
      const evidence = [
        makeEvidence({ fieldId: 'f-mean', entityKey: 'outcome:pain|arm:1|time:8w' }),
        makeEvidence({ fieldId: 'f-mean', entityKey: 'outcome:pain|arm:2|time:8w' }),
      ];
      const model = buildTabModel('outcome_result', continuousFields, evidence, []);
      const units = buildFocusUnits('outcome_result', model, { armStructure });
      expect(units[0]?.columns.map((c) => c.entityKey)).toEqual([
        'outcome:pain|arm:2|time:8w',
        'outcome:pain|arm:1|time:8w',
      ]);
    });

    test('armStructure に無い arm は登録済み arm の後ろへ回る（rankA のみ確定）', () => {
      const armStructure = { version: 1, arms: [{ armKey: 'arm:1', armName: '介入群' }] };
      const evidence = [
        makeEvidence({ fieldId: 'f-mean', entityKey: 'outcome:pain|arm:1|time:8w' }),
        makeEvidence({ fieldId: 'f-mean', entityKey: 'outcome:pain|arm:9|time:8w' }),
      ];
      const model = buildTabModel('outcome_result', continuousFields, evidence, []);
      const units = buildFocusUnits('outcome_result', model, { armStructure });
      expect(units[0]?.columns.map((c) => c.entityKey)).toEqual([
        'outcome:pain|arm:1|time:8w',
        'outcome:pain|arm:9|time:8w',
      ]);
      expect(units[0]?.columns[1]).toEqual({ entityKey: 'outcome:pain|arm:9|time:8w', label: '群 9' });
    });

    test('未確定 arm が先に来る場合も登録済み arm の後ろへ並び替わる（rankB のみ確定）', () => {
      const armStructure = { version: 1, arms: [{ armKey: 'arm:9', armName: '介入群' }] };
      const evidence = [
        makeEvidence({ fieldId: 'f-mean', entityKey: 'outcome:pain|arm:1|time:8w' }),
        makeEvidence({ fieldId: 'f-mean', entityKey: 'outcome:pain|arm:9|time:8w' }),
      ];
      const model = buildTabModel('outcome_result', continuousFields, evidence, []);
      const units = buildFocusUnits('outcome_result', model, { armStructure });
      expect(units[0]?.columns.map((c) => c.entityKey)).toEqual([
        'outcome:pain|arm:9|time:8w',
        'outcome:pain|arm:1|time:8w',
      ]);
    });

    test('armStructure 未確定なら entity_key 昇順（両方未確定）', () => {
      const evidence = [
        makeEvidence({ fieldId: 'f-mean', entityKey: 'outcome:pain|arm:2|time:8w' }),
        makeEvidence({ fieldId: 'f-mean', entityKey: 'outcome:pain|arm:1|time:8w' }),
      ];
      const model = buildTabModel('outcome_result', continuousFields, evidence, []);
      const units = buildFocusUnits('outcome_result', model);
      expect(units[0]?.columns.map((c) => c.entityKey)).toEqual([
        'outcome:pain|arm:1|time:8w',
        'outcome:pain|arm:2|time:8w',
      ]);
    });
  });

  describe('summary: プリセット要約', () => {
    test('outcome_mean/sd/n が揃うと連続アウトカムの要約を作る（余分なフィールドがあっても含む判定）', () => {
      const fields = [...continuousFields, makeField({ fieldId: 'f-note', entityLevel: 'outcome_result', fieldName: 'outcome_note' })];
      const decisions: Decision[] = [
        makeDecision({ fieldId: 'f-mean', entityKey: 'outcome:pain|arm:1|time:8w', action: 'edit', value: '5.2' }),
      ];
      const evidence = [
        makeEvidence({ fieldId: 'f-mean', entityKey: 'outcome:pain|arm:1|time:8w', value: 'AI違う値' }),
        makeEvidence({ fieldId: 'f-sd', entityKey: 'outcome:pain|arm:1|time:8w', value: '1.8' }),
        makeEvidence({ fieldId: 'f-n', entityKey: 'outcome:pain|arm:1|time:8w', value: '45' }),
      ];
      const model = buildTabModel('outcome_result', fields, evidence, decisions);
      const units = buildFocusUnits('outcome_result', model);
      // mean は判定確定値（'5.2'）を優先、sd/n は AI 抽出値をそのまま使う
      expect(units[0]?.summary).toBe('5.2 ± 1.8 (n=45)');
    });

    test('AI 値も判定値も無いセルは `?`、not_reported トークンも `?` として扱う', () => {
      const evidence = [
        // f-mean は Evidence なし（AI 未抽出セル）
        makeEvidence({ fieldId: 'f-sd', entityKey: 'outcome:pain|arm:1|time:8w', value: '1.8' }),
      ];
      const decisions = [
        makeDecision({
          fieldId: 'f-n',
          entityKey: 'outcome:pain|arm:1|time:8w',
          action: 'not_reported',
          value: NOT_REPORTED_TOKEN,
        }),
      ];
      const model = buildTabModel('outcome_result', continuousFields, evidence, decisions);
      const units = buildFocusUnits('outcome_result', model);
      expect(units[0]?.summary).toBe('? ± 1.8 (n=?)');
    });

    test('セル自体が存在しない（欠落）場合も `?` として扱う', () => {
      const [meanField, sdField, nField] = continuousFields as [SchemaField, SchemaField, SchemaField];
      // group A（arm:1）は 3 フィールドとも揃い、canonical なフィールド一覧の出所になる。
      // group B（arm:2）は n フィールドのセルを欠落させた手組みモデル
      const groupA: CellGroup = {
        heading: 'x-a',
        cells: [
          makeCell(meanField, 'outcome:pain|arm:1|time:8w', {
            evidence: makeEvidence({ fieldId: meanField.fieldId, value: '5.2' }),
          }),
          makeCell(sdField, 'outcome:pain|arm:1|time:8w', {
            evidence: makeEvidence({ fieldId: sdField.fieldId, value: '1.8' }),
          }),
          makeCell(nField, 'outcome:pain|arm:1|time:8w', {
            evidence: makeEvidence({ fieldId: nField.fieldId, value: '45' }),
          }),
        ],
      };
      const groupB: CellGroup = {
        heading: 'x-b',
        cells: [
          makeCell(meanField, 'outcome:pain|arm:2|time:8w', {
            evidence: makeEvidence({ fieldId: meanField.fieldId, value: '3.0' }),
          }),
          makeCell(sdField, 'outcome:pain|arm:2|time:8w', {
            evidence: makeEvidence({ fieldId: sdField.fieldId, value: '0.9' }),
          }),
        ],
      };
      const model: TabModel = { groups: [groupA, groupB], cells: [] };
      const units = buildFocusUnits('outcome_result', model);
      expect(units[0]?.summary).toBe('5.2 ± 1.8 (n=45) vs 3.0 ± 0.9 (n=?)');
    });

    test('outcome_events/total が揃うと二値アウトカムの要約を作る（複数列は vs で連結）', () => {
      const binaryFields = [
        makeField({ fieldId: 'f-events', entityLevel: 'outcome_result', fieldName: 'outcome_events' }),
        makeField({ fieldId: 'f-total', entityLevel: 'outcome_result', fieldName: 'outcome_total' }),
      ];
      const evidence = [
        makeEvidence({ fieldId: 'f-events', entityKey: 'outcome:death|arm:1', value: '12' }),
        makeEvidence({ fieldId: 'f-total', entityKey: 'outcome:death|arm:1', value: '48' }),
        makeEvidence({ fieldId: 'f-events', entityKey: 'outcome:death|arm:2', value: '5' }),
        makeEvidence({ fieldId: 'f-total', entityKey: 'outcome:death|arm:2', value: '50' }),
      ];
      const model = buildTabModel('outcome_result', binaryFields, evidence, []);
      const units = buildFocusUnits('outcome_result', model);
      expect(units[0]?.summary).toBe('12/48 vs 5/50');
    });

    test('連続・二値いずれのフィールド構成にも一致しなければ summary は null', () => {
      const fields = [makeField({ fieldId: 'f-note', entityLevel: 'outcome_result', fieldName: 'free_note' })];
      const evidence = [makeEvidence({ fieldId: 'f-note', entityKey: 'outcome:pain|arm:1' })];
      const model = buildTabModel('outcome_result', fields, evidence, []);
      const units = buildFocusUnits('outcome_result', model);
      expect(units[0]?.summary).toBeNull();
    });
  });
});

describe('buildFocusUnits: rob_domain タブ', () => {
  const fields = [
    makeField({ fieldId: 'f-judge', entityLevel: 'rob_domain', fieldName: 'rob_judgement', fieldIndex: 1 }),
    makeField({ fieldId: 'f-reason', entityLevel: 'rob_domain', fieldName: 'rob_rationale', fieldIndex: 2 }),
  ];

  test('インスタンスごとに 1 ユニット（列は固定 1 つ）', () => {
    const evidence = [
      makeEvidence({ fieldId: 'f-judge', entityKey: 'rob:d1', value: 'low' }),
      makeEvidence({ fieldId: 'f-judge', entityKey: 'rob:d2', value: 'high' }),
    ];
    const model = buildTabModel('rob_domain', fields, evidence, []);
    const units = buildFocusUnits('rob_domain', model);
    expect(units.map((u) => u.unitKey)).toEqual(['rob:d1', 'rob:d2']);
    expect(units[0]).toMatchObject({
      heading: 'RoB: d1',
      columns: [{ entityKey: 'rob:d1', label: 'RoB' }],
      summary: null,
    });
    expect(units[0]?.rows.map((r) => r.field.fieldId)).toEqual(['f-judge', 'f-reason']);
  });

  test('base と estimate 別グループはそれぞれ別ユニットになる（issue #109）', () => {
    const evidence = [makeEvidence({ fieldId: 'f-judge', entityKey: 'rob:d1', value: 'low' })];
    const decisions = [
      makeDecision({ fieldId: 'f-judge', entityKey: 'rob:d1|outcome:mortality|arm:1' }),
    ];
    const model = buildTabModel('rob_domain', fields, evidence, decisions);
    const units = buildFocusUnits('rob_domain', model);
    expect(units.map((u) => u.unitKey)).toEqual(['rob:d1', 'rob:d1|outcome:mortality|arm:1']);
    expect(units[1]).toMatchObject({
      heading: 'RoB: d1 — mortality / 群 1',
      columns: [{ entityKey: 'rob:d1|outcome:mortality|arm:1', label: 'RoB' }],
    });
    expect(units[1]?.rows.map((r) => r.field.fieldId)).toEqual(['f-judge', 'f-reason']);
  });

  test('rob レベルフィールドが 0 件でもインスタンスがあれば heading ベースの unitKey で空行のユニットを作る', () => {
    const decisions = [makeDecision({ fieldId: 'x', entityKey: 'rob:d1' })];
    const model = buildTabModel('rob_domain', [], [], decisions);
    const units = buildFocusUnits('rob_domain', model);
    expect(units).toEqual([
      {
        unitKey: 'rob|RoB: d1',
        heading: 'RoB: d1',
        columns: [{ entityKey: '', label: 'RoB' }],
        rows: [],
        summary: null,
      },
    ]);
  });
});

describe('unitOfCell', () => {
  const fields = [makeField({ fieldId: 'f-1', section: 'methods' })];

  test('セルが属するユニットを返す', () => {
    const model = buildTabModel('study', fields, [], []);
    const units = buildFocusUnits('study', model);
    const cellKey = cellKeyOf('f-1', '-');
    expect(unitOfCell(units, cellKey)?.unitKey).toBe('study|methods');
  });

  test('null セルはスキップして探索する', () => {
    const fieldA = makeField({ fieldId: 'f-a', entityLevel: 'arm', section: 'arm_info' });
    const fieldB = makeField({ fieldId: 'f-b', entityLevel: 'arm', section: 'arm_info', fieldName: 'arm_n' });
    const cellA = makeCell(fieldA, 'arm:1');
    const cellB1 = makeCell(fieldB, 'arm:1');
    const model: TabModel = {
      groups: [
        { heading: '群 1', cells: [cellA, cellB1] },
        { heading: '群 2', cells: [makeCell(fieldA, 'arm:2')] },
      ],
      cells: [],
    };
    const units = buildFocusUnits('arm', model);
    expect(unitOfCell(units, cellB1.cellKey)?.unitKey).toBe('arm|arm_info');
  });

  test('見つからなければ null', () => {
    const model = buildTabModel('study', fields, [], []);
    const units = buildFocusUnits('study', model);
    expect(unitOfCell(units, cellKeyOf('nope', '-'))).toBeNull();
  });
});

describe('nextPendingCellInUnit', () => {
  function unitOfFields(fields: SchemaField[], decisions: Decision[] = []): FocusUnit {
    const model = buildTabModel('study', fields, [], decisions);
    const units = buildFocusUnits('study', model);
    return units[0] as FocusUnit;
  }

  test('fromCellKey が null なら先頭の未判定セルを返す', () => {
    const fields = [
      makeField({ fieldId: 'f-1', fieldIndex: 1 }),
      makeField({ fieldId: 'f-2', fieldIndex: 2, fieldName: 'country' }),
    ];
    const unit = unitOfFields(fields);
    expect(nextPendingCellInUnit(unit, null)).toBe(cellKeyOf('f-1', '-'));
  });

  test('fromCellKey の次の未判定セルを行優先で返す', () => {
    const fields = [
      makeField({ fieldId: 'f-1', fieldIndex: 1 }),
      makeField({ fieldId: 'f-2', fieldIndex: 2, fieldName: 'country' }),
      makeField({ fieldId: 'f-3', fieldIndex: 3, fieldName: 'design' }),
    ];
    const unit = unitOfFields(fields);
    expect(nextPendingCellInUnit(unit, cellKeyOf('f-1', '-'))).toBe(cellKeyOf('f-2', '-'));
  });

  test('末尾の未判定セルの次は折り返さず null', () => {
    const fields = [
      makeField({ fieldId: 'f-1', fieldIndex: 1 }),
      makeField({ fieldId: 'f-2', fieldIndex: 2, fieldName: 'country' }),
    ];
    const unit = unitOfFields(fields);
    expect(nextPendingCellInUnit(unit, cellKeyOf('f-2', '-'))).toBeNull();
  });

  test('全セルが判定済みなら null', () => {
    const fields = [makeField({ fieldId: 'f-1', fieldIndex: 1 })];
    const unit = unitOfFields(fields, [makeDecision({ fieldId: 'f-1' })]);
    expect(nextPendingCellInUnit(unit, null)).toBeNull();
  });

  test('fromCellKey がユニット内に見つからなければ先頭から探索する', () => {
    const fields = [
      makeField({ fieldId: 'f-1', fieldIndex: 1 }),
      makeField({ fieldId: 'f-2', fieldIndex: 2, fieldName: 'country' }),
    ];
    const unit = unitOfFields(fields);
    expect(nextPendingCellInUnit(unit, cellKeyOf('does-not-exist', '-'))).toBe(cellKeyOf('f-1', '-'));
  });

  test('null セル（存在しないセル）は行優先の走査対象から除外される', () => {
    const fieldA = makeField({ fieldId: 'f-a', entityLevel: 'arm', section: 'arm_info' });
    const fieldB = makeField({ fieldId: 'f-b', entityLevel: 'arm', section: 'arm_info', fieldName: 'arm_n' });
    const cellA1 = makeCell(fieldA, 'arm:1');
    const cellB1 = makeCell(fieldB, 'arm:1');
    const cellA2 = makeCell(fieldA, 'arm:2');
    // group2（arm:2）は f-b のセルを持たない（f-b 行の 2 列目は null になる）
    const model: TabModel = {
      groups: [
        { heading: '群 1', cells: [cellA1, cellB1] },
        { heading: '群 2', cells: [cellA2] },
      ],
      cells: [],
    };
    const units = buildFocusUnits('arm', model);
    const unit = units[0] as FocusUnit;
    // 行優先の並び: [cellA1, cellA2](f-a行) → [cellB1, null](f-b行、null は除外)
    // cellA2 の次を探すと null をスキップして cellB1 に到達する
    expect(nextPendingCellInUnit(unit, cellA2.cellKey)).toBe(cellB1.cellKey);
  });
});

describe('nextPendingUnit', () => {
  function unitsOfSections(decidedFieldIds: string[] = []): FocusUnit[] {
    const fields = [
      makeField({ fieldId: 'f-1', fieldIndex: 1, section: 'a' }),
      makeField({ fieldId: 'f-2', fieldIndex: 2, section: 'b', fieldName: 'country' }),
      makeField({ fieldId: 'f-3', fieldIndex: 3, section: 'c', fieldName: 'design' }),
    ];
    const decisions = decidedFieldIds.map((fieldId) => makeDecision({ fieldId }));
    const model = buildTabModel('study', fields, [], decisions);
    return buildFocusUnits('study', model);
  }

  test('fromUnitKey が null なら先頭の未判定ユニットを返す', () => {
    const units = unitsOfSections();
    expect(nextPendingUnit(units, null)?.unitKey).toBe('study|a');
  });

  test('fromUnitKey の次以降で未判定セルを含む最初のユニットを返す', () => {
    const units = unitsOfSections(['f-1']);
    expect(nextPendingUnit(units, 'study|a')?.unitKey).toBe('study|b');
  });

  test('末尾ユニットからは先頭へ回り込む', () => {
    const units = unitsOfSections();
    expect(nextPendingUnit(units, 'study|c')?.unitKey).toBe('study|a');
  });

  test('fromUnitKey 自身がまだ未判定なら回り込みで自分自身を返しうる（ユニットが1つのみ）', () => {
    const fields = [makeField({ fieldId: 'f-1', fieldIndex: 1, section: 'a' })];
    const model = buildTabModel('study', fields, [], []);
    const units = buildFocusUnits('study', model);
    expect(nextPendingUnit(units, 'study|a')?.unitKey).toBe('study|a');
  });

  test('全ユニットが判定済みなら null', () => {
    const units = unitsOfSections(['f-1', 'f-2', 'f-3']);
    expect(nextPendingUnit(units, 'study|a')).toBeNull();
  });

  test('ユニットが 0 件なら null', () => {
    expect(nextPendingUnit([], null)).toBeNull();
  });

  test('fromUnitKey が見つからなければ先頭から探索する', () => {
    const units = unitsOfSections(['f-1']);
    expect(nextPendingUnit(units, 'does-not-exist')?.unitKey).toBe('study|b');
  });
});

describe('unitProgress', () => {
  test('null セルは分母に数えず、判定済みセルのみ decided に数える', () => {
    const fieldA = makeField({ fieldId: 'f-a', entityLevel: 'arm', section: 'arm_info' });
    const fieldB = makeField({ fieldId: 'f-b', entityLevel: 'arm', section: 'arm_info', fieldName: 'arm_n' });
    const cellA1 = makeCell(fieldA, 'arm:1', {
      state: { status: 'accept', value: '1', stack: [] },
    });
    const cellA2 = makeCell(fieldA, 'arm:2');
    const cellB1 = makeCell(fieldB, 'arm:1');
    const model: TabModel = {
      groups: [
        { heading: '群 1', cells: [cellA1, cellB1] },
        { heading: '群 2', cells: [cellA2] }, // f-b のセルが欠落 = null
      ],
      cells: [],
    };
    const units = buildFocusUnits('arm', model);
    const unit = units[0] as FocusUnit;
    // 分母: cellA1, cellA2, cellB1 の 3 件（f-b/群2 の null は数えない）。決定済みは cellA1 のみ
    expect(unitProgress(unit)).toEqual({ decided: 1, total: 3 });
  });

  test('全セル未検証なら decided は 0', () => {
    const fields = [makeField({ fieldId: 'f-1' })];
    const model = buildTabModel('study', fields, [], []);
    const units = buildFocusUnits('study', model);
    expect(unitProgress(units[0] as FocusUnit)).toEqual({ decided: 0, total: 1 });
  });
});
